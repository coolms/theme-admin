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
import { ApiService, IdentityUserDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
    type DataGridChangeEvent,
} from '@coolms/ui-angular';
import { UserEditDialogComponent } from './user-edit-dialog.component';

const LIMIT = 50;

@Component({
    selector: 'app-users-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
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
            <coolms-datagrid
                gridId="identity:users"
                entityAlias="user"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
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

    readonly users   = signal<IdentityUserDto[]>([]);
    readonly total   = signal<number | null>(null);
    readonly hasMore = signal(true);

    /** Flips true after the first load so the footer count stays blank until then. */
    readonly loaded = signal(false);
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

    readonly gridData = computed((): DataGridData => ({
        items: this.users().map(u => ({
            ...u,
            // 'identifier' matches the logical YAML column ID.
            // Already on the spread via ...u, but explicitly set here so the
            // datagrid's cell lookup (row['identifier']) always finds it.
            identifier:   u.identifier,
            displayName:  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.identifier,
            primaryGroup: (u.primaryGroup?.label || u.primaryGroup?.name) ?? '—',
        })),
        totalItems: this.total() ?? this.users().length,
        page:       1,
        limit:      LIMIT,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        this.titleSvc.set('Users');
    }

    /**
     * Single entry point for all data loading (initial, scroll, sort, filter, reload).
     *
     * `columnFilters` contains pre-built RQL expressions emitted by the DataGrid's
     * column filter row (e.g. `['identifier cn "john"', 'isActive eq true']`).
     * These are passed directly to the API as filter params — no translation needed.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        if (event.reset) {
            this.users.set([]);
            this.hasMore.set(true);
        }

        // Epoch guard: increment on reset so stale in-flight responses are discarded.
        // NOTE: loadEpoch is incremented only on reset so that the sentinel's
        // append call (reset=false) shares the epoch with the preceding reset call.
        // stale detection relies on the loadEpoch snapshot captured just below.
        const epoch = ++this._loadEpoch;

        const page = Math.floor(event.offset / LIMIT) + 1;

        this.api.listUsers({
            limit:   LIMIT,
            page,
            filters: [...event.columnFilters],
            sort:    event.sort ?? undefined,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ members, total }) => {
                if (epoch !== this._loadEpoch && event.reset) return; // stale reset
                this.total.set(total);
                if (event.reset) {
                    this.users.set(members);
                } else {
                    this.users.update(existing => [...existing, ...members]);
                }
                this.hasMore.set(this.users().length < total);
                this.loaded.set(true);
            },
            error: () => {
                this.toast.error('Failed to load users');
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    /**
     * Phase 2 DataGrid live -- react to Centrifugo events on the
     * `datagrid.user.list` channel. The DataGrid already flashes
     * any loaded row; this handler keeps the `users` signal in
     * sync. `row.updated` triggers a single-row refetch via
     * `ApiService.getUser`; a 404 silently drops the row.
     * `row.deleted` removes the row outright.
     * `grid.refresh_required` (typically after a bulk operation)
     * forces a full reload from the first page via the DataGrid's
     * `reload()` method. `row.created` stays ignored in Phase 2:
     * lazy-load admins scroll to see new rows; see ADR-102 for
     * the deferred-refinement rationale.
     */
    onLiveEvent(event: DataGridChangeEvent): void {
        if (event.type === 'grid.refresh_required') {
            this.grid?.reload();
            return;
        }
        if (event.type === 'row.created') {
            // Phase 2 first ship: ignored. Future refinement may
            // optionally prepend if the active sort matches and
            // the top of the list is loaded -- see ADR-102.
            return;
        }
        if (event.entityId === null) {
            return;
        }
        if (event.type === 'row.updated') {
            this.api.getUser(event.entityId)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: updated => {
                        this.users.update(existing => existing.map(u => u.id === event.entityId ? updated : u));
                    },
                    error: (e: { status?: number }) => {
                        if (404 === e?.status) {
                            this.users.update(existing => existing.filter(u => u.id !== event.entityId));
                        }
                    },
                });
            return;
        }
        if (event.type === 'row.deleted') {
            this.users.update(existing => existing.filter(u => u.id !== event.entityId));
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
            switchMap(() => this.api.deleteUser(user.id)),
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
    private _loadEpoch = 0;
}
