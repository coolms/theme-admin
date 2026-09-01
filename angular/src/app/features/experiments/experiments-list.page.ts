import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { ExperimentDto, ExperimentResult, ExperimentsService } from './experiments.service';
import { ExperimentFormDialogComponent } from './experiment-form-dialog.component';

/**
 * W8 — Experiments admin page (/admin/experiments, ).
 *
 * The read/control surface over the W8 A/B experiment store. Each experiment is
 * a card: its status, exposure + conversion totals, and a per-variant
 * **conversion-rate** bar (conversions ÷ exposures — the outcome that actually
 * decides a winner, not the exposure share which mostly mirrors the weights).
 * The backend's significance verdict drives a "Winner" / "Leading" hint with a
 * confidence figure. Per-card controls: Start/Stop (`/status`), Edit
 * (`/update`) and Delete (`/delete`); the "New experiment" toolbar action opens
 * the {@link ExperimentFormDialogComponent}.
 */
@Component({
    selector: 'coolms-admin-experiments',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent],
    template: `
        <cms-list-page
            title="Experiments"
            icon="signpost-split"
            subtitle="A/B experiments over the exposure + conversion store"
            [toolbarTreeSlug]="toolbarTree"
            [footerCount]="footerLabel()"
            (actionClick)="onHeaderAction($event)">
            <div class="cms-exp">
            @if (loading()) {
                <p class="cms-exp__hint">Loading experiments…</p>
            } @else if (experiments().length === 0) {
                <div class="cms-exp__empty">
                    <i class="bi bi-signpost-split"></i>
                    <p>No experiments yet.</p>
                    <button type="button" class="cms-btn cms-btn-primary" (click)="openCreate()">
                        <i class="bi bi-plus-lg"></i> New experiment
                    </button>
                </div>
            } @else {
                @for (exp of experiments(); track exp.key) {
                    <section class="cms-exp__card">
                        <header class="cms-exp__head">
                            <div class="cms-exp__heading">
                                <h2 class="cms-exp__name">{{ exp.name }}</h2>
                                <span class="cms-exp__badge cms-exp__badge--{{ exp.status }}">{{ exp.status }}</span>
                            </div>
                            <div class="cms-exp__head-right">
                                <span class="cms-exp__meta">
                                    <code>{{ exp.key }}</code> ·
                                    {{ exp.totalExposures }} exp · {{ exp.totalConversions }} conv
                                </span>
                                <button type="button" class="cms-btn cms-btn-sm"
                                        title="Edit name, labels & weights" aria-label="Edit experiment"
                                        [disabled]="isPending(exp.key)" (click)="openEdit(exp)">
                                    <i class="bi bi-pencil"></i>
                                </button>
                                <button type="button"
                                        class="cms-btn cms-btn-sm"
                                        [class.cms-btn-danger]="exp.status === 'running'"
                                        [class.cms-btn-primary]="exp.status !== 'running'"
                                        [disabled]="isPending(exp.key)"
                                        (click)="toggle(exp)">
                                    @if (exp.status === 'running') {
                                        <i class="bi bi-stop-fill"></i> <span>{{ isPending(exp.key) ? 'Stopping…' : 'Stop' }}</span>
                                    } @else {
                                        <i class="bi bi-play-fill"></i> <span>{{ isPending(exp.key) ? 'Starting…' : 'Start' }}</span>
                                    }
                                </button>
                                <button type="button" class="cms-btn cms-btn-sm cms-btn-danger"
                                        title="Delete experiment" aria-label="Delete experiment"
                                        [disabled]="isPending(exp.key)" (click)="confirmDelete(exp)">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </header>

                        @if (verdict(exp); as v) {
                            <p class="cms-exp__verdict" [class.cms-exp__verdict--win]="v.significant">
                                @if (v.significant) { <i class="bi bi-trophy-fill"></i> }
                                <span>{{ v.text }}</span>
                            </p>
                        } @else if (exp.totalExposures === 0) {
                            <p class="cms-exp__hint cms-exp__hint--inset">
                                No exposures recorded yet — rates appear once visitors are bucketed.
                            </p>
                        }

                        <ol class="cms-exp__variants">
                            <li class="cms-exp__row cms-exp__row--head">
                                <span class="cms-exp__variant">Variant</span>
                                <span class="cms-exp__bar-head">Conversion rate</span>
                                <span class="cms-exp__rate">Rate</span>
                                <span class="cms-exp__counts">Conv / Exp</span>
                            </li>
                            @for (r of exp.results; track r.variant) {
                                <li class="cms-exp__row" [class.cms-exp__row--leader]="isWinner(exp, r.variant)">
                                    <span class="cms-exp__variant" [title]="r.variant">
                                        {{ r.label }}
                                        @if (isWinner(exp, r.variant)) {
                                            <span class="cms-exp__leading"
                                                  [class.cms-exp__leading--win]="exp.significant">
                                                @if (exp.significant) { <i class="bi bi-trophy-fill"></i> Winner }
                                                @else { Leading }
                                            </span>
                                        }
                                        @if (r.weight === 0) {
                                            <span class="cms-exp__paused" title="Weight 0 — assignment paused">paused</span>
                                        }
                                    </span>
                                    <span class="cms-exp__bar-wrap">
                                        <span class="cms-exp__bar"
                                              [class.cms-exp__bar--leader]="isWinner(exp, r.variant)"
                                              [style.width.%]="barWidth(exp, r)"></span>
                                    </span>
                                    <span class="cms-exp__rate">{{ ratePct(r) }}</span>
                                    <span class="cms-exp__counts">{{ r.conversions }} / {{ r.count }}</span>
                                </li>
                            }
                        </ol>
                    </section>
                }
            }
            </div>
        </cms-list-page>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-exp {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            gap: 0.85rem;
            padding: 1rem;
            overflow-y: auto;
        }
        .cms-exp__hint { color: var(--cms-text-muted, #848b96); }
        .cms-exp__hint--inset { margin: 0 0 0.6rem; font-size: 0.82rem; }
        .cms-exp__empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.6rem;
            padding: 3rem 1rem;
            text-align: center;
            color: var(--cms-text-muted, #848b96);
        }
        .cms-exp__empty .bi { font-size: 2rem; }
        .cms-exp__card {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface, #fff);
            padding: 0.875rem 1rem;
            max-width: 56rem;
        }
        .cms-exp__head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
            flex-wrap: wrap;
            margin-bottom: 0.6rem;
        }
        .cms-exp__heading { display: flex; align-items: center; gap: 0.5rem; }
        .cms-exp__name { margin: 0; font-size: 1rem; color: var(--cms-text, #111827); }
        .cms-exp__head-right { display: flex; align-items: center; gap: 0.4rem; }
        .cms-exp__meta { font-size: 0.8rem; color: var(--cms-text-muted, #848b96); margin-right: 0.35rem; }
        .cms-exp__meta code {
            font-family: var(--cms-font-mono, ui-monospace, monospace);
            font-size: 0.78rem;
        }
        .cms-exp__badge {
            font-size: 0.72rem;
            text-transform: capitalize;
            padding: 0.1rem 0.5rem;
            border-radius: 999px;
            background: var(--cms-surface-muted, #f3f4f6);
            color: var(--cms-text-muted, #848b96);
        }
        .cms-exp__badge--running { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .cms-exp__badge--stopped { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }
        .cms-exp__badge--draft   { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .cms-exp__verdict {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            margin: 0 0 0.7rem;
            font-size: 0.82rem;
            color: var(--cms-text-muted, #848b96);
        }
        .cms-exp__verdict--win { color: var(--cms-success-text); font-weight: 600; }
        .cms-exp__variants {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .cms-exp__row {
            display: grid;
            grid-template-columns: minmax(0, 15rem) 1fr 3.5rem 5rem;
            align-items: center;
            gap: 0.75rem;
        }
        .cms-exp__row--head {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: var(--cms-text-muted, #848b96);
        }
        .cms-exp__bar-head { /* header label over the bar column */ }
        .cms-exp__variant {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--cms-text, #111827);
            font-size: 0.9rem;
        }
        .cms-exp__row--head .cms-exp__variant { font-size: 0.7rem; color: var(--cms-text-muted, #848b96); }
        .cms-exp__leading {
            display: inline-flex;
            align-items: center;
            gap: 0.2rem;
            font-size: 0.68rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            color: var(--cms-text-muted, #848b96);
            background: var(--cms-surface-muted, #f3f4f6);
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
        }
        .cms-exp__leading--win { color: var(--cms-success-text); background: var(--cms-success-subtle); }
        .cms-exp__paused {
            font-size: 0.68rem;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            color: var(--cms-text-muted, #848b96);
            background: var(--cms-surface-muted, #f3f4f6);
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
        }
        .cms-exp__bar-wrap {
            height: 0.6rem;
            border-radius: 999px;
            background: var(--cms-surface-muted, #f3f4f6);
            overflow: hidden;
        }
        .cms-exp__row--head .cms-exp__bar-wrap { display: none; }
        .cms-exp__bar {
            display: block;
            height: 100%;
            min-width: 2px;
            border-radius: 999px;
            background: var(--cms-primary, #2563eb);
        }
        .cms-exp__bar--leader { background: var(--cms-success); }
        .cms-exp__rate {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            color: var(--cms-text, #111827);
            text-align: right;
        }
        .cms-exp__row--head .cms-exp__rate { font-weight: 400; }
        .cms-exp__counts {
            font-variant-numeric: tabular-nums;
            color: var(--cms-text-muted, #848b96);
            text-align: right;
            font-size: 0.85rem;
        }
    `],
})
export class ExperimentsListComponent implements OnInit {
    private readonly api        = inject(ExperimentsService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly experiments = signal<ExperimentDto[]>([]);
    readonly loading     = signal(true);
    /** Keys with an in-flight mutation — disables that card's controls. */
    private readonly pendingKeys = signal<ReadonlySet<string>>(new Set());

    /** Footer row-count strip (bottom-left) — the count lives here, not the header. */
    readonly footerLabel = computed(() => {
        if (this.loading()) return '';
        const all = this.experiments();
        if (all.length === 0) return ''; // the empty-state card already says "No experiments yet"
        const running = all.filter(e => e.status === 'running').length;
        return `${all.length} experiment${all.length === 1 ? '' : 's'} · ${running} running`;
    });

    /**
     * A list page, so its actions are a NaviGraph tree rather than an
     * array here; `cms-list-page` loads the tree and bridges its header-slot
     * nodes into the page header.
     */
    readonly toolbarTree = 'navi.toolbar.experiment.experiments';

    ngOnInit(): void {
        this.titleSvc.set('Experiments');
        this.load();
    }

    onHeaderAction(id: string): void {
        if (id === 'create')  this.openCreate();
        if (id === 'refresh') this.load();
    }

    isPending(key: string): boolean {
        return this.pendingKeys().has(key);
    }

    isWinner(exp: ExperimentDto, variant: string): boolean {
        return exp.winner === variant;
    }

    /** Conversion rate as a 0–100 percentage label (one decimal), or '—' when unshown. */
    ratePct(r: ExperimentResult): string {
        if (r.count <= 0) return '—';
        return `${(r.conversionRate * 100).toFixed(1)}%`;
    }

    /** Bar width as a percentage of the best arm's conversion rate (sliver when non-zero). */
    barWidth(exp: ExperimentDto, r: ExperimentResult): number {
        const max = exp.results.reduce((m, x) => Math.max(m, x.conversionRate), 0);
        if (max <= 0) return 0;
        const pct = (r.conversionRate / max) * 100;
        return r.conversionRate > 0 ? Math.max(2, Math.round(pct)) : 0;
    }

    /** The significance banner for a card, or null when there's nothing to say. */
    verdict(exp: ExperimentDto): { text: string; significant: boolean } | null {
        if (!exp.winner) {
            return exp.totalConversions > 0 ? { text: 'No clear leader yet.', significant: false } : null;
        }
        const w = exp.results.find(r => r.variant === exp.winner);
        const label = w?.label ?? exp.winner;
        const conf = Math.round((exp.confidence ?? 0) * 100);
        return exp.significant
            ? { text: `${label} wins — ${conf}% confidence.`, significant: true }
            : { text: `${label} leading — ${conf}% confidence (not yet significant).`, significant: false };
    }

    openCreate(): void {
        this.dialog.open<ExperimentDto | null>(ExperimentFormDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((e): e is ExperimentDto => e !== null && e !== undefined),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(e => {
            this.toast.success(`Experiment "${e.name}" created`);
            this.load();
        });
    }

    openEdit(exp: ExperimentDto): void {
        this.dialog.open<ExperimentDto | null>(ExperimentFormDialogComponent, {
            data: exp,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((e): e is ExperimentDto => e !== null && e !== undefined),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(e => {
            this.toast.success(`Experiment "${e.name}" updated`);
            this.load();
        });
    }

    toggle(exp: ExperimentDto): void {
        if (this.isPending(exp.key)) return;
        const next = exp.status === 'running' ? 'stopped' : 'running';
        this.setPending(exp.key, true);
        this.api.setStatus(exp.key, next).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.setPending(exp.key, false);
                this.toast.success(next === 'running'
                    ? `Experiment "${exp.name}" started`
                    : `Experiment "${exp.name}" stopped`);
                this.load();
            },
            error: () => {
                this.setPending(exp.key, false);
                this.toast.error('Failed to change the experiment status — please retry');
            },
        });
    }

    confirmDelete(exp: ExperimentDto): void {
        if (this.isPending(exp.key)) return;
        this.confirmSvc.open({
            title:        `Delete "${exp.name}"?`,
            message:      'This permanently removes the experiment and its accumulated exposure + conversion counts. This cannot be undone.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.setPending(exp.key, true);
                return this.api.delete(exp.key);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.setPending(exp.key, false);
                this.toast.success(`Experiment "${exp.name}" deleted`);
                this.load();
            },
            error: () => {
                this.setPending(exp.key, false);
                this.toast.error('Failed to delete the experiment — please retry');
            },
        });
    }

    private setPending(key: string, pending: boolean): void {
        const next = new Set(this.pendingKeys());
        if (pending) next.add(key); else next.delete(key);
        this.pendingKeys.set(next);
    }

    private load(): void {
        this.loading.set(true);
        this.api.list().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  rows => { this.experiments.set(rows); this.loading.set(false); },
            error: ()   => { this.loading.set(false); this.toast.error('Failed to load experiments'); },
        });
    }
}
