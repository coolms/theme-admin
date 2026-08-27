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
import { ActivatedRoute, Router } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AuthState, AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    TabStripComponent,
    ToastService,
} from '@coolms/ui-angular';

import { InboxLiveEventsService } from './inbox-live-events.service';
import { InboxService } from './inbox.service';
import {
    InboxTaskCompleteDialogComponent,
    CompleteDialogResult,
} from './inbox-task-complete.dialog';
import {
    InboxTaskDelegateDialogComponent,
    DelegateDialogResult,
} from './inbox-task-delegate.dialog';
import { InboxTab, InboxTaskDto, TaskState } from './inbox.types';

/**
 * M2.m FE — Inbox admin list page (/admin/inbox).
 *
 * **3-tab UX**: My / Claimable / Recent. Tab state lives in the URL
 * (`?tab=`) so refresh + deep-link work; the strip below the toolbar
 * switches tab on click.
 *
 * **Toolbar**: bound to the `navi.toolbar.inbox.tasks` tree (M2.m
 * Phase 3a) which carries the row-action gate logic
 * (`_selected`, `_canClaim`, `_ownedByMe`). Header actions (none today
 * for inbox -- no "New Task" CTA) bubble through `PageActionsService`.
 *
 * **DataGrid**: lazy/api mode against `inbox:tasks` (YAML config from
 * Phase 3a). Server-side pagination via `InboxService.listTasks`. Rows
 * map to `Record<string, unknown>` for the grid + carry sentinel keys
 * `_canClaim` / `_ownedByMe` used by the toolbar showWhen evaluator.
 *
 * **Realtime**: subscribes to `inbox.{currentUserId}` via
 * `InboxLiveEventsService`. Any event refetches the current tab. We
 * don't try to splice rows surgically -- the 50-row refetch is cheap
 * and avoids cache-staleness edge cases (e.g. realtime arrives but
 * row isn't on this page).
 */
@Component({
    selector: 'coolms-admin-inbox-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent, TabStripComponent],
    template: `
        <cms-list-page
            title="Inbox"
            icon="inbox"
            toolbarTreeSlug="navi.toolbar.inbox.tasks"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">

            <!-- Bucket tabs (My / Claimable / Recent) — route by URL query param. -->
            <app-tab-strip
                [tabs]="TABS"
                [activeId]="tab()"
                (selected)="switchTab($any($event))" />

            <coolms-datagrid
                gridId="inbox:tasks"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    `],
})
export class InboxListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api         = inject(InboxService);
    private readonly live        = inject(InboxLiveEventsService);
    private readonly store       = inject(Store);
    private readonly router      = inject(Router);
    private readonly route       = inject(ActivatedRoute);
    private readonly dialog      = inject(Dialog);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly toast       = inject(ToastService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);

    private readonly PAGE_SIZE = 50;

    readonly TABS: ReadonlyArray<{ id: InboxTab; label: string }> = [
        { id: 'assigned',  label: 'My tasks' },
        { id: 'claimable', label: 'Claimable' },
        { id: 'recent',    label: 'Recently completed' },
    ];

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Current user UUID — drives both realtime channel + ownedByMe sentinel. */
    readonly currentUserId = computed<string | null>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return u?.id ?? null;
    });

    /** Current tab (driven by URL query param). */
    readonly tab = signal<InboxTab>('assigned');

    readonly tasks       = signal<ReadonlyArray<InboxTaskDto>>([]);
    readonly totalItems  = signal(0);
    private readonly loaded = signal(false);
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.totalItems()} task${this.totalItems() === 1 ? '' : 's'}` : '',
    );
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    private _loadEpoch = 0;

    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        const uid = this.currentUserId();
        if (row === null) {
            return { _selected: false, _canClaim: false, _ownedByMe: false };
        }
        const state = row['state'] as TaskState;
        const assigneeId = row['assigneeId'] as string | null;
        const candidateUserIds = (row['candidateUserIds'] as ReadonlyArray<string>) ?? [];
        const ownedByMe = uid !== null && assigneeId === uid;
        const canClaim  = state === 'pending'
            && uid !== null
            && candidateUserIds.includes(uid);
        return {
            _selected:  true,
            _canClaim:  canClaim,
            _ownedByMe: ownedByMe,
        };
    });

    /** Grid payload with sentinel keys spliced in. */
    readonly gridData = computed((): DataGridData => {
        const uid = this.currentUserId();
        const items = this.tasks().map(t => ({
            ...t,
            _ownedByMe: uid !== null && t.assigneeId === uid,
            _canClaim:  t.state === 'pending'
                && uid !== null
                && t.candidateUserIds.includes(uid),
        })) as unknown as ReadonlyArray<Record<string, unknown>>;
        return {
            items,
            totalItems: this.totalItems(),
            page:       1,
            limit:      this.PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / this.PAGE_SIZE)),
            hasMore:    !this.loaded() || items.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Inbox');

        // Hydrate tab from URL.
        const initial = this.route.snapshot.queryParamMap.get('tab');
        if (initial === 'assigned' || initial === 'claimable' || initial === 'recent') {
            this.tab.set(initial);
        }

        // Subscribe to live events for the current user. Every event
        // refetches the current tab -- cheap (one paged request) and
        // sidesteps optimistic-update edge cases when the row isn't
        // on the current page.
        const uid = this.currentUserId();
        if (uid !== null) {
            this.live.watch(uid)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => this.grid?.reload(),
                    // Realtime errors are non-fatal -- the page still
                    // works via manual reload + tab switch. Surface
                    // quietly so a stale token doesn't spam toasts.
                    error: () => { /* swallow */ },
                });
        }
    }

    switchTab(t: InboxTab): void {
        if (this.tab() === t) return;
        this.tab.set(t);
        this.selectedRow.set(null);
        // Reflect in URL without triggering re-routing (replaceUrl).
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: t },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
        this.grid?.reload();
    }

    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page = Math.floor(event.offset / this.PAGE_SIZE) + 1;
        const epoch = ++this._loadEpoch;

        this.api.listTasks({
            tab:      this.tab(),
            page,
            pageSize: this.PAGE_SIZE,
            sort:     event.sort,
            filters:  event.columnFilters,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                if (epoch !== this._loadEpoch) return; // stale
                const merged = event.reset
                    ? result.items
                    : [...this.tasks(), ...result.items];
                this.tasks.set(merged);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
            },
            error: () => {
                this.loaded.set(true);
                this.toast.error('Failed to load inbox tasks');
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const t = this.tasks().find(x => x.id === (event.row['id'] as string));
        if (!t) return;
        this.dispatchAction(event.action, t);
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const t = this.tasks().find(x => x.id === (row['id'] as string));
        if (!t) return;
        this.dispatchAction(id, t);
    }

    private dispatchAction(action: string, task: InboxTaskDto): void {
        switch (action) {
            case 'open':     this.openTaskInfo(task); break;
            case 'claim':    this.claim(task); break;
            case 'unclaim':  this.unclaim(task); break;
            case 'delegate': this.openDelegate(task); break;
            case 'complete': this.openComplete(task); break;
        }
    }

    /** Lightweight "Open" -- shows the activity + form info as a toast for MVP. */
    private openTaskInfo(task: InboxTaskDto): void {
        this.toast.info(
            `Activity: ${task.activityId}` + (task.formKey ? ` · Form: ${task.formKey}` : ''),
        );
    }

    private claim(task: InboxTaskDto): void {
        this.api.claim(task.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => { this.toast.success('Task claimed'); this.grid?.reload(); },
                error: err => this.toast.error(this.errors.humanize(err)),
            });
    }

    private unclaim(task: InboxTaskDto): void {
        this.confirmSvc.confirm('Unclaim task', 'Release this task back to the candidate pool?').pipe(
            filter(ok => ok),
            switchMap(() => this.api.unclaim(task.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => { this.toast.success('Task returned to pool'); this.grid?.reload(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private openDelegate(task: InboxTaskDto): void {
        const ref = this.dialog.open<DelegateDialogResult | null>(
            InboxTaskDelegateDialogComponent,
            {
                backdropClass: 'cdk-overlay-dark-backdrop',
                data: { taskId: task.id, activityId: task.activityId },
            },
        );
        ref.closed
            .pipe(
                filter((r): r is DelegateDialogResult => r !== null && r !== undefined),
                switchMap(r => this.api.delegate(task.id, r)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => { this.toast.success('Task delegated'); this.grid?.reload(); },
                error: err => this.toast.error(this.errors.humanize(err)),
            });
    }

    private openComplete(task: InboxTaskDto): void {
        const ref = this.dialog.open<CompleteDialogResult | null>(
            InboxTaskCompleteDialogComponent,
            {
                backdropClass: 'cdk-overlay-dark-backdrop',
                data: { task },
            },
        );
        ref.closed
            .pipe(
                filter((r): r is CompleteDialogResult => r !== null && r !== undefined),
                switchMap(r => this.api.complete(task.id, r)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => { this.toast.success('Task completed'); this.grid?.reload(); },
                error: err => this.toast.error(this.errors.humanize(err)),
            });
    }
}
