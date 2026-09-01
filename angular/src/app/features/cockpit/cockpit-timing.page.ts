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
import { ActivatedRoute, Router } from '@angular/router';
import { filter, switchMap } from 'rxjs';

import {
    CmsPageHeaderComponent,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import { CockpitService } from './cockpit.service';
import type { CockpitElementTimingDto, CockpitTimingReportDto } from './cockpit.types';

/**
 * M4.g — Process Cockpit per-definition bottleneck / timing report
 * (`/admin/cockpit/definitions/:definitionId/timing`).
 *
 * The deepest read-side slice of the Reporting leg: mines the engine's
 * `workflow.token.advanced` history to surface, per AST element, the mean +
 * max wall-clock "dwell" across every instance of the definition —
 * slowest-average first, so the operator reads the bottleneck off the top.
 * A relative bar visualises each element's avg dwell against the slowest.
 * Read-only; mirrors the report page's three-state shell + card styling.
 */
@Component({
    selector: 'app-cockpit-timing-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent, LoadingComponent, ErrorBannerComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading timing report…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else if (report()) {
            @let r = report()!;

            <cms-page-header
                [title]="'Timing · ' + definitionLabel(r)"
                icon="stopwatch"
                subtitle="Mean + max time each step holds a token, across all instances"
                [actions]="headerActions()"
                (actionClick)="onAction($event)" />

            <div class="detail-page">

                <!-- Summary -->
                <section class="card">
                    <div class="card__body">
                        <dl class="kv">
                            <dt>Definition</dt>
                            <dd>{{ r.definitionName ?? '—' }}</dd>
                            <dt>Definition key</dt>
                            <dd class="mono">{{ r.definitionKey ?? '—' }}</dd>
                            <dt>Instances</dt>
                            <dd>{{ r.instanceCount }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Per-element timing -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">Bottlenecks by element</h2>
                        <span class="count">{{ r.elements.length }}</span>
                    </header>
                    <div class="card__body">
                        @if (r.elements.length === 0) {
                            <p class="empty">
                                No timing data yet — an element accrues dwell only once a token has
                                advanced through it. Run some instances of this process to populate.
                            </p>
                        } @else {
                            <table class="tbl">
                                <thead>
                                    <tr>
                                        <th>Element</th>
                                        <th>Type</th>
                                        <th class="num">Avg dwell</th>
                                        <th class="num">Max dwell</th>
                                        <th class="num">Samples</th>
                                        <th class="bar-col">Relative</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (e of r.elements; track e.elementId) {
                                        <tr>
                                            <td>
                                                <span class="el-name">{{ e.elementLabel ?? e.elementId }}</span>
                                                @if (e.elementLabel) {
                                                    <span class="el-id mono">{{ e.elementId }}</span>
                                                }
                                            </td>
                                            <td>
                                                @if (e.elementKind) {
                                                    <span class="kind">{{ e.elementKind }}</span>
                                                } @else { — }
                                            </td>
                                            <td class="num strong">{{ formatDuration(e.avgDwellSeconds) }}</td>
                                            <td class="num">{{ formatDuration(e.maxDwellSeconds) }}</td>
                                            <td class="num">{{ e.sampleCount }}</td>
                                            <td class="bar-col">
                                                <span class="bar">
                                                    <span class="bar__fill" [style.width.%]="barWidth(e)"></span>
                                                </span>
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

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px); margin-bottom: 16px; overflow: hidden;
        }
        .card__head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface-muted);
        }
        .card__title { margin: 0; font-size: .9rem; font-weight: 600; }
        .count {
            font-size: .7rem; padding: 1px 7px; border-radius: 999px;
            background: var(--cms-border, #e5e7eb); color: var(--cms-text-muted, #848b96);
        }
        .card__body { padding: 12px 16px; }
        .empty { color: var(--cms-text-muted, #848b96); font-size: .85rem; margin: 0; }
        .mono { font-family: var(--cms-font-mono, monospace); font-size: .82rem; }

        .kv { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; font-size: .9rem; margin: 0; }
        .kv dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }
        .kv dd { margin: 0; word-break: break-all; }

        .tbl { width: 100%; border-collapse: collapse; font-size: .85rem; }
        .tbl th {
            text-align: left; font-weight: 600; color: var(--cms-text-muted, #848b96);
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #e5e7eb); white-space: nowrap;
        }
        .tbl td {
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #e5e7eb); vertical-align: middle;
        }
        .tbl tr:last-child td { border-bottom: none; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .strong { font-weight: 600; }

        .el-name { font-weight: 500; }
        .el-id { display: block; color: var(--cms-text-muted, #848b96); }
        .kind {
            font-size: .72rem; padding: 1px 8px; border-radius: 999px;
            background: var(--cms-border-light); color: var(--cms-text-secondary);
        }

        .bar-col { width: 180px; }
        .bar {
            display: block; height: 8px; border-radius: 999px;
            background: var(--cms-border, #e5e7eb); overflow: hidden;
        }
        .bar__fill { display: block; height: 100%; border-radius: 999px; background: var(--cms-accent, #F5A623); }
    `],
})
export class CockpitTimingPageComponent implements OnInit {
    private readonly layoutActions = inject(LayoutActionsService);
    private readonly cockpit    = inject(CockpitService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);

    /** Backend-defined page chrome (`cockpit:timing` layout config). */
    readonly layout  = signal<LayoutConfig | null>(null);

    readonly report  = signal<CockpitTimingReportDto | null>(null);
    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);

    /** Slowest avg dwell, for scaling the relative bars. */
    private readonly maxAvg = computed(() => {
        const els = this.report()?.elements ?? [];
        return els.reduce((m, e) => Math.max(m, e.avgDwellSeconds), 0);
    });

    /**
     * Header actions (back to the report + reload) — declared in the
     * `cockpit:timing` layout config (ADR-127), not hardcoded.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    ngOnInit(): void {
        // Page chrome (header actions) is backend-defined; fetch once (cached).
        this.config.layout('cockpit:timing').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });

        this.route.paramMap.pipe(
            filter(pm => !!pm.get('definitionId')),
            switchMap(pm => {
                this.titleSvc.set('Timing report');
                this.loading.set(true);
                this.error.set(null);
                return this.cockpit.getTiming(pm.get('definitionId')!);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: r => {
                this.report.set(r);
                this.titleSvc.set('Timing · ' + this.definitionLabel(r));
                this.loading.set(false);
            },
            error: (e: unknown) => {
                this.error.set(this.errors.humanize(e));
                this.loading.set(false);
            },
        });
    }

    onAction(actionId: string): void {
        if (actionId === 'back')   { void this.router.navigate(['/cockpit/report']); return; }
        if (actionId === 'reload') this.reload();
    }

    private reload(): void {
        const id = this.report()?.definitionId;
        if (!id) return;
        this.loading.set(true);
        this.cockpit.getTiming(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: r => { this.report.set(r); this.loading.set(false); },
            error: (e: unknown) => { this.error.set(this.errors.humanize(e)); this.loading.set(false); },
        });
    }

    /** Relative bar width (% of the slowest element's avg dwell). */
    barWidth(e: CockpitElementTimingDto): number {
        const max = this.maxAvg();
        if (max <= 0) return 0;
        return Math.max(2, Math.round((e.avgDwellSeconds / max) * 100));
    }

    definitionLabel(r: CockpitTimingReportDto): string {
        return r.definitionName ?? r.definitionKey ?? r.definitionId.slice(0, 8);
    }

    /** Human-readable duration: "0s" / "45s" / "12m 30s" / "3h 5m" / "2d 4h". */
    formatDuration(seconds: number | null | undefined): string {
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
}
