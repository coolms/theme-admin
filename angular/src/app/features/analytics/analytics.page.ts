import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
    CmsPageHeaderComponent,
    LayoutActionsService,
    PageTitleService,
    TabStripComponent,
    TabStripItem,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ConfigService, type LayoutConfig } from '@coolms/core-angular';
import { AnalyticsService, EventSummaryDto, SearchQueryStatDto, TopPageDto } from './analytics.service';

/** How many rows each section asks the backend for (its own max is 100). */
const ROW_LIMIT = 20;

/**
 * W8 — Analytics dashboard admin page (/admin/analytics).
 *
 * One read-only privacy-first dashboard over a shared day-window (7 / 30 / 90
 * days), surfacing four consent-gated aggregate ledgers via
 * {@link AnalyticsService}:
 *
 *  0. **Event stream** — per-type totals over the genericstore
 *: the unified, consent-gated eventthe legacy
 *     page-view / search ledgers will eventually graduate onto. Lead card.
 *  1. **Top pages** — the page-view leaderboard: normalized path + count.
 *  2. **Top searches** — the most-run search terms: term + count.
 *  3. **Content gaps** — searches that returned nothing: the actionable
 *     "what to write next" list, styled distinctly (amber) to stand apart from
 *     the two traffic leaderboards.
 *
 * Every section is a proportional bar list; none has per-row actions (each row
 * is an immutable, anonymous aggregate count). The three loads run in parallel
 * and degrade independently — onefailing (e.g. a not-yet-migrated
 * search module) leaves the others working, with the failed section showing a
 * "couldn't load" note rather than blanking the page.
 *
 * Mirrors the W7.d moderation page and W8.c lead inbox (the day-range selector
 * stands in for their status tabs).
 */
@Component({
    selector: 'coolms-admin-analytics',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent, TabStripComponent],
    template: `
        <cms-page-header
            icon="bar-chart-line"
            [title]="'Analytics'"
            [subtitle]="subtitle()"
            [actions]="headerActions()"
            (actionClick)="onHeaderAction($event)">
        </cms-page-header>

        <div class="cms-analytics">
            <app-tab-strip
                [tabs]="tabs"
                [activeId]="activeRange()"
                (selected)="selectRange($any($event))" />

            <!-- 0. Event stream — the unified:
                 per-type totals over the generic store the legacy page-view /
                 search ledgers will eventually graduate onto. -->
            <section class="cms-analytics__card">
                <header class="cms-analytics__card-head">
                    <h2 class="cms-analytics__card-title">
                        <i class="bi bi-activity"></i><span>Event stream</span>
                    </h2>
                    <span class="cms-analytics__total">{{ eventsTotalLabel() }}</span>
                </header>
                <p class="cms-analytics__lede">
                    Every captured analytics event, grouped by type — the unified, consent-gated stream behind the dashboard.
                </p>

                @if (loading()) {
                    <p class="cms-analytics__hint">Loading events…</p>
                } @else if (eventsError()) {
                    <p class="cms-analytics__error"><i class="bi bi-exclamation-circle"></i> Couldn't load the event stream.</p>
                } @else if (events().length === 0) {
                    <div class="cms-analytics__empty">
                        <i class="bi bi-activity"></i>
                        <p>No analytics events recorded in this window yet.</p>
                    </div>
                } @else {
                    <ol class="cms-analytics__list">
                        @for (e of events(); track e.type) {
                            <li class="cms-analytics__row">
                                <span class="cms-analytics__label" [title]="e.type">{{ e.type }}</span>
                                <span class="cms-analytics__bar-wrap">
                                    <span class="cms-analytics__bar"
                                          [style.width.%]="barWidth(e.count, maxEventCount())"></span>
                                </span>
                                <span class="cms-analytics__count">{{ e.count }}</span>
                            </li>
                        }
                    </ol>
                }
            </section>

            <!-- 1. Top pages — page-view leaderboard -->
            <section class="cms-analytics__card">
                <header class="cms-analytics__card-head">
                    <h2 class="cms-analytics__card-title">
                        <i class="bi bi-bar-chart-line"></i><span>Top pages</span>
                    </h2>
                    <span class="cms-analytics__total">{{ pagesTotalLabel() }}</span>
                </header>

                @if (loading()) {
                    <p class="cms-analytics__hint">Loading page views…</p>
                } @else if (pagesError()) {
                    <p class="cms-analytics__error"><i class="bi bi-exclamation-circle"></i> Couldn't load page views.</p>
                } @else if (pages().length === 0) {
                    <div class="cms-analytics__empty">
                        <i class="bi bi-graph-up"></i>
                        <p>No page views recorded in this window yet.</p>
                    </div>
                } @else {
                    <ol class="cms-analytics__list">
                        @for (p of pages(); track p.path) {
                            <li class="cms-analytics__row">
                                <span class="cms-analytics__label" [title]="p.path">{{ p.path }}</span>
                                <span class="cms-analytics__bar-wrap">
                                    <span class="cms-analytics__bar"
                                          [style.width.%]="barWidth(p.views, maxViews())"></span>
                                </span>
                                <span class="cms-analytics__count">{{ p.views }}</span>
                            </li>
                        }
                    </ol>
                }
            </section>

            <!-- 2. Top searches — most-run query terms -->
            <section class="cms-analytics__card">
                <header class="cms-analytics__card-head">
                    <h2 class="cms-analytics__card-title">
                        <i class="bi bi-search"></i><span>Top searches</span>
                    </h2>
                    <span class="cms-analytics__total">{{ queriesTotalLabel() }}</span>
                </header>

                @if (loading()) {
                    <p class="cms-analytics__hint">Loading search queries…</p>
                } @else if (queriesError()) {
                    <p class="cms-analytics__error"><i class="bi bi-exclamation-circle"></i> Couldn't load search queries.</p>
                } @else if (topQueries().length === 0) {
                    <div class="cms-analytics__empty">
                        <i class="bi bi-search"></i>
                        <p>No on-site searches recorded in this window yet.</p>
                    </div>
                } @else {
                    <ol class="cms-analytics__list">
                        @for (q of topQueries(); track q.term) {
                            <li class="cms-analytics__row">
                                <span class="cms-analytics__label" [title]="q.term">{{ q.term }}</span>
                                <span class="cms-analytics__bar-wrap">
                                    <span class="cms-analytics__bar"
                                          [style.width.%]="barWidth(q.searches, maxQuerySearches())"></span>
                                </span>
                                <span class="cms-analytics__count">{{ q.searches }}</span>
                            </li>
                        }
                    </ol>
                }
            </section>

            <!-- 3. Content gaps — zero-result searches. The actionable
                 "what to write next" list — styled amber to stand apart. -->
            <section class="cms-analytics__card cms-analytics__card--gap">
                <header class="cms-analytics__card-head">
                    <h2 class="cms-analytics__card-title">
                        <i class="bi bi-exclamation-triangle"></i><span>Content gaps</span>
                        <span class="cms-analytics__chip">No results</span>
                    </h2>
                    <span class="cms-analytics__total">{{ zeroTotalLabel() }}</span>
                </header>
                <p class="cms-analytics__lede">
                    Searches that returned nothing — the content visitors are looking for but can't find.
                </p>

                @if (loading()) {
                    <p class="cms-analytics__hint">Loading content gaps…</p>
                } @else if (zeroError()) {
                    <p class="cms-analytics__error"><i class="bi bi-exclamation-circle"></i> Couldn't load content gaps.</p>
                } @else if (zeroQueries().length === 0) {
                    <div class="cms-analytics__empty">
                        <i class="bi bi-check2-circle"></i>
                        <p>No empty searches — every query found something.</p>
                    </div>
                } @else {
                    <ol class="cms-analytics__list">
                        @for (q of zeroQueries(); track q.term) {
                            <li class="cms-analytics__row">
                                <span class="cms-analytics__label" [title]="q.term">{{ q.term }}</span>
                                <span class="cms-analytics__bar-wrap">
                                    <span class="cms-analytics__bar cms-analytics__bar--gap"
                                          [style.width.%]="barWidth(q.searches, maxZeroSearches())"></span>
                                </span>
                                <span class="cms-analytics__count">{{ q.searches }}</span>
                            </li>
                        }
                    </ol>
                }
            </section>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-analytics {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            padding: 1rem;
            overflow-y: auto;
        }
        .cms-analytics__card {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface, #fff);
            padding: 0.875rem 1rem;
            max-width: 52rem;
        }
        /* Content-gap card: amber accent so the "what to write next" list
           reads as distinct from the two neutral traffic leaderboards. */
        .cms-analytics__card--gap {
            border-color: var(--cms-warning-subtle-border, #fcd34d);
            background: var(--cms-warning-light, #fffbeb);
        }
        .cms-analytics__card-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
        }
        .cms-analytics__card-title {
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            margin: 0;
            font-size: 1rem;
            color: var(--cms-text, #111827);
        }
        .cms-analytics__card--gap .cms-analytics__card-title .bi { color: var(--cms-warning, #d97706); }
        .cms-analytics__chip {
            font-size: 0.68rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            padding: 0.1rem 0.45rem;
            border-radius: 999px;
            background: var(--cms-warning, #d97706);
            color: var(--cms-text-inverse);
        }
        .cms-analytics__lede {
            margin: -0.4rem 0 0.75rem;
            font-size: 0.82rem;
            color: var(--cms-text-muted, #848b96);
        }
        .cms-analytics__total { font-size: 0.8rem; color: var(--cms-text-muted, #848b96); }
        .cms-analytics__hint,
        .cms-analytics__empty { color: var(--cms-text-muted, #848b96); }
        .cms-analytics__error { color: var(--cms-danger, #dc2626); font-size: 0.88rem; }
        .cms-analytics__empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            padding: 3rem 1rem;
            text-align: center;
        }
        .cms-analytics__empty .bi { font-size: 2rem; }
        .cms-analytics__list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .cms-analytics__row {
            display: grid;
            grid-template-columns: minmax(0, 18rem) 1fr auto;
            align-items: center;
            gap: 0.75rem;
        }
        .cms-analytics__label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--cms-text, #111827);
            font-size: 0.9rem;
        }
        .cms-analytics__bar-wrap {
            height: 0.6rem;
            border-radius: 999px;
            background: var(--cms-surface-muted, #f3f4f6);
            overflow: hidden;
        }
        .cms-analytics__bar {
            display: block;
            height: 100%;
            min-width: 2px;
            border-radius: 999px;
            background: var(--cms-primary, #2563eb);
        }
        .cms-analytics__bar--gap { background: var(--cms-warning, #d97706); }
        .cms-analytics__count {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            color: var(--cms-text, #111827);
            min-width: 2.5rem;
            text-align: right;
        }
    `],
})
export class AnalyticsPageComponent implements OnInit {
    private readonly api        = inject(AnalyticsService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`analytics:dashboard` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);

    // Range selector rendered via the shared <app-tab-strip> (ids are the day
    // window as a string, matching the tab-strip's string-id contract).
    readonly tabs: TabStripItem[] = [
        { id: '7',  label: 'Last 7 days' },
        { id: '30', label: 'Last 30 days' },
        { id: '90', label: 'Last 90 days' },
    ];

    readonly days    = signal(30);
    readonly loading = signal(true);

    /** The active day-window as a string id for <app-tab-strip>. */
    readonly activeRange = computed(() => String(this.days()));

    readonly events      = signal<EventSummaryDto[]>([]);
    readonly pages       = signal<TopPageDto[]>([]);
    readonly topQueries  = signal<SearchQueryStatDto[]>([]);
    readonly zeroQueries = signal<SearchQueryStatDto[]>([]);

    // Per-section load flags — onefailing must not blank the others.
    readonly eventsError  = signal(false);
    readonly pagesError   = signal(false);
    readonly queriesError = signal(false);
    readonly zeroError    = signal(false);

    /** Biggest count in each list — the 100%-width reference for that list's bars. */
    readonly maxEventCount    = computed(() => this.peak(this.events(),      e => e.count));
    readonly maxViews         = computed(() => this.peak(this.pages(),       p => p.views));
    readonly maxQuerySearches = computed(() => this.peak(this.topQueries(),  q => q.searches));
    readonly maxZeroSearches  = computed(() => this.peak(this.zeroQueries(), q => q.searches));

    readonly subtitle = computed(() =>
        this.loading() ? 'Loading…' : `Events, traffic & search over the last ${this.days()} days`);

    readonly eventsTotalLabel  = computed(() => this.sumLabel(this.events(),      e => e.count,    'event'));
    readonly pagesTotalLabel   = computed(() => this.sumLabel(this.pages(),       p => p.views,    'view'));
    readonly queriesTotalLabel = computed(() => this.sumLabel(this.topQueries(),  q => q.searches, 'search'));
    readonly zeroTotalLabel    = computed(() => this.sumLabel(this.zeroQueries(), q => q.searches, 'empty search'));

    /** Declared in the `analytics:dashboard` layout, not here. */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('analytics:dashboard').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.titleSvc.set('Analytics');
        this.load();
    }

    onHeaderAction(id: string): void {
        if (id === 'refresh') this.load();
    }

    selectRange(id: string): void {
        const days = Number(id);
        if (this.days() === days) return;
        this.days.set(days);
        this.load();
    }

    /** Bar width as a percentage of the busiest row in its list (always ≥ a sliver). */
    barWidth(value: number, max: number): number {
        return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    }

    private load(): void {
        this.loading.set(true);
        this.eventsError.set(false);
        this.pagesError.set(false);
        this.queriesError.set(false);
        this.zeroError.set(false);

        const days = this.days();
        // Each stream catches its own failure so the others still render; a
        // failed section flips its error flag instead of rejecting the join.
        forkJoin({
            events: this.api.eventSummary(days).pipe(
                catchError(() => { this.eventsError.set(true); return of([] as EventSummaryDto[]); })),
            pages: this.api.topPages(days, ROW_LIMIT).pipe(
                catchError(() => { this.pagesError.set(true); return of([] as TopPageDto[]); })),
            queries: this.api.topQueries(days, ROW_LIMIT).pipe(
                catchError(() => { this.queriesError.set(true); return of([] as SearchQueryStatDto[]); })),
            zero: this.api.zeroResultQueries(days, ROW_LIMIT).pipe(
                catchError(() => { this.zeroError.set(true); return of([] as SearchQueryStatDto[]); })),
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(({ events, pages, queries, zero }) => {
            this.events.set(events);
            this.pages.set(pages);
            this.topQueries.set(queries);
            this.zeroQueries.set(zero);
            this.loading.set(false);
            if (this.eventsError() || this.pagesError() || this.queriesError() || this.zeroError()) {
                this.toast.error('Some analytics could not be loaded');
            }
        });
    }

    private peak<T>(rows: readonly T[], pick: (row: T) => number): number {
        return rows.reduce((max, r) => Math.max(max, pick(r)), 0);
    }

    private sumLabel<T>(rows: readonly T[], pick: (row: T) => number, noun: string): string {
        const total = rows.reduce((sum, r) => sum + pick(r), 0);
        return `${total} ${noun}${total === 1 ? '' : 's'}`;
    }
}
