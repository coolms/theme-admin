import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { debounceTime, distinctUntilChanged, firstValueFrom, map, skip } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { ApiService, SiteSectionDto } from '../../api/api.service';
import { PageService } from '../content/page.service';
import { PageDto } from '../content/page.types';
import { VfsDirectoryPage, VfsNodeDto } from '@coolms/ui-angular';
import { LinkPickerRecentService } from './services/link-picker-recent.service';
import type { LinkTargetType } from './types/link-widget.types';
import type {
    LinkPickerHostData, LinkPickerHostResult, LinkTargetSelection, RecentLink,
} from './types/link-picker.types';

type Tab = 'internal' | 'external' | 'recent';
type InternalSubTab = 'pages' | 'sections' | 'vfs';

const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * 3-tab CDK Dialog for picking link targets. Mirrors MediaPickerHostComponent's
 * shape: dialog chrome, tab bar, sticky config row, footer with Cancel /
 * Insert buttons.
 *
 *   Internal tab  - sub-tabs (Pages / Sections / VFS) with single-select grid.
 *   External tab  - URL input + scheme validation (mirror of UrlLinkResolver).
 *   Recent tab    - localStorage LRU per user.
 *
 * On confirm:
 *   - Builds a LinkPickerHostResult (shape consumed by B3's OpenLinkPickerHandler).
 *   - Records the chosen target in the recent LRU.
 *   - Closes the dialog with the result.
 *
 * Editing existing widgets: when `data.initialTarget` is supplied, the dialog
 * opens with that target pre-selected and the config row pre-filled from
 * `data.initialConfig`. The dialog itself doesn't distinguish insert vs edit;
 * the caller (B3) decides whether to insert or replace based on context.
 */
@Component({
    selector: 'app-link-picker-host',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    templateUrl: './link-picker-host.component.html',
    styleUrls: ['./link-picker-host.component.scss'],
})
export class LinkPickerHostComponent {
    readonly data: LinkPickerHostData = inject(DIALOG_DATA, { optional: true }) ?? {};
    private readonly dialogRef = inject<DialogRef<LinkPickerHostResult | null>>(DialogRef);
    private readonly pages     = inject(PageService);
    private readonly api       = inject(ApiService);
    private readonly http      = inject(HttpClient);
    private readonly store     = inject(Store);
    private readonly recent    = inject(LinkPickerRecentService);

    readonly activeTab    = signal<Tab>(this.data.initialTab ?? 'internal');
    readonly internalSub  = signal<InternalSubTab>('pages');

    /** Currently-chosen target (Internal or Recent tab). */
    readonly currentSelection = signal<LinkTargetSelection | null>(null);

    /** External URL input value. */
    readonly externalUrl = signal('');

    /** Sticky config row state. */
    readonly configLabel    = signal(this.data.initialConfig?.label ?? '');
    readonly configTarget   = signal<'_self' | '_blank'>(this.data.initialConfig?.target ?? '_self');
    readonly configRel      = signal(this.data.initialConfig?.rel ?? '');
    readonly configClass    = signal(this.data.initialConfig?.className ?? '');
    readonly useLatestLabel = signal(this.data.initialConfig?.useLatestLabel ?? false);

    /** Per-tab data sources. */
    /**
     * Pages sub-tab: the *current view* — either the lazy tree level (children
     * of the deepest crumb, or the roots when crumbs are empty) or the flat
     * server-side search results when `searchQuery` is non-empty. Never the
     * whole site, so it scales to thousands of pages.
     */
    readonly pageNodes   = signal<PageDto[] | null>(null);
    /** Drill-down trail of directories (id + display label); [] = roots. */
    readonly pageCrumbs  = signal<{ id: string; label: string }[]>([]);
    readonly sectionList = signal<SiteSectionDto[] | null>(null);
    readonly vfsPath     = signal('/');
    readonly vfsNodes    = signal<VfsNodeDto[] | null>(null);
    readonly recentList  = signal<RecentLink[]>([]);

    readonly searchQuery = signal('');

    /** True while the Pages tab is showing search results rather than the tree. */
    readonly pageSearchMode = computed(() => this.searchQuery().trim() !== '');

    /** Human breadcrumb of the current Pages tree position (browse mode). */
    readonly pageCrumbLabel = computed(() => {
        const crumbs = this.pageCrumbs();
        return crumbs.length === 0 ? '/' : '/ ' + crumbs.map(c => c.label).join(' / ');
    });

    /** True when a label was entered manually; suppresses auto-fill from selection. */
    private userTouchedLabel = false;

    /** External-URL validity message (null = valid; string = error to display). */
    readonly externalError = computed<string | null>(() => {
        const url = this.externalUrl().trim();
        if (url === '') return 'Enter a URL';

        if (url.startsWith('#')) return null; // anchor

        const m = URL_SCHEME_RE.exec(url);
        if (!m) return null; // relative path

        const scheme = m[1].toLowerCase();
        if (!ALLOWED_EXTERNAL_SCHEMES.has(scheme)) {
            return `Scheme "${scheme}:" is not allowed`;
        }
        return null;
    });

    readonly isExternalValid = computed(() => this.externalError() === null);

    readonly canConfirm = computed(() => {
        const tab = this.activeTab();
        if (tab === 'external') return this.isExternalValid();
        return this.currentSelection() !== null;
    });

    readonly filteredSections = computed(() => {
        const list = this.sectionList() ?? [];
        const q = this.searchQuery().toLowerCase().trim();
        if (q === '') return list;
        return list.filter(s =>
            s.label.toLowerCase().includes(q) ||
            (s.slug ?? '').toLowerCase().includes(q),
        );
    });

    /** Selected status helpers consumed by the templates' [class.selected] binds. */
    isSelected(type: LinkTargetType, identifier: string): boolean {
        const sel = this.currentSelection();
        return sel !== null && sel.type === type && sel.identifier === identifier;
    }

    constructor() {
        // Auto-fill the label from the currently-selected target's default label
        // unless the user has typed something themselves.
        effect(() => {
            const sel = this.currentSelection();
            if (sel === null) return;
            if (this.userTouchedLabel) return;
            if (this.configLabel() !== '' && this.configLabel() === sel.defaultLabel) return;
            this.configLabel.set(sel.defaultLabel);
        });

        // Lazy-load the active tab's data on first switch.
        effect(() => {
            const tab = this.activeTab();
            if (tab === 'recent') {
                this.recentList.set(this.recent.list());
                return;
            }
            if (tab === 'internal') {
                this.loadInternalSub(this.internalSub());
            }
        });

        // Load the right sub-list when sub-tab flips.
        effect(() => {
            if (this.activeTab() !== 'internal') return;
            this.loadInternalSub(this.internalSub());
        });

        // Pages tab: debounce the shared search box and run a bounded
        // server-side typeahead. `skip(1)` drops the initial empty emission so
        // we don't double-load the root level that loadInternalSub already
        // fetches. Clearing the box (back to '') restores the browsed tree
        // level rather than the whole site. Sections keep their own cheap
        // client-side filter (filteredSections) off the same signal.
        toObservable(this.searchQuery).pipe(
            skip(1),
            map(q => q.trim()),
            debounceTime(200),
            distinctUntilChanged(),
            takeUntilDestroyed(),
        ).subscribe(q => {
            if (this.activeTab() !== 'internal' || this.internalSub() !== 'pages') return;
            if (q === '') {
                this.loadPageLevel(this.currentPageParentId());
            } else {
                this.searchPages(q);
            }
        });

        // Apply initial target pre-selection (editing existing link).
        if (this.data.initialTarget) {
            const t = this.data.initialTarget;
            if (t.type === 'url' || t.type === 'route') {
                this.activeTab.set('external');
                this.externalUrl.set(t.identifier);
            } else {
                this.activeTab.set('internal');
                this.internalSub.set(t.type === 'vfs' ? 'vfs' : t.type === 'section' ? 'sections' : 'pages');
                this.currentSelection.set({
                    type: t.type,
                    identifier: t.identifier,
                    defaultLabel: this.data.initialConfig?.label ?? '',
                });
            }
        }
    }

    setActiveTab(tab: Tab): void {
        this.activeTab.set(tab);
        this.searchQuery.set('');
    }

    setInternalSub(sub: InternalSubTab): void {
        this.internalSub.set(sub);
        this.searchQuery.set('');
        this.currentSelection.set(null);
    }

    onLabelInput(value: string): void {
        this.userTouchedLabel = true;
        this.configLabel.set(value);
    }

    selectPage(page: PageDto): void {
        // Directories are containers to drill into, never link targets.
        if (page.nodeType === 'directory') {
            return;
        }
        this.currentSelection.set({
            type: 'page',
            identifier: page.id,
            defaultLabel: page.slug,
        });
    }

    /** Browse-mode drill-in: push the directory onto the trail and load it. */
    navigatePage(node: PageDto): void {
        if (node.nodeType !== 'directory') {
            return;
        }
        this.pageCrumbs.update(crumbs => [...crumbs, { id: node.id, label: node.slug }]);
        this.loadPageLevel(node.id);
    }

    /** Browse-mode go-up: pop the trail and load the now-deepest level. */
    navigatePageUp(): void {
        const crumbs = this.pageCrumbs();
        if (crumbs.length === 0) {
            return;
        }
        const next = crumbs.slice(0, -1);
        this.pageCrumbs.set(next);
        this.loadPageLevel(next.length > 0 ? next[next.length - 1].id : null);
    }

    private currentPageParentId(): string | null {
        const crumbs = this.pageCrumbs();
        return crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
    }

    selectSection(section: SiteSectionDto): void {
        if (!section.id) return;
        this.currentSelection.set({
            type: 'section',
            identifier: section.id,
            defaultLabel: section.label,
        });
    }

    selectVfsNode(node: VfsNodeDto): void {
        if (node.type === 'directory') return; // directories not selectable
        this.currentSelection.set({
            type: 'vfs',
            identifier: node.id,
            defaultLabel: node.name,
        });
    }

    selectRecent(entry: RecentLink): void {
        this.currentSelection.set({
            type: entry.type,
            identifier: entry.identifier,
            defaultLabel: entry.label,
        });
        this.userTouchedLabel = false;
    }

    navigateVfs(node: VfsNodeDto): void {
        if (node.type !== 'directory') return;
        const next = node.path.endsWith('/') ? node.path : node.path + '/';
        this.vfsPath.set(next);
        void this.loadVfsDir(next);
    }

    navigateVfsUp(): void {
        const path = this.vfsPath();
        if (path === '/' || path === '') return;
        const trimmed = path.replace(/\/$/, '');
        const parent = trimmed.substring(0, trimmed.lastIndexOf('/')) || '/';
        const next = parent.endsWith('/') ? parent : parent + '/';
        this.vfsPath.set(next);
        void this.loadVfsDir(next);
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    confirm(): void {
        if (!this.canConfirm()) return;

        const result = this.buildResult();
        if (!result) return;

        // Recording the recent LRU lives in the action handler so the
        // picker stays presentational. The handler invokes
        // LinkPickerRecentService.record() after a successful insert,
        // which keeps cancel paths from leaking into the LRU.
        this.dialogRef.close(result);
    }

    private buildResult(): LinkPickerHostResult | null {
        const label    = this.configLabel().trim();
        const target   = this.configTarget();
        const rawRel   = this.configRel().trim();
        const rawClass = this.configClass().trim();
        const rel      = rawRel === '' ? null : rawRel;
        const className = rawClass === '' ? null : rawClass;

        const tab = this.activeTab();
        if (tab === 'external') {
            const url = this.externalUrl().trim();
            return {
                type: 'url',
                identifier: url,
                label: label === '' ? url : label,
                target,
                rel,
                className,
                routeParams: null,
                useLatestLabel: this.useLatestLabel(),
            };
        }

        const sel = this.currentSelection();
        if (!sel) return null;
        return {
            type: sel.type,
            identifier: sel.identifier,
            label: label === '' ? sel.defaultLabel : label,
            target,
            rel,
            className,
            routeParams: null,
            useLatestLabel: this.useLatestLabel(),
        };
    }

    private loadInternalSub(sub: InternalSubTab): void {
        if (sub === 'pages' && this.pageNodes() === null) {
            // Lazy tree: load the deepest crumb's children (roots when empty).
            // Drilling in / searching is handled by navigatePage / the debounced
            // search subscription — this only seeds the first level.
            this.loadPageLevel(this.currentPageParentId());
        } else if (sub === 'sections' && this.sectionList() === null) {
            this.api.getSections().subscribe({
                next:  ss => this.sectionList.set(ss),
                error: () => this.sectionList.set([]),
            });
        } else if (sub === 'vfs' && this.vfsNodes() === null) {
            void this.loadVfsDir(this.vfsPath());
        }
    }

    /** Load one tree level (children of `parentId`, or roots when null). */
    private loadPageLevel(parentId: string | null): void {
        this.pageNodes.set(null);
        this.pages.listPages(parentId !== null ? { parentId } : undefined).subscribe({
            next:  ps => this.pageNodes.set(ps),
            error: () => this.pageNodes.set([]),
        });
    }

    /** Run the bounded server-side typeahead and show flat results. */
    private searchPages(query: string): void {
        this.pageNodes.set(null);
        this.pages.listPages({ search: query }).subscribe({
            next:  ps => this.pageNodes.set(ps),
            error: () => this.pageNodes.set([]),
        });
    }

    private async loadVfsDir(path: string): Promise<void> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl = manifest?.apiBase ?? '';
        if (baseUrl === '') {
            this.vfsNodes.set([]);
            return;
        }
        const url = `${baseUrl}/vfs/directories/list?path=${encodeURIComponent(path)}&showHidden=false&limit=200`;
        try {
            const page = await firstValueFrom(
                this.http.get<VfsDirectoryPage>(url, { headers: { Accept: 'application/ld+json' } }),
            );
            const sorted = [...(page.member ?? [])].sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
            });
            this.vfsNodes.set(sorted);
        } catch {
            this.vfsNodes.set([]);
        }
    }
}
