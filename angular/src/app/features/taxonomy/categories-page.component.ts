import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, forkJoin, switchMap } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import {
    CategoryEditorDialogComponent,
    CategoryEditorDialogData,
} from './category-editor-dialog.component';
import {
    MoveCategoryDialogComponent,
    MoveCategoryDialogData,
} from './move-category-dialog.component';
import { TaxonomyNodeDto, TaxonomyService } from './taxonomy.service';

/** The taxonomy tree this page manages. */
const TREE_CODE = 'categories';

/**
 * Admin page for the `categories` taxonomy tree (the picker source for the blog
 * `categoryIds` field + search faceting — ADR-129 W1.b).
 *
 * Re-skinned onto the platform convention (#1213): a `<cms-list-page>` shell +
 * a backend-config-driven `<coolms-datagrid>` in **tree mode** + `.cms-dialog`
 * modal editors, mirroring the Pages list. All CRUD maps onto the unchanged
 * Taxonomy REST API via {@see TaxonomyService}. Reparenting is an explicit
 * "Change parent" modal (no drag-drop — taxonomy has no VFS path move).
 *
 * Because `listNodes('categories')` returns the WHOLE nested-set tree in one
 * request, children are resolved for `(loadChildren)` from the in-memory list
 * (no extra round-trips); the grid renders them via `setTreeChildren`.
 */
@Component({
    selector: 'coolms-admin-categories-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Categories"
            icon="diagram-3"
            subtitle="Organize content into a hierarchical category tree"
            toolbarTreeSlug="navi.toolbar.taxonomy.categories"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config from /api/v1/datagrids/taxonomy:categories; rows fed via
                 [externalData] from TaxonomyService (the full tree, loaded at once).
                 showActionColumn:false — actions come from the action bar (above) +
                 the right-click context menu (rowActions), not per-row buttons. -->
            <coolms-datagrid
                gridId="taxonomy:categories"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)"
                (loadChildren)="onLoadChildren($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; }`],
})
export class CategoriesPageComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(TaxonomyService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** The full flat node list (nested-set ordered). Root rows + children derive from it. */
    private readonly allNodes = signal<TaxonomyNodeDto[]>([]);
    /** Resolved `categories` tree id — required to create nodes; null if unseeded. */
    private readonly treeId   = signal<string | null>(null);
    /**
     * False until the first `(loadMore)` resolves. Drives `gridData().hasMore`:
     * the grid emits its INITIAL `loadMore` (which triggers our data fetch) only
     * when `externalData().hasMore !== false` at config-load — see
     * `datagrid.component#onSentinelVisible`. A flat `hasMore: false` on mount
     * short-circuits that guard, so the fetch never fires and the grid shows
     * "No data found" forever. Mirror the Pages list's `hasMore` signal, but key
     * off "loaded" (not `allNodes.length`) so a genuinely empty tree still
     * reports `hasMore: false` and the sentinel doesn't refetch endlessly.
     */
    private readonly loaded   = signal(false);

    readonly footerLabel = signal<string>('');

    /** Currently-selected datagrid row (null when nothing is selected). */
    private readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Drives the action bar's `showWhen` gating: row-level actions appear only when a row is selected. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    /** Root rows feed the grid; children arrive lazily via setTreeChildren. */
    readonly gridData = computed((): DataGridData => {
        // The API OMITS `parentId` for root nodes (null skipped in serialization),
        // so a root's `parentId` is `undefined` — treat any falsy value as root
        // (a strict `=== null` check silently drops every root → empty grid).
        const roots = this.allNodes()
            .filter(n => !n.parentId)
            .sort((a, b) => a.lft - b.lft)
            .map(n => this.toRow(n));
        return {
            items:      roots,
            totalItems: roots.length,
            page:       1,
            limit:      100,
            totalPages: 1,
            // `true` until the first load resolves so the grid emits its initial
            // `(loadMore)` (which triggers our fetch); `false` afterwards so the
            // whole tree is treated as one page and the sentinel stops asking.
            hasMore:    !this.loaded(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Categories');
    }

    /** Single data-load entry point; the grid calls it on init + on reload(). */
    onLoadMore(event: { offset: number; sort: string | null; reset: boolean }): void {
        if (!event.reset && event.offset > 0) return; // whole tree fetched at once
        forkJoin({
            tree:  this.api.findTreeByCode(TREE_CODE),
            nodes: this.api.listNodes(TREE_CODE),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ tree, nodes }) => {
                this.treeId.set(tree?.id ?? null);
                this.allNodes.set(nodes);
                this.loaded.set(true); // flips gridData().hasMore → false (one-shot load)
                this.footerLabel.set(
                    nodes.length === 0 ? '' : `${nodes.length} categor${nodes.length === 1 ? 'y' : 'ies'}`,
                );
            },
            error: () => { this.loaded.set(true); this.toast.error('Failed to load categories'); },
        });
    }

    /** Tree-mode: resolve a parent's direct children from the in-memory list. */
    onLoadChildren(event: { parentId: string; sort: string | null }): void {
        const children = this.allNodes()
            .filter(n => n.parentId === event.parentId)
            .sort((a, b) => a.lft - b.lft)
            .map(n => this.toRow(n));
        this.grid.setTreeChildren(event.parentId, children);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const node = this.findNode(event.row['id'] as string);
        if (!node) return;
        switch (event.action) {
            case 'add-child': this.openEditor('create', node); break;
            case 'edit':      this.openEditor('edit', node);   break;
            case 'move':      this.openMove(node);             break;
            case 'delete':    this.confirmDelete(node);        break;
        }
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    /**
     * Action-bar handler. `create`/`reload` are context-free; the row-level
     * actions (add-child / edit / move / delete) operate on the SELECTED row —
     * mirrors the right-click `onRowAction`, but resolves the node from
     * `selectedRow()` rather than the event row.
     */
    onToolbarAction(id: string): void {
        if (id === 'create') { this.openEditor('create', null); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const node = this.findNode(row['id'] as string);
        if (!node) return;
        switch (id) {
            case 'add-child': this.openEditor('create', node); break;
            case 'edit':      this.openEditor('edit', node);   break;
            case 'move':      this.openMove(node);             break;
            case 'delete':    this.confirmDelete(node);        break;
        }
    }

    // -- Dialog openers --------------------------------------------------------

    /** Open the create/rename modal. In create mode `parent` (if given) is the target parent. */
    private openEditor(mode: 'create' | 'edit', node: TaxonomyNodeDto | null): void {
        const treeId = this.treeId();
        if (mode === 'create' && treeId === null) {
            this.toast.error('The categories tree isn’t set up. Run coolms:content:ensure-categories.');
            return;
        }
        const data: CategoryEditorDialogData = mode === 'create'
            ? { mode, treeId: treeId!, nodes: this.allNodes(), defaultParentId: node ? node.id : null }
            : { mode, treeId: treeId ?? '', nodes: this.allNodes(), node: node! };

        this.dialog.open(CategoryEditorDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openMove(node: TaxonomyNodeDto): void {
        const data: MoveCategoryDialogData = { node, nodes: this.allNodes() };
        this.dialog.open(MoveCategoryDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(node: TaxonomyNodeDto): void {
        const hasChildren = node.rgt - node.lft > 1;
        this.confirmSvc.open({
            title:        `Delete "${node.label}"?`,
            message:      hasChildren
                ? 'This category and all its sub-categories will be permanently deleted.'
                : 'This category will be permanently deleted.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteNode(node.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Category deleted', node.label); this.grid.reload(); },
            error: () => this.toast.error('Delete failed'),
        });
    }

    // -- Helpers ---------------------------------------------------------------

    private findNode(id: string): TaxonomyNodeDto | undefined {
        return this.allNodes().find(n => n.id === id);
    }

    /** Node → datagrid row. `hasChildren` (rgt-lft>1) drives the tree chevron. */
    private toRow(n: TaxonomyNodeDto): Record<string, unknown> {
        return {
            id:          n.id,
            label:       n.label,
            slug:        n.slug,
            parentId:    n.parentId ?? null, // normalize omitted root parentId → null
            level:       n.level,
            hasChildren: n.rgt - n.lft > 1,
        };
    }
}
