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
import { IdentityApiService } from './identity-api.service';
import { IdentityUserDto } from './identity.types';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DeclaredRowsNoticeComponent,
    declaredRowsSource,
    PageTitleService,
    ToastService,
    type DataGridChangeEvent,
    type DataGridLoadRequest,
} from '@coolms/ui-angular';
import { UserEditDialogComponent } from './user-edit-dialog.component';

const LIMIT = 50;

@Component({
    selector: 'app-users-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent, DeclaredRowsNoticeComponent],
    template: `
        <cms-list-page
            title="Users"
            icon="people-fill"
            toolbarTreeSlug="navi.toolbar.identity.users"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config fetched from /api/v1/datagrids/identity:users (no externalConfig).
                 Column definitions, sortable flags, filterOp, and rowActions all come from
                 the backend YAML. Column filter row (text/boolean/date) is rendered by the
                 DataGrid itself and pre-built RQL expressions are included in loadMore events. -->
            <cms-declared-rows-notice [source]="rows" />
            <coolms-datagrid
                gridId="identity:users"
                entityAlias="user"
                [hidden]="!rows.showsRows()"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="rows.data()"
                (configLoaded)="rows.use($event)"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)"
                (liveEvent)="onLiveEvent($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class UsersListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;
    private readonly identityApi = inject(IdentityApiService);
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

    /**
     * The rows, from where the grid's definition says they come from (`rows.operation`, `identity.user.list`) and
     * in its query style -- this page names no list route. Each row is shaped as the grid draws it.
     */
    readonly rows    = declaredRowsSource({ pageSize: LIMIT, mapRow: row => userRow(row as unknown as IdentityUserDto) });
    readonly users   = computed(() => this.rows.data().items as unknown as IdentityUserDto[]);
    readonly total   = computed((): number | null => (this.rows.loaded() ? this.rows.data().totalItems : null));

    /** True after the first load so the footer count stays blank until then. */
    readonly loaded = this.rows.loaded;
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n     = this.users().length;
        const total = this.total();
        return total !== null && total > n
            ? `${n} of ${total} users`
            : `${n} user${n === 1 ? '' : 's'}`;
    });

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Context passed to the toolbar for showWhen evaluation. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    ngOnInit(): void {
        this.titleSvc.set('Users');
    }

    /** Fired on mount, on every filter/sort change and when the lazy sentinel scrolls in; the rows source answers. */
    onLoadMore(event: DataGridLoadRequest): void {
        this.rows.load(event);
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    /**
     * DataGrid live -- react to Centrifugo events on the
     * `datagrid.user.list` channel. The DataGrid already flashes
     * any loaded row; this handler keeps the `users` signal in
     * sync. `row.updated` triggers a single-row refetch via
     * `ApiService.getUser`; a 404 silently drops the row.
     * `row.deleted` removes the row outright.
     * `grid.refresh_required` (typically after a bulk operation)
     * forces a full reload from the first page via the DataGrid's
     * `reload()` method. `row.created` stays ignored: lazy-load
     * admins scroll to see new rows anyway, so the refinement is
     * deferred.
     */
    onLiveEvent(event: DataGridChangeEvent): void {
        if (event.type === 'grid.refresh_required') {
            this.grid?.reload();
            return;
        }
        if (event.type === 'row.created') {
            // Ignored for now. Future refinement may
            // optionally prepend if the active sort matches and
            // the top of the list is loaded --.
            return;
        }
        if (event.entityId === null) {
            return;
        }
        if (event.type === 'row.updated') {
            this.identityApi.getUser(event.entityId)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: updated => {
                        this.rows.update(items => items.map(r => (r['id'] === event.entityId ? userRow(updated) : r)));
                    },
                    error: (e: { status?: number }) => {
                        if (404 === e?.status) {
                            this.rows.update(items => items.filter(r => r['id'] !== event.entityId));
                        }
                    },
                });
            return;
        }
        if (event.type === 'row.deleted') {
            this.rows.update(items => items.filter(r => r['id'] !== event.entityId));
        }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const user = this.users().find(u => u.id === (event.row['id'] as string));
        if (!user) return;
        if (event.action === 'edit')   this.openEdit(user);
        if (event.action === 'delete') this.confirmDelete(user);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const user = this.users().find(u => u.id === (row['id'] as string));
        if (!user) return;
        if (id === 'edit')   this.openEdit(user);
        if (id === 'delete') this.confirmDelete(user);
    }

    private openCreate(): void {
        this.dialog.open(UserEditDialogComponent, {
            data: {
                triggerIcon:  'person-plus-fill',
                triggerLabel: 'New User',
            },
        }).closed.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openEdit(user: IdentityUserDto): void {
        this.dialog.open(UserEditDialogComponent, {
            data: {
                userId:       user.id,
                triggerIcon:  'pencil-fill',
                triggerLabel: 'Edit User',
            },
        }).closed.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(user: IdentityUserDto): void {
        const name = user.fullName || user.identifier;
        this.confirmSvc.confirmDelete(name).pipe(
            filter(Boolean),
            switchMap(() => this.identityApi.deleteUser(user.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => {
                this.toast.success('User deleted');
                this.grid.reload();
            },
            error: (e: { error?: { detail?: string } }) =>
                this.toast.error(e?.error?.detail ?? 'Delete failed'),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
}

/** A user as the grid draws it: the DTO, its display name joined, its primary group by label. */
function userRow(u: IdentityUserDto): Record<string, unknown> {
    return {
        ...u,
        // 'identifier' matches the logical YAML column ID.
        identifier:   u.identifier,
        displayName:  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.identifier,
        primaryGroup: (u.primaryGroup?.label || u.primaryGroup?.name) ?? '—',
    };
}
