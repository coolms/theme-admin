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
import { ActivatedRoute, Router } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { catchError, filter, of, switchMap } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { ApiService, NaviNodeDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { NaviNodeFormComponent } from './navi-node-form.component';

@Component({
    selector: 'coolms-admin-navi-nodes-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <!-- The toolbar tree slug is a string literal and unrelated to
             treeSlug() (route param). The page title is dynamic (Nodes — {slug}). -->
        <cms-list-page
            [title]="pageTitle()"
            icon="diagram-3"
            toolbarTreeSlug="navi.toolbar.navi.nodes"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config fetched from /api/v1/datagrids/navi:nodes (no externalConfig).
                 Tree datagrid Ship B (Item 6) -- root rows load via (loadMore) with
                 parentId='root'; chevron expand fires (loadChildren) which fetches
                 that parents direct children and pushes them back via setTreeChildren. -->
            <coolms-datagrid
                gridId="navi:nodes"
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
export class NaviNodesListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly route      = inject(ActivatedRoute);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly treeSlug = signal('');
    readonly nodes    = signal<NaviNodeDto[]>([]);
    readonly hasMore  = signal(true);

    /** Dynamic page-header title — "Nodes — {treeSlug}" (was set via PageActionsService). */
    readonly pageTitle = computed(() => `Nodes — ${this.treeSlug()}`);

    /** Flips to a count after the first load; blank until then. */
    readonly footerLabel = signal<string>('');

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Context passed to the toolbar for showWhen evaluation. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => ({
        items:      this.nodes() as unknown as ReadonlyArray<Record<string, unknown>>,
        totalItems: this.nodes().length,
        page:       1,
        limit:      200,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        const slug = this.route.snapshot.paramMap.get('treeSlug') ?? '';
        this.treeSlug.set(slug);
        // The cms-list-page header title binds to pageTitle() (computed from
        // treeSlug); only the browser tab title still needs a manual push.
        this.titleSvc.set(`Nodes — ${slug}`);
    }

    /**
     * Single entry point for all root-row loading (initial, scroll, sort, filter,
     * reload). Tree-mode (Ship B Item 6): roots are fetched with
     * `parentId: 'root'`; per-parent children load on chevron expand via
     * onLoadChildren(). Append calls are skipped because the root set is
     * always fetched in one request.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        // All root nodes fetched in one request; skip append calls.
        if (!event.reset && event.offset > 0) return;

        const epoch = ++this._loadEpoch;

        this.api.getNaviNodes(this.treeSlug(), {
            filters:  [...event.columnFilters],
            sort:     event.sort ?? undefined,
            parentId: 'root',
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: nodes => {
                if (epoch !== this._loadEpoch && event.reset) return; // stale reset
                this.nodes.set(nodes);
                this.hasMore.set(false); // all loaded at once
                this.footerLabel.set(`${nodes.length} node${nodes.length === 1 ? '' : 's'}`);
            },
            error: () => this.toast.error('Failed to load nodes'),
        });
    }

    /**
     * Tree datagrid Ship B (Item 6) -- the datagrid emits (loadChildren) when
     * the user expands a chevron on a row whose `hasChildren` is true. We
     * fetch the parent's direct children with `?parent={uuid}` and push them
     * back into the grid's per-parent children cache.
     */
    onLoadChildren(event: { parentId: string; sort: string | null }): void {
        this.api.getNaviNodes(this.treeSlug(), {
            parentId: event.parentId,
            sort:     event.sort ?? undefined,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError(() => {
                this.toast.error('Failed to load children');
                return of([] as NaviNodeDto[]);
            }),
        ).subscribe(children => {
            this.grid.setTreeChildren(
                event.parentId,
                children as unknown as ReadonlyArray<Record<string, unknown>>,
            );
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const node = this.nodes().find(n => n.id === (event.row['id'] as string));
        if (!node) return;
        if (event.action === 'edit')   this.openEdit(node);
        if (event.action === 'delete') this.confirmDelete(node);
    }

    onToolbarAction(id: string): void {
        if (id === 'back')   { this.router.navigate(['/navi']); return; }
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const node = this.nodes().find(n => n.id === (row['id'] as string));
        if (!node) return;
        if (id === 'edit')   this.openEdit(node);
        if (id === 'delete') this.confirmDelete(node);
    }

    private openCreate(): void {
        this.dialog.open(NaviNodeFormComponent, {
            data: { treeSlug: this.treeSlug(), node: null },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openEdit(node: NaviNodeDto): void {
        this.dialog.open(NaviNodeFormComponent, {
            data: { treeSlug: this.treeSlug(), node },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(node: NaviNodeDto): void {
        const name = node.title || node.path;
        this.confirmSvc.confirmDelete(name).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteNaviNode(node.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Node deleted'); this.grid.reload(); },
            error: (e: { error?: { detail?: string } }) =>
                this.toast.error(e?.error?.detail ?? 'Delete failed'),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
    private _loadEpoch = 0;
}
