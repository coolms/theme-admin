import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { ApiService, NaviTreeDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { NaviTreeFormComponent } from './navi-tree-form.component';

@Component({
    selector: 'coolms-admin-navi-trees-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Navigation Trees"
            icon="diagram-3"
            toolbarTreeSlug="navi.toolbar.navi.trees"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config fetched from /api/v1/datagrids/navi:trees (no externalConfig).
                 All trees are loaded at once via (loadMore) (no server-side pagination). -->
            <coolms-datagrid
                gridId="navi:trees"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class NaviTreesListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly trees   = signal<NaviTreeDto[]>([]);
    readonly hasMore = signal(true);

    /** Flips true after the first load so the footer count stays blank until then. */
    readonly loaded = signal(false);
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.trees().length} tree${this.trees().length === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Context passed to the toolbar for showWhen evaluation. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    /**
     * Tree datagrid Ship B (Item 6) -- inject a derived `group` column on each
     * row derived from the tree slug prefix. The DataGrid alphabetical-sort
     * default already keeps prefix-matching rows contiguous; the badge gives
     * visual grouping without synthetic header rows (which Ship A's DataGrid
     * does not support).
     *
     * Buckets:
     *   - `navi.public.*`  -> 'public'
     *   - `navi.toolbar.*` -> 'toolbar'
     *   - `navi.context.*` -> 'context'
     *   - `navi.admin`/`navi.admin.*` -> 'admin'
     *   - other            -> '' (no badge)
     */
    readonly gridData = computed((): DataGridData => ({
        items: this.trees().map(t => ({
            ...t,
            group:   NaviTreesListComponent.deriveGroup(t.slug),
            // Section badge (task #312 Deliverable 2). Inlined from the
            // backend `siteSectionLabel` -- the projection mirrors backend
            // `NaviTree::$siteSectionId` semantics: public trees carry the
            // section's label here, admin/toolbar/context rows leave it
            // blank so the badge cell is hidden.
            section: NaviTreesListComponent.deriveSectionBadge(t),
        })),
        totalItems: this.trees().length,
        page:       1,
        limit:      50,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    private static deriveGroup(slug: string): string {
        if (slug.startsWith('navi.public.'))  return 'public';
        if (slug.startsWith('navi.toolbar.')) return 'toolbar';
        if (slug.startsWith('navi.context.')) return 'context';
        if (slug === 'navi.admin' || slug.startsWith('navi.admin.')) return 'admin';
        return '';
    }

    /**
     * Section badge text -- prefers the human-friendly section label, falls
     * back to the slug if the backend hasn't denormalised the label (i.e. the
     * tree references a section that was deleted mid-transaction; the FK is
     * RESTRICT so this should be unreachable in practice but the fallback
     * keeps the column meaningful).
     *
     * Slug appended in parens so operators can disambiguate without a
     * separate column -- many sections share short labels in a multi-site
     * deploy (`Blog`, `Docs`) but their slugs are always unique.
     */
    private static deriveSectionBadge(t: NaviTreeDto): string {
        if (!t.siteSectionId)    return '';
        const label = t.siteSectionLabel ?? '';
        const slug  = t.siteSectionSlug  ?? '';
        if (label !== '' && slug !== '' && label.toLowerCase() !== slug.toLowerCase()) {
            return `${label} (${slug})`;
        }
        return label !== '' ? label : slug;
    }

    ngOnInit(): void {
        this.titleSvc.set('Navigation Trees');
    }

    /**
     * Single entry point for all data loading (initial, scroll, sort, filter, reload).
     * Trees are loaded all at once (getNaviTrees() fetches the full collection).
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        // All trees fetched in one request; skip append calls.
        if (!event.reset && event.offset > 0) return;

        const epoch = ++this._loadEpoch;

        this.api.getNaviTrees({
            filters: [...event.columnFilters],
            sort:    event.sort ?? undefined,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: trees => {
                if (epoch !== this._loadEpoch && event.reset) return; // stale reset
                this.trees.set(trees);
                this.hasMore.set(false); // all loaded at once
                this.loaded.set(true);
            },
            error: () => this.toast.error('Failed to load trees'),
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action === 'open') {
            this.router.navigate(['/navi', event.row['slug'], 'nodes']);
            return;
        }
        const tree = this.trees().find(t => t.slug === (event.row['slug'] as string));
        if (!tree) return;
        if (event.action === 'edit')   this.openEdit(tree);
        if (event.action === 'delete') this.confirmDelete(tree);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const slug = row['slug'] as string;
        if (id === 'open') {
            this.router.navigate(['/navi', slug, 'nodes']);
            return;
        }
        const tree = this.trees().find(t => t.slug === slug);
        if (!tree) return;
        if (id === 'edit')   this.openEdit(tree);
        if (id === 'delete') this.confirmDelete(tree);
    }

    private openCreate(): void {
        this.dialog.open(NaviTreeFormComponent, {
            data: null,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openEdit(tree: NaviTreeDto): void {
        this.dialog.open(NaviTreeFormComponent, {
            data: tree,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(tree: NaviTreeDto): void {
        this.confirmSvc.confirmDelete(tree.label).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteNaviTree(tree.slug)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Tree deleted'); this.grid.reload(); },
            error: (e: { error?: { detail?: string } }) =>
                this.toast.error(e?.error?.detail ?? 'Delete failed'),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
    private _loadEpoch = 0;
}
