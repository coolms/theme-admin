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
import { Router, RouterLink } from '@angular/router';

import {
    CmsPageHeaderComponent,
    EmptyStateComponent,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import { CockpitService } from './cockpit.service';
import type { CockpitDefinitionStatDto, CockpitReportDto, CockpitTaskMetricsDto } from './cockpit.types';

/** One KPI tile (a lifecycle-state count). */
interface StateTile {
    state: string;
    label: string;
    count: number;
    badgeClass: string;
}

/**
 * M4.d — Process Cockpit aggregate report (`/admin/cockpit/report`).
 *
 * The read-side complement to M4.c steering: an operator dashboard over
 * `GET /api/v1/cockpit/report` (ROLE_ADMIN) — platform-wide instance counts
 * by lifecycle state (KPI tiles), rolling throughput windows (24h / 7d /
 * 30d started vs completed), and a per-definition state breakdown table
 * (busiest first; each row drills into the filtered instance list).
 *
 * Read-only; mirrors the detail page's three-state shell + card styling.
 */
@Component({
    selector: 'app-cockpit-report-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, CmsPageHeaderComponent, LoadingComponent, ErrorBannerComponent, EmptyStateComponent],
    template: `
        <cms-page-header
            title="Process report"
            icon="graph-up"
            subtitle="Aggregate metrics across all workflow process instances"
            [actions]="headerActions()"
            (actionClick)="onAction($event)" />

        @if (loading()) {
            <app-loading label="Loading report…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" [showRetry]="true" (retry)="load()" />
        } @else if (report()) {
            @let r = report()!;

            <div class="detail-page">

                <!-- KPI tiles: total + per-state counts -->
                <section class="tiles">
                    <a class="tile tile--total" routerLink="/cockpit">
                        <span class="tile__count">{{ r.total }}</span>
                        <span class="tile__label">Total instances</span>
                    </a>
                    @for (t of stateTiles(); track t.state) {
                        <a class="tile" [routerLink]="['/cockpit']" [queryParams]="{ state: t.state }">
                            <span class="tile__count">{{ t.count }}</span>
                            <span class="tile__label">
                                <span class="dot" [class]="t.badgeClass"></span>{{ t.label }}
                            </span>
                        </a>
                    }
                </section>

                <!-- Throughput -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Throughput</h2></header>
                    <div class="card__body">
                        <table class="tbl">
                            <thead>
                                <tr><th></th><th>Last 24h</th><th>Last 7 days</th><th>Last 30 days</th></tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="row-head">Started</td>
                                    <td>{{ r.throughput.started24h }}</td>
                                    <td>{{ r.throughput.started7d }}</td>
                                    <td>{{ r.throughput.started30d }}</td>
                                </tr>
                                <tr>
                                    <td class="row-head">Completed</td>
                                    <td>{{ r.throughput.completed24h }}</td>
                                    <td>{{ r.throughput.completed7d }}</td>
                                    <td>{{ r.throughput.completed30d }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <!-- Task health (M4.k): the task-level complement to the process
                     metrics above. Loaded independently, so it degrades to a
                     hidden section if /cockpit/task-metrics fails. -->
                @if (taskMetrics(); as tm) {
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">Task health</h2>
                            <span class="count">{{ tm.total }}</span>
                            <span class="avg-note">user tasks across all workflows</span>
                        </header>
                        <div class="card__body">
                            <div class="tiles tiles--tight">
                                <div class="tile tile--static">
                                    <span class="tile__count">{{ tm.openTotal }}</span>
                                    <span class="tile__label">Open (pending + assigned)</span>
                                </div>
                                <div class="tile tile--static" [class.tile--alert]="tm.overdueCount > 0">
                                    <span class="tile__count">{{ tm.overdueCount }}</span>
                                    <span class="tile__label">
                                        <span class="dot badge--danger"></span>Overdue
                                    </span>
                                </div>
                                <div class="tile tile--static">
                                    <span class="tile__count">{{ formatDuration(tm.avgQueueSeconds) }}</span>
                                    <span class="tile__label">Avg wait to claim</span>
                                </div>
                                <div class="tile tile--static">
                                    <span class="tile__count">{{ formatDuration(tm.avgCycleSeconds) }}</span>
                                    <span class="tile__label">Avg time to complete</span>
                                </div>
                            </div>

                            <div class="state-row">
                                @for (t of taskStateTiles(); track t.state) {
                                    <span class="state-chip">
                                        <span class="dot" [class]="t.badgeClass"></span>{{ t.label }}
                                        <span class="state-chip__count">{{ t.count }}</span>
                                    </span>
                                }
                            </div>

                            <table class="tbl tbl--mt">
                                <thead>
                                    <tr><th></th><th>Last 24h</th><th>Last 7 days</th><th>Last 30 days</th></tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td class="row-head">Completed</td>
                                        <td>{{ tm.completed24h }}</td>
                                        <td>{{ tm.completed7d }}</td>
                                        <td>{{ tm.completed30d }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                }

                <!-- Per-definition breakdown -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">By definition</h2>
                        <span class="count">{{ r.definitions.length }}</span>
                        @if (r.avgDurationSeconds !== null) {
                            <span class="avg-note">avg completion {{ formatDuration(r.avgDurationSeconds) }}</span>
                        }
                    </header>
                    <div class="card__body">
                        @if (r.definitions.length === 0) {
                            <app-empty-state icon="diagram-3"
                                             title="No process instances yet"
                                             hint="Per-definition counts will appear here once a workflow runs." />
                        } @else {
                            <table class="tbl">
                                <thead>
                                    <tr>
                                        <th>Definition</th>
                                        <th class="num">Total</th>
                                        <th class="num">Running</th>
                                        <th class="num">Suspended</th>
                                        <th class="num">Completed</th>
                                        <th class="num">Failed</th>
                                        <th class="num">Cancelled</th>
                                        <th class="num">Avg duration</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (d of r.definitions; track d.definitionId) {
                                        <tr class="def-row" (click)="openDefinition(d)">
                                            <td>
                                                <span class="def-name">{{ definitionLabel(d) }}</span>
                                                @if (d.definitionKey) {
                                                    <span class="def-key mono">{{ d.definitionKey }}</span>
                                                }
                                            </td>
                                            <td class="num strong">{{ d.total }}</td>
                                            <td class="num">{{ d.running || '—' }}</td>
                                            <td class="num">{{ d.suspended || '—' }}</td>
                                            <td class="num">{{ d.completed || '—' }}</td>
                                            <td class="num">{{ d.failed || '—' }}</td>
                                            <td class="num">{{ d.cancelled || '—' }}</td>
                                            <td class="num">{{ formatDuration(d.avgDurationSeconds) }}</td>
                                            <td class="num">
                                                <a class="timing-link" (click)="openTiming(d, $event)"
                                                   title="Per-element timing / bottlenecks">
                                                    <i class="bi bi-stopwatch"></i> Timing
                                                </a>
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    </div>
                </section>

            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .detail-page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        .tiles {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px; margin-bottom: 16px;
        }
        .tile {
            display: flex; flex-direction: column; gap: 4px;
            background: var(--cms-surface, #fff); border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 8px; padding: 14px 16px; text-decoration: none; color: inherit;
            transition: border-color .12s, box-shadow .12s;
        }
        .tile:hover { border-color: var(--cms-accent, #2563eb); box-shadow: 0 1px 4px rgba(0,0,0,.06); }
        .tile--total { background: var(--cms-surface-muted); }
        .tile__count { font-size: 1.6rem; font-weight: 700; line-height: 1; }
        .tile__label {
            font-size: .78rem; color: var(--cms-text-muted, #6b7280);
            display: inline-flex; align-items: center; gap: 6px;
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--cms-text-muted); }
        .dot.badge--success { background: var(--cms-success); }
        .dot.badge--info    { background: var(--cms-info); }
        .dot.badge--danger  { background: var(--cms-danger); }
        .dot.badge--muted   { background: var(--cms-text-muted); }
        .dot.badge--warning { background: var(--cms-warning); }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 8px; margin-bottom: 16px; overflow: hidden;
        }
        .card__head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface-muted);
        }
        .card__title { margin: 0; font-size: .9rem; font-weight: 600; }
        .count {
            font-size: .7rem; padding: 1px 7px; border-radius: 999px;
            background: var(--cms-border, #e5e7eb); color: var(--cms-text-muted, #6b7280);
        }
        .avg-note { font-size: .75rem; color: var(--cms-text-muted, #6b7280); margin-left: auto; }
        .card__body { padding: 12px 16px; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }

        .tbl { width: 100%; border-collapse: collapse; font-size: .85rem; }
        .tbl th {
            text-align: left; font-weight: 600; color: var(--cms-text-muted, #6b7280);
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #e5e7eb); white-space: nowrap;
        }
        .tbl td {
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #f1f5f9); vertical-align: top;
        }
        .tbl tr:last-child td { border-bottom: none; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .strong { font-weight: 600; }
        .row-head { color: var(--cms-text-muted, #6b7280); font-weight: 500; }

        .def-row { cursor: pointer; }
        .def-row:hover td { background: var(--cms-surface-muted); }
        .def-name { font-weight: 500; }
        .def-key { display: block; color: var(--cms-text-muted, #6b7280); }

        .timing-link {
            display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
            color: var(--cms-accent, #2563eb); font-size: .8rem; white-space: nowrap;
        }
        .timing-link:hover { text-decoration: underline; }

        /* Task health (M4.k) — display-only metric tiles + state chips. */
        .tiles--tight { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); margin-bottom: 12px; }
        .tile--static { cursor: default; }
        .tile--static:hover { border-color: var(--cms-border, #e5e7eb); box-shadow: none; }
        .tile--alert .tile__count { color: var(--cms-danger, #dc2626); }
        .state-row { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 2px 0 4px; }
        .state-chip {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: .8rem; color: var(--cms-text-muted, #6b7280);
        }
        .state-chip__count { font-weight: 600; color: var(--cms-text, inherit); font-variant-numeric: tabular-nums; }
        .tbl--mt { margin-top: 4px; }
    `],
})
export class CockpitReportPageComponent implements OnInit {
    private readonly layoutActions = inject(LayoutActionsService);
    private readonly cockpit    = inject(CockpitService);
    private readonly router     = inject(Router);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly toast      = inject(ToastService);

    /** Backend-defined page chrome (`cockpit:report` layout config). */
    readonly layout  = signal<LayoutConfig | null>(null);

    readonly report  = signal<CockpitReportDto | null>(null);
    /** M4.k — supplementary; null when the metrics endpoint fails (section hidden). */
    readonly taskMetrics = signal<CockpitTaskMetricsDto | null>(null);
    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);

    /**
     * Header actions (back to the cockpit + reload) — declared in the
     * `cockpit:report` layout config (ADR-127), not hardcoded.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    /** Per-state KPI tiles, in a fixed, readable order. */
    readonly stateTiles = computed<StateTile[]>(() => {
        const counts = this.report()?.stateCounts ?? {};
        const order: Array<{ state: string; label: string; badgeClass: string }> = [
            { state: 'running',   label: 'Running',   badgeClass: 'badge--success' },
            { state: 'suspended', label: 'Suspended', badgeClass: 'badge--warning' },
            { state: 'completed', label: 'Completed', badgeClass: 'badge--info' },
            { state: 'failed',    label: 'Failed',    badgeClass: 'badge--danger' },
            { state: 'cancelled', label: 'Cancelled', badgeClass: 'badge--muted' },
        ];
        return order.map(o => ({ ...o, count: counts[o.state] ?? 0 }));
    });

    /** M4.k — per-task-state chips, in a fixed lifecycle order. */
    readonly taskStateTiles = computed<StateTile[]>(() => {
        const counts = this.taskMetrics()?.stateCounts ?? {};
        const order: Array<{ state: string; label: string; badgeClass: string }> = [
            { state: 'pending',   label: 'Pending',   badgeClass: 'badge--warning' },
            { state: 'assigned',  label: 'Assigned',  badgeClass: 'badge--info' },
            { state: 'completed', label: 'Completed', badgeClass: 'badge--success' },
            { state: 'cancelled', label: 'Cancelled', badgeClass: 'badge--muted' },
        ];
        return order.map(o => ({ ...o, count: counts[o.state] ?? 0 }));
    });

    ngOnInit(): void {
        // Page chrome (header actions) is backend-defined; fetch once (cached).
        this.config.layout('cockpit:report').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });

        this.titleSvc.set('Process report');
        this.load();
    }

    onAction(actionId: string): void {
        if (actionId === 'back')   { void this.router.navigate(['/cockpit']); return; }
        if (actionId === 'reload') { this.load(); return; }
        if (actionId === 'export') this.exportCsv();
    }

    /**
     * M4.c+ — fetch the per-definition report as CSV from
     * `GET /cockpit/reports/export?kind=definitions` and download it
     * client-side (the JSON-envelope download pattern: the Bearer-authed SPA
     * can't do a raw `<a download>`, so the backend hands back the CSV body
     * and we make the blob here).
     */
    private exportCsv(): void {
        this.cockpit
            .exportReport('definitions')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => this.downloadCsv(res.filename, res.csv),
                error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
            });
    }

    private downloadCsv(filename: string, csv: string): void {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'cockpit-report.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    /** Drill into the instance list filtered to this definition. */
    openDefinition(d: CockpitDefinitionStatDto): void {
        void this.router.navigate(['/cockpit'], { queryParams: { definitionId: d.definitionId } });
    }

    /** Drill into the per-element bottleneck / timing report (M4.g). */
    openTiming(d: CockpitDefinitionStatDto, ev: Event): void {
        ev.stopPropagation(); // don't also trigger the row's instance-list drill-in
        void this.router.navigate(['/cockpit/definitions', d.definitionId, 'timing']);
    }

    definitionLabel(d: CockpitDefinitionStatDto): string {
        return d.definitionName ?? d.definitionKey ?? d.definitionId.slice(0, 8);
    }

    /** Human-readable mean duration: "—" / "45s" / "12m 30s" / "3h 5m" / "2d 4h". */
    formatDuration(seconds: number | null | undefined): string {
        // `== null` catches both null and undefined — API Platform omits null
        // properties, so an absent avg arrives as undefined, not null.
        if (seconds == null || seconds < 0) return '—';
        if (seconds < 60) return `${seconds}s`;

        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
        if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }

    load(): void {
        this.loading.set(true);
        this.error.set(null);
        this.cockpit
            .getReport()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: r => {
                    this.report.set(r);
                    this.loading.set(false);
                },
                error: (e: unknown) => {
                    this.error.set(this.errors.humanize(e));
                    this.loading.set(false);
                },
            });

        // Task health (M4.k) loads independently: a failure here just hides the
        // section — it must never block or error the process report above.
        this.cockpit
            .getTaskMetrics()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: m => this.taskMetrics.set(m),
                error: () => this.taskMetrics.set(null),
            });
    }
}
