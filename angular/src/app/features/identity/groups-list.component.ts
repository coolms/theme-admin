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
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { ApiService, IdentityGroupDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { GroupRoleGrantsDialogComponent } from './group-role-grants-dialog.component';
import { GroupCreateDialogComponent } from './group-create-dialog.component';

@Component({
    selector: 'app-groups-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Groups"
            icon="people-fill"
            toolbarTreeSlug="navi.toolbar.identity.groups"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config fetched from /api/v1/datagrids/identity:groups (no externalConfig).
                 Column definitions, sortable flags, filterOp, and rowActions come from
                 the backend YAML. Data is loaded via (loadMore) — all groups at once
                 (hasMore=false after the first page since the API has no pagination). -->
            <coolms-datagrid
                gridId="identity:groups"
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
export class GroupsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(ApiService);
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

    readonly groups  = signal<IdentityGroupDto[]>([]);
    readonly hasMore = signal(true);

    /** Flips true after the first load so the footer count stays blank until then. */
    readonly loaded = signal(false);
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.groups().length} group${this.groups().length === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Context passed to the toolbar for showWhen evaluation. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected:     this.selectedRow() !== null,
        _selectedId:   String(this.selectedRow()?.['id'] ?? ''),
        _selectedSlug: String(this.selectedRow()?.['name'] ?? ''),
    }));

    readonly gridData = computed((): DataGridData => ({
        items: this.groups() as unknown as ReadonlyArray<Record<string, unknown>>,
        totalItems: this.groups().length,
        page:       1,
        limit:      50,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        this.titleSvc.set('Groups');
    }

    /**
     * Single entry point for all data loading (initial, scroll, sort, filter, reload).
     * Groups are loaded all at once (API has no cursor/page pagination), so hasMore
     * is always false after the first successful response.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        // All groups are fetched in one request; skip append calls.
        if (!event.reset && event.offset > 0) return;

        const epoch = ++this._loadEpoch;

        this.api.listGroups({
            limit:   500,
            filters: [...event.columnFilters],
            sort:    event.sort ?? undefined,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: groups => {
                if (epoch !== this._loadEpoch && event.reset) return; // stale reset
                this.groups.set(groups);
                this.hasMore.set(false); // all loaded at once
                this.loaded.set(true);
            },
            error: () => this.toast.error('Failed to load groups'),
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const group = this.groups().find(g => g.id === (event.row['id'] as string));
        if (!group) return;
        if (event.action === 'edit')        this.openEdit(group);
        if (event.action === 'delete')      this.confirmDelete(group);
        if (event.action === 'role-grants') this.openRoleGrants(group);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const group = this.groups().find(g => g.id === (row['id'] as string));
        if (!group) return;
        if (id === 'edit')        this.openEdit(group);
        if (id === 'delete')      this.confirmDelete(group);
        if (id === 'role-grants') this.openRoleGrants(group);
    }

    private openCreate(): void {
        this.dialog.open(GroupCreateDialogComponent).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openEdit(group: IdentityGroupDto): void {
        this.dialog.open(GroupCreateDialogComponent, { data: group }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    /**
     * Edit which groups this one hands its role out to.
     *
     * Reloads the grid on save even though no visible column changes: the row's
     * `grantsGroupIds` is stale afterwards, and a later action reading it would
     * act on the pre-edit graph.
     */
    private openRoleGrants(group: IdentityGroupDto): void {
        this.dialog.open(GroupRoleGrantsDialogComponent, { data: group }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(group: IdentityGroupDto): void {
        this.confirmSvc.confirmDelete(group.label || group.name).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteGroup(group.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Group deleted'); this.grid.reload(); },
            error: (e: { error?: { detail?: string } }) =>
                this.toast.error(e?.error?.detail ?? 'Delete failed'),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
    private _loadEpoch = 0;
}
