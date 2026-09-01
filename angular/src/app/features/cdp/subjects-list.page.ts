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
import { CdpService } from './cdp.service';
import { SubjectDto } from './cdp.types';

/** Rows per server page. */
const PAGE_SIZE = 50;

/** Projected grid row (id = the durable subject key). */
interface SubjectRow {
    id: string;
    key: string;
    kind: string;
    events: number;
    segments: string;
    lastSeen: string | null;
}

/**
 *Phase 3 (CDP core, ) — Subject profile explorer
 * (`/admin/cdp/subjects`).
 *
 * Platform list-page shell (`<cms-list-page>` + `<coolms-datagrid>` driven by the
 * `analytics:subjects` config YAML): sortable columns, per-column filter row, the
 * row count in the FOOTER (bottom-left), platform toolbar buttons. The list is
 * read-only (a Subject is derived from the event stream, never hand-edited); row
 * Open drills into {@link ../cdp/subject-detail.page.SubjectDetailPageComponent}.
 *
 * `loadingMode: lazy`: the grid emits `(loadMore)` on mount and on
 * every filter/sort/page change, and this page turns that into ONE server
 * request. It used to be `client` — the page fetched EVERY subject (one row per
 * visitor) and the grid filtered that in the browser.
 *
 * The segment "View members" deep-link (`?segment=<key>`) travels as its own
 * query param and composes with the grid's own Segments filter.
 */
@Component({
    selector: 'coolms-cdp-subjects',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Subjects"
            icon="person-bounding-box"
            [subtitle]="subtitle()"
            toolbarTreeSlug="navi.toolbar.analytics.subjects"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="analytics:subjects"
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
export class SubjectsListPageComponent implements OnInit {
    /** The toolbar Reload action re-runs the grid's current query. */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

    private readonly api        = inject(CdpService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    private readonly rows = signal<SubjectRow[]>([]);

    /** Server's count for the CURRENT filter — drives the footer and `hasMore`. */
    readonly totalItems = signal(0);
    /** Flips true after the first response (success OR error). */
    readonly loaded = signal(false);
    readonly segment = signal('');
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

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

    /** Subtitle notes the active segment scope (from the "View members" deep-link). */
    readonly subtitle = computed(() => {
        const scope = this.segment() ? ` in "${this.segment()}"` : '';
        return `Derived profiles${scope} — counts only, no PII`;
    });

    /**
     * Footer row-count strip (bottom-left). `totalItems` is the SERVER's count
     * for the active filter, so it needs no client-side adjustment — a
     * consequence of filtering server-side.
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) {
            return '';
        }
        const n = this.totalItems();
        return n === 0 ? '' : `${n} subject${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Customer Data — Subjects');

        // Re-fetch when the "View members" deep-link changes. The FIRST load is
        // the grid's own `(loadMore)` on mount, so skip the initial emission
        // rather than racing it.
        let first = true;
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                this.segment.set(params.get('segment') ?? '');
                if (first) { first = false; return; }
                this.load();
            });
    }

    /**
     * The one place subjects are fetched. Fired by the grid on mount, on every
     * filter/sort change (`reset`, offset 0) and when the lazy sentinel scrolls
     * in. Column filters go to the SERVER as RQL, verbatim — including the
     * Segments multi-select, which the provider lifts out of the query and
     * turns into a JSON membership test.
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

        this.api
            .listSubjectsPage({
                page,
                perPage: PAGE_SIZE,
                ...(event.sort ? { sort: event.sort } : {}),
                filters: [...event.columnFilters],
                ...(this.segment() ? { segment: this.segment() } : {}),
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: result => {
                    // Filter changes land out of order otherwise.
                    if (epoch !== this.loadEpoch) return;

                    const mapped = result.items.map(s => this.toRow(s));
                    this.rows.set(event.reset ? mapped : [...this.rows(), ...mapped]);
                    this.totalItems.set(result.totalItems);
                    if (event.reset) {
                        this.selectedRow.set(null);
                    }
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

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.load(); return; }
        if (id === 'open') {
            const key = this.selectedRow()?.['id'];
            if (key) {
                void this.router.navigate(['/cdp/subjects', String(key)]);
            }
        }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action === 'open') {
            const key = event.row['id'];
            if (key) {
                void this.router.navigate(['/cdp/subjects', String(key)]);
            }
        }
    }

    /**
     * Re-runs the current query from page 1, KEEPING the grid's active filters
     * and sort — the grid owns that state now, so it must drive the refetch.
     */
    private load(): void {
        this.grid?.reload();
    }

    private toRow(s: SubjectDto): SubjectRow {
        return {
            id: s.key,
            key: s.key,
            kind: s.kind,
            events: s.totalEvents || s.eventCount,
            segments: s.segments.length > 0 ? s.segments.join(', ') : '—',
            lastSeen: s.lastSeen,
        };
    }
}
