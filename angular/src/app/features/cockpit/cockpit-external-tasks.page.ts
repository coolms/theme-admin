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
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type ActiveFilter,
    type DataGridData,
} from '@coolms/ui-angular';
import { CockpitService } from './cockpit.service';
import { CockpitExternalTaskDto } from './cockpit.types';

/** Rows per server page. */
const PAGE_SIZE = 50;

/**
 * Decodes a multi-select filter value — a JSON array string, the shape
 * `columnFilterRql` splices into an `in (...)`.
 */
function decodeTokens(value: string): string[] {
    try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // Not JSON — a plain scalar filter value.
    }

    return value === '' ? [] : [value];
}

/** Projected grid row. */
interface CockpitExternalTaskRow {
    id: string;
    topic: string;
    state: string;
    activityId: string;
    worker: string;
    retries: number;
    createdAt: string;
}

/**
 * M4 — Cockpit External Tasks list page (`/admin/cockpit/external-tasks`).
 *
 * A read-only operator table of Camunda-style external worker tasks the
 * engine has parked for external workers to lock + complete, backed by
 * `GET /api/v1/cockpit/external-tasks` (ROLE_ADMIN). Mirrors the cockpit
 * instance list exactly — `<cms-list-page>` (icon + Reload action) +
 * `<coolms-datagrid>` driven by the `cockpit:external-tasks` config YAML —
 * so it matches the rest of the operator surfaces (sortable columns,
 * per-column filter row incl. the state dropdown, column-visibility).
 *
 * `loadingMode: lazy`: the grid emits `(loadMore)` on mount and
 * on every filter/sort/page change, and this page turns that into ONE server
 * request. It used to be `client` — one perPage=200 block filtered and sorted
 * in the browser. There is no external-task detail page;
 * the toolbar offers Reload, and Failed rows expose a `retry` row action
 * that re-opens the task for another worker attempt via
 * `POST /cockpit/external-tasks/{id}/retry`, then reloads.
 */
@Component({
    selector: 'app-cockpit-external-tasks-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="External Tasks"
            icon="cpu"
            subtitle="Camunda-style external worker tasks"
            toolbarTreeSlug="navi.toolbar.cockpit.external-tasks"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="cockpit:external-tasks"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (loadMore)="onLoadMore($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class CockpitExternalTasksPageComponent implements OnInit {
    /** Optional: toolbar Reload / post-retry refresh can fire before the view settles. */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

    private readonly cockpit = inject(CockpitService);
    private readonly store = inject(Store);
    private readonly route = inject(ActivatedRoute);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly titleSvc = inject(PageTitleService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    private readonly rows = signal<CockpitExternalTaskRow[]>([]);

    /** Server's count for the CURRENT filter — drives the footer and `hasMore`. */
    readonly totalItems = signal(0);
    /** Flips true after the first response (success OR error). */
    readonly loaded = signal(false);

    readonly gridData = computed((): DataGridData => {
        const rows = this.rows();
        return {
            items: rows as unknown as Array<Record<string, unknown>>,
            totalItems: this.totalItems(),
            page: 1,
            limit: PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / PAGE_SIZE)),
            hasMore: !this.loaded() || rows.length < this.totalItems(),
        };
    });

    /**
     * Footer row-count strip. `totalItems` is the SERVER's count for the
     * active filter, so it needs no client-side adjustment — a consequence of
     * filtering server-side.
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        return n === 0 ? '' : `${n} task${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('External Tasks');
        // Re-fetch when the drill-in filter changes — callers may link here
        // with `?topic=` / `?state=` / `?processInstanceId=`. The FIRST load is
        // the grid's own `(loadMore)` on mount, so skip the initial emission
        // rather than racing it.
        let first = true;
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (first) { first = false; return; }
                this.load();
            });
    }

    /**
     * The one place external tasks are fetched. Fired by the grid on mount, on
     * every filter/sort change (`reset`, offset 0) and when the lazy sentinel
     * scrolls in. Column filters go to the SERVER.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
        activeFilters: ReadonlyArray<ActiveFilter>;
    }): void {
        const page  = Math.floor(event.offset / PAGE_SIZE) + 1;
        const epoch = ++this.loadEpoch;
        const params = this.route.snapshot.queryParamMap;

        this.cockpit
            .listExternalTasksPage({
                page,
                perPage: PAGE_SIZE,
                ...(event.sort ? { sort: event.sort } : {}),
                topic: params.get('topic') ?? undefined,
                state: params.get('state') ?? undefined,
                processInstanceId: params.get('processInstanceId') ?? undefined,
                ...this.toQueryFilters(event.activeFilters),
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: result => {
                    // Filter changes land out of order otherwise.
                    if (epoch !== this.loadEpoch) return;

                    const mapped = result.items.map(t => this.toRow(t));
                    this.rows.set(event.reset ? mapped : [...this.rows(), ...mapped]);
                    this.totalItems.set(result.totalItems);
                    this.loaded.set(true);
                },
                error: (e: unknown) => {
                    if (epoch !== this.loadEpoch) return;
                    // Settle `hasMore` or the sentinel retries the failed page forever.
                    this.loaded.set(true);
                    this.toast.error(this.errors.humanize(e));
                },
            });
    }

    /**
     * Maps the grid's structured column filters to the endpoint's named query
     * params. A drill-in `?topic=` from the URL is overridden by the column
     * filter when both are present — the operator's explicit input wins.
     */
    private toQueryFilters(filters: ReadonlyArray<ActiveFilter>): {
        state?: string; topic?: string; activityId?: string; worker?: string;
        createdFrom?: string; createdTo?: string;
    } {
        const out: {
            state?: string; topic?: string; activityId?: string; worker?: string;
            createdFrom?: string; createdTo?: string;
        } = {};

        for (const f of filters) {
            switch (f.column) {
                case 'state':      out.state = decodeTokens(f.value).join(','); break;
                case 'topic':      out.topic = f.value; break;
                case 'activityId': out.activityId = f.value; break;
                case 'worker':     out.worker = f.value; break;
                case 'createdAt':
                    // The date-range picker emits a ge/le PAIR on one column.
                    if (f.op === 'ge') out.createdFrom = f.value;
                    if (f.op === 'le') out.createdTo = f.value;
                    break;
            }
        }

        return out;
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.load(); return; }
    }

    /**
     * Row action handler (M5 external-worker steering). The only action is
     * `retry`, gated by the grid's `showWhen` to Failed rows: confirm, then
     * re-open the task via `POST /cockpit/external-tasks/{id}/retry` so a
     * worker can attempt it again, and reload so the row flips to Created.
     */
    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'retry') { return; }
        const id = event.row['id'];
        if (typeof id !== 'string' || id === '') { return; }

        this.confirm.open({
            title:        'Retry external task?',
            message:      'Re-open this failed external task so a worker can attempt it again. It returns to the Created state with a fresh retry budget.',
            confirmLabel: 'Retry',
            cancelLabel:  'Cancel',
        }).pipe(
            filter(ok => ok),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.cockpit.retryExternalTask(id)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => { this.toast.success('External task re-opened'); this.load(); },
                    error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
                });
        });
    }

    /**
     * Re-runs the current query from page 1, KEEPING the grid's active filters
     * and sort — the grid owns that state now, so it must drive the refetch.
     */
    private load(): void {
        this.grid?.reload();
    }

    private toRow(t: CockpitExternalTaskDto): CockpitExternalTaskRow {
        return {
            id: t.id,
            topic: t.topic,
            state: t.state,
            activityId: t.activityId,
            worker: t.workerId ?? '—',
            retries: t.retries,
            createdAt: t.createdAt,
        };
    }
}
