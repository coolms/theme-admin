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
import { Store } from '@ngxs/store';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type ActiveFilter,
    type DataGridData,
} from '@coolms/ui-angular';
import { CockpitService } from './cockpit.service';
import { CockpitInstanceDto } from './cockpit.types';

/** Rows per server page. */
const PAGE_SIZE = 50;

/**
 * Decodes a multi-select filter value — a JSON array string, the shape
 * `columnFilterRql` splices into an `in (...)`. Falls back to the raw value so
 * a single-op filter on the same column still works.
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
interface CockpitRow {
    id: string;
    state: string;
    definition: string;
    businessKey: string;
    startedAt: string | null;
    completedAt: string | null;
}

/**
 * M4.a — Process Cockpit list page (`/admin/cockpit`).
 *
 * The first M4 operator surface: a read-only table of process instances the
 * engine has run, filterable by state, backed by `GET /api/v1/cockpit/instances`
 * (ROLE_ADMIN). Built on the platform list-page pattern — `<cms-page-header>`
 * (icon + Reload action) + `<coolms-datagrid>` driven by the `cockpit:instances`
 * config YAML — so it matches Forms / Calendars / Definitions exactly (sortable
 * columns, per-column filter row incl. the state dropdown, column-visibility).
 *
 * `loadingMode: lazy` (ledger #1659): the grid emits `(loadMore)` on mount and
 * on every filter/sort/page change, and this page turns that into ONE server
 * request. It used to be `client` — one perPage=200 block filtered and sorted
 * in the browser — so past 200 live instances the filter row searched a subset
 * and reported it as the whole answer. Instance detail (history timeline +
 * token positions) + steering actions land in later M4 slices.
 */
@Component({
    selector: 'app-cockpit-list-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Process Cockpit"
            icon="speedometer2"
            subtitle="Running and finished workflow process instances"
            toolbarTreeSlug="navi.toolbar.cockpit.instances"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="cockpit:instances"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (loadMore)="onLoadMore($event)"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class CockpitListPageComponent implements OnInit {
    /** Optional: toolbar Reload can fire before the view settles. */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

    private readonly cockpit = inject(CockpitService);
    private readonly store = inject(Store);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly titleSvc = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    private readonly rows = signal<CockpitRow[]>([]);

    /** Selected grid row — drives the toolbar's selection-gated Open (navi showWhen). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** showWhen context for the `navi.toolbar.cockpit.instances` tree: `_selected` gates Open. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

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
     * active filter, so it needs no client-side adjustment — that follows from
     * filtering server-side. While the grid was `loadingMode: client` this
     * counted the loaded rows and disagreed with the filter row.
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        return n === 0 ? '' : `${n} instance${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Process Cockpit');
        // Re-fetch whenever the drill-in filter changes — the report page links
        // here with `?definitionId=` / `?state=` (M4.d). `queryParamMap` emits
        // the initial value, but the FIRST load is the grid's own `(loadMore)`
        // on mount; asking the grid to reload covers both without racing it.
        let first = true;
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (first) { first = false; return; }
                this.load();
            });
    }

    /**
     * The one place instances are fetched. Fired by the grid on mount, on every
     * filter/sort change (`reset`, offset 0) and when the lazy sentinel scrolls
     * in. Column filters go to the SERVER — the grid used to apply them in
     * memory over a single 200-row page.
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
        // The report's drill-in (`?definitionId=` / `?state=`) still layers
        // under the grid's own column filters.
        const params = this.route.snapshot.queryParamMap;

        this.cockpit
            .listInstancesPage({
                page,
                perPage: PAGE_SIZE,
                ...(event.sort ? { sort: event.sort } : {}),
                definitionId: params.get('definitionId') ?? undefined,
                state: params.get('state') ?? undefined,
                ...this.toQueryFilters(event.activeFilters),
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: result => {
                    // Filter changes land out of order otherwise, showing rows
                    // for a filter the user has already moved off.
                    if (epoch !== this.loadEpoch) return;

                    const mapped = result.items.map(r => this.toRow(r));
                    this.rows.set(event.reset ? mapped : [...this.rows(), ...mapped]);
                    this.totalItems.set(result.totalItems);
                    this.loaded.set(true);
                    if (event.reset) this.selectedRow.set(null);
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
     * params. Like the Definitions catalog (#1654) and unlike the RQL-native
     * endpoints, this provider takes named params — it reads a projected view
     * built by `CockpitQueryService`, not a plain Doctrine entity.
     *
     * `state` is multi-select; the endpoint takes a comma-separated list.
     * An unmapped column is ignored rather than guessed at.
     */
    private toQueryFilters(filters: ReadonlyArray<ActiveFilter>): {
        state?:       string;
        definition?:  string;
        businessKey?: string;
        startedFrom?: string;
        startedTo?:   string;
    } {
        const out: {
            state?: string; definition?: string; businessKey?: string;
            startedFrom?: string; startedTo?: string;
        } = {};

        for (const f of filters) {
            switch (f.column) {
                case 'state':       out.state = decodeTokens(f.value).join(','); break;
                case 'definition':  out.definition = f.value; break;
                case 'businessKey': out.businessKey = f.value; break;
                case 'startedAt':
                    // The date-range picker emits a ge/le PAIR on one column.
                    if (f.op === 'ge') out.startedFrom = f.value;
                    if (f.op === 'le') out.startedTo = f.value;
                    break;
            }
        }

        return out;
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.load(); return; }
        // Jump to the aggregate operator report (M4.d).
        if (id === 'report') { void this.router.navigate(['/cockpit', 'report']); return; }
        // Export the currently-loaded (filtered) instances as CSV (M4.e).
        if (id === 'export') { this.exportCsv(); return; }
        // Selection-gated Open drills into the read-only instance detail (M4.b).
        if (id === 'open') {
            const id2 = this.selectedRow()?.['id'];
            if (id2) void this.router.navigate(['/cockpit', String(id2)]);
        }
    }

    /**
     * M4.e — client-side CSV export of the LOADED instance rows.
     *
     * With lazy paging (#1659) "loaded" is what the operator has scrolled
     * through, not the whole filtered set — so when it covers less than the
     * server's total we SAY SO rather than hand over a silently partial file.
     * Exporting the full set would need the export to page the endpoint
     * itself; until then, an honest warning beats a quiet truncation.
     */
    private exportCsv(): void {
        const rows = this.rows();
        if (rows.length === 0) {
            this.toast.error('No process instances to export.');
            return;
        }

        const total = this.totalItems();
        if (rows.length < total) {
            this.toast.error(
                `Exporting the ${rows.length} loaded instance${rows.length === 1 ? '' : 's'} of ${total} matching — `
                + 'scroll to load more before exporting the full set.',
            );
        }

        const header = ['State', 'Definition', 'Business key', 'Started', 'Completed', 'Instance id'];
        const lines = [header, ...rows.map(r => [
            r.state,
            r.definition,
            r.businessKey,
            r.startedAt ?? '',
            r.completedAt ?? '',
            r.id,
        ])];
        const csv = lines
            .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cockpit-instances-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action === 'open') {
            const id = event.row['id'];
            if (id) void this.router.navigate(['/cockpit', String(id)]);
        }
    }

    /**
     * Re-runs the current query from page 1, KEEPING the grid's active filters
     * and sort — the grid owns that state now, so it must drive the refetch.
     */
    private load(): void {
        this.selectedRow.set(null);
        this.grid?.reload();
    }

    private toRow(i: CockpitInstanceDto): CockpitRow {
        return {
            id: i.id,
            state: i.state,
            definition: i.definitionName ?? i.definitionKey ?? '—',
            businessKey: i.businessKey ?? '—',
            startedAt: i.startedAt,
            completedAt: i.completedAt,
        };
    }
}
