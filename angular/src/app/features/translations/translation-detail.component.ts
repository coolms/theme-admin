import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import {
    ApiService,
    type TranslationCatalogueDto,
    type TranslationCatalogueEntryDto,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    PageActionsService,
    PageFooterService,
    PageTitleService,
    PageToolbarComponent,
    ToastService,
    type ToolbarAction,
} from '@coolms/ui-angular';

/**
 * Local editor row state. `override` is the mutable input value;
 * `serverOverride` is what the server last returned. `dirty` is
 * recomputed on every keystroke -- cleared input + no server
 * override is still pristine (not dirty), cleared input + server
 * override is dirty (revert this row), etc.
 */
interface EditorRow {
    readonly key:            string;
    readonly baseline:       string;
    /** Server-returned override; null means baseline-only. */
    readonly serverOverride: string | null;
    /** Current input value. Empty string = "no override" (cleared). */
    override:                string;
    dirty:                   boolean;
}

/**
 * F5.d -- Translation detail slot (`TranslationDetail`).
 *
 * Mounted inside `<cms-list-layout layoutId="i18n:translation-detail">`.
 * The layout shell renders cms-page-header (icon, title, header
 * actions) + cms-page-footer; this slot owns the toolbar +
 * editor table. Title is set dynamically via `PageTitleService`
 * once the catalogue is fetched (e.g. "messages · en") so the
 * header shows the live catalogue id instead of the YAML fallback.
 *
 * **Toolbar** -- bound to `navi.toolbar.i18n.translation-detail`.
 * Save (gated on `_dirty`), Revert (gated on `_hasOverride`), Back
 * + Reload are routed through `onToolbarAction`. position: header
 * actions bridge to PageActionsService so they appear in
 * cms-page-header next to the title.
 *
 * **Edit semantics** -- empty input = "no override" (revert this
 * row to baseline). Save POSTs the full edited set; the backend
 * strips null-override rows and writes the override XLIFF to VFS
 * at `/translations/{domain}.{locale}.xlf`. Revert deletes the
 * override file entirely.
 */
@Component({
    selector: 'coolms-admin-translation-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, PageToolbarComponent],
    template: `
        <app-page-toolbar
            treeSlug="navi.toolbar.i18n.translation-detail"
            [context]="toolbarContext()"
            (actionClick)="onToolbarAction($event)"
            (headerActionsChanged)="onHeaderActionsChanged($event)">
        </app-page-toolbar>

        @if (loading()) {
            <div class="editor__placeholder">Loading catalogue&hellip;</div>
        } @else if (!catalogue()) {
            <div class="editor__placeholder">Catalogue not found.</div>
        } @else {
            <div class="editor">
                <table class="editor__grid">
                    <thead>
                        <tr>
                            <th class="editor__col-key">Key</th>
                            <th class="editor__col-baseline">Baseline</th>
                            <th class="editor__col-override">Override</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (row of rows(); track row.key) {
                            <tr [class.editor__row--dirty]="row.dirty">
                                <td class="editor__col-key">
                                    <code>{{ row.key }}</code>
                                </td>
                                <td class="editor__col-baseline">
                                    @if (row.baseline) {
                                        {{ row.baseline }}
                                    } @else {
                                        <span class="editor__empty">(empty)</span>
                                    }
                                </td>
                                <td class="editor__col-override">
                                    <textarea
                                        class="editor__input"
                                        [(ngModel)]="row.override"
                                        (ngModelChange)="onRowChange(row)"
                                        [placeholder]="row.baseline || '(no baseline)'"
                                        rows="2"></textarea>
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        .editor {
            flex: 1;
            min-height: 0;
            overflow: auto;
            padding-bottom: 16px;
        }
        .editor__placeholder {
            padding: 24px;
            color: var(--bs-secondary-color, #6c757d);
        }
        .editor__grid {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
        }
        .editor__grid thead th {
            position: sticky;
            top: 0;
            background: var(--bs-body-bg, #fff);
            border-bottom: 1px solid var(--bs-border-color, #dee2e6);
            text-align: left;
            font-weight: 600;
            padding: 0.5rem 0.75rem;
            color: var(--bs-secondary-color, #495057);
            z-index: 1;
        }
        .editor__grid tbody td {
            padding: 0.5rem 0.75rem;
            border-bottom: 1px solid var(--bs-border-color-translucent, #e9ecef);
            vertical-align: top;
        }
        .editor__row--dirty td { background: var(--bs-warning-bg-subtle, #fff3cd); }
        .editor__col-key      { width: 25%; }
        .editor__col-baseline { width: 35%; color: var(--bs-secondary-color, #495057); }
        .editor__col-override { width: 40%; }
        .editor__col-key code {
            background: var(--bs-secondary-bg, #e9ecef);
            padding: 0.125rem 0.375rem;
            border-radius: 3px;
            font-size: 0.75rem;
            font-family: var(--bs-font-monospace, ui-monospace, SFMono-Regular, monospace);
        }
        .editor__empty { color: var(--bs-tertiary-color, #adb5bd); font-style: italic; }
        .editor__input {
            width: 100%;
            border: 1px solid var(--bs-border-color, #ced4da);
            border-radius: var(--bs-border-radius, 0.375rem);
            padding: 0.375rem 0.5rem;
            font-family: inherit;
            font-size: 0.875rem;
            resize: vertical;
            box-sizing: border-box;
            background: var(--bs-body-bg, #fff);
            color: var(--bs-body-color, #212529);
        }
        .editor__input:focus {
            outline: 0;
            border-color: var(--bs-primary, #0d6efd);
            box-shadow: 0 0 0 0.2rem var(--cms-accent-light);
        }
    `],
})
export class TranslationDetailComponent implements OnInit {
    private readonly api         = inject(ApiService);
    private readonly route       = inject(ActivatedRoute);
    private readonly router      = inject(Router);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly toast       = inject(ToastService);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly pageActions = inject(PageActionsService, { optional: true });
    private readonly pageFooter  = inject(PageFooterService,  { optional: true });
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);

    readonly catalogue = signal<TranslationCatalogueDto | null>(null);
    readonly rows      = signal<EditorRow[]>([]);
    readonly loading   = signal(true);
    readonly saving    = signal(false);

    readonly dirtyCount = computed(() => this.rows().filter(r => r.dirty).length);

    /**
     * Toolbar context for `showWhen` evaluation. `_dirty` gates Save,
     * `_hasOverride` gates Revert.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const cat = this.catalogue();
        return {
            _dirty:       this.dirtyCount() > 0 && !this.saving(),
            _hasOverride: cat !== null && cat.hasOverride && !this.saving(),
        };
    });

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id') ?? '';
        if (!id) {
            this.loading.set(false);
            return;
        }
        this.loadCatalogue(id);
    }

    onRowChange(row: EditorRow): void {
        const cleared       = row.override.trim() === '';
        const wasOverridden = row.serverOverride !== null;
        if (cleared && !wasOverridden) {
            row.dirty = false;
        } else if (cleared && wasOverridden) {
            row.dirty = true;
        } else {
            row.dirty = row.override !== row.serverOverride;
        }
        // Force a recompute of dirtyCount (signal-equality on array reference).
        this.rows.set([...this.rows()]);
    }

    onToolbarAction(id: string): void {
        if (id === 'save')   { this.save();   return; }
        if (id === 'revert') { this.revert(); return; }
        if (id === 'back')   { this.router.navigate(['/i18n/translations']); return; }
        if (id === 'reload') {
            const cat = this.catalogue();
            if (cat) this.loadCatalogue(cat.id);
            return;
        }
    }

    onHeaderActionsChanged(headerActions: ToolbarAction[]): void {
        const handlers: Record<string, () => void> = {};
        for (const action of headerActions) {
            const id = action.id;
            handlers[id] = () => this.onToolbarAction(id);
        }
        this.pageActions?.register(headerActions, handlers);
    }

    private save(): void {
        const cat = this.catalogue();
        if (!cat) return;
        this.saving.set(true);

        const entries: TranslationCatalogueEntryDto[] = this.rows().map(r => ({
            key:      r.key,
            baseline: r.baseline,
            // Empty input -> null override (revert this row to baseline).
            override: r.override.trim() === '' ? null : r.override,
        }));

        this.api.saveTranslationCatalogue(cat.id, entries)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.applyServerState(updated);
                    this.toast.success(`Saved ${cat.domain}:${cat.locale}.`);
                },
                error: (err: unknown) => {
                    this.toast.error(this.errors.humanize(err));
                    this.saving.set(false);
                },
            });
    }

    private revert(): void {
        const cat = this.catalogue();
        if (!cat) return;
        this.confirmSvc.open({
            title:        'Revert to baseline',
            message:      `Delete the VFS override for ${cat.domain}:${cat.locale}? `
                       +  'This restores the on-disk baseline messages and cannot be undone.',
            confirmLabel: 'Revert',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.saving.set(true);
                return this.api.deleteTranslationCatalogue(cat.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Reverted ${cat.domain}:${cat.locale} to baseline.`);
                this.loadCatalogue(cat.id);
            },
            error: (err: unknown) => {
                this.toast.error(this.errors.humanize(err));
                this.saving.set(false);
            },
        });
    }

    private loadCatalogue(id: string): void {
        this.loading.set(true);
        this.api.getTranslationCatalogue(id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: c => {
                    this.applyServerState(c);
                    this.loading.set(false);
                },
                error: (err: unknown) => {
                    this.toast.error(this.errors.humanize(err));
                    this.loading.set(false);
                },
            });
    }

    private applyServerState(cat: TranslationCatalogueDto): void {
        this.catalogue.set(cat);
        const editorRows: EditorRow[] = (cat.entries ?? []).map(e => ({
            key:            e.key,
            baseline:       e.baseline,
            serverOverride: e.override,
            override:       e.override ?? '',
            dirty:          false,
        }));
        this.rows.set(editorRows);
        this.saving.set(false);

        const stateLabel = cat.hasOverride ? 'VFS override' : 'Baseline';
        this.titleSvc.set(`${cat.domain} · ${cat.locale}`);
        this.pageFooter?.set({
            count: `${cat.entryCount} entr${cat.entryCount === 1 ? 'y' : 'ies'} · `
                 + `${cat.overrideCount} overridden · ${stateLabel}`,
        });
    }
}
