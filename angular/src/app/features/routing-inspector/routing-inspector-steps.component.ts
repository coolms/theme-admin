import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
    RoutingStepDto,
    RoutingStepKind,
    RoutingStepStatus,
    RoutingTargetKind,
} from '../../api/api.service';
import { RoutingInspectorStateService } from './routing-inspector-state.service';

/**
 * Routing Inspector steps slot (`RoutingInspectorSteps`).
 *
 * Renders the resolution step list (six rows -- one per RoutingStep)
 * and the optional render target card. Step rows show name + status
 * chip + optional note + Details toggle that expands the step's
 * structured payload.
 *
 * Reads state from `RoutingInspectorStateService`. The expand/collapse
 * state lives in the service so it survives slot re-renders.
 */
@Component({
    selector: 'coolms-routing-inspector-steps',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (state.trace(); as t) {
            <!-- Step list -->
            <section class="card">
                <header class="card__head">
                    <h3 class="card__title">
                        <i class="bi bi-list-ol"></i> Resolution Steps
                    </h3>
                    <span class="card__count">{{ t.steps.length }}</span>
                </header>
                <ul class="step-list">
                    @for (s of t.steps; track s.step; let idx = $index) {
                        <li class="step-row">
                            <div class="step-row__main">
                                <div class="step-row__head">
                                    <span class="step-row__index">{{ idx + 1 }}</span>
                                    <span class="step-row__name">{{ formatStep(s.step) }}</span>
                                    <span class="chip"
                                          [class.chip--matched]="s.status === 'matched'"
                                          [class.chip--not-matched]="s.status === 'not_matched'"
                                          [class.chip--skipped]="s.status === 'skipped'"
                                          [class.chip--error]="s.status === 'error'">
                                        {{ formatStatus(s.status) }}
                                    </span>
                                </div>
                                @if (s.note) {
                                    <div class="step-row__note">{{ s.note }}</div>
                                }
                            </div>
                            <div class="step-row__details">
                                @if (hasDetails(s)) {
                                    <button type="button" class="cms-btn cms-btn-link cms-btn-sm"
                                            (click)="state.toggleStep(s.step)">
                                        @if (state.expanded().has(s.step)) {
                                            <i class="bi bi-chevron-up"></i> Hide details
                                        } @else {
                                            <i class="bi bi-chevron-down"></i> Details
                                        }
                                    </button>
                                }
                            </div>
                            @if (state.expanded().has(s.step)) {
                                <div class="step-row__payload">
                                    <pre class="mono">{{ formatDetails(s.details) }}</pre>
                                </div>
                            }
                        </li>
                    }
                </ul>
            </section>

            <!-- Target card -->
            @if (t.target; as tgt) {
                <section class="card">
                    <header class="card__head">
                        <h3 class="card__title">
                            <i class="bi bi-bullseye"></i> Render Target
                        </h3>
                        <span class="chip chip--kind">{{ tgt.kind }}</span>
                    </header>
                    <div class="card__body">
                        <dl class="kv">
                            <dt>Resolver</dt>
                            <dd><span class="mono">{{ tgt.resolverName ?? noneText }}</span></dd>
                            <dt>Template</dt>
                            <dd>
                                @if (tgt.templatePath) {
                                    <span class="mono">{{ tgt.templatePath }}</span>
                                } @else {
                                    <span class="muted">{{ noneText }}</span>
                                }
                            </dd>
                            <dt>VFS node</dt>
                            <dd>
                                @if (tgt.vfsNodePath) {
                                    <span class="mono">{{ tgt.vfsNodePath }}</span>
                                    @if (tgt.vfsNodeId) {
                                        <span class="muted mono" [title]="tgt.vfsNodeId">
                                            ({{ shortenId(tgt.vfsNodeId) }})
                                        </span>
                                    }
                                } @else {
                                    <span class="muted">{{ noneText }}</span>
                                }
                            </dd>
                            <dt>Navi node</dt>
                            <dd>
                                @if (tgt.naviNodePath) {
                                    <span class="mono">{{ tgt.naviNodePath }}</span>
                                    @if (tgt.naviNodeId) {
                                        <span class="muted mono" [title]="tgt.naviNodeId">
                                            ({{ shortenId(tgt.naviNodeId) }})
                                        </span>
                                    }
                                } @else {
                                    <span class="muted">{{ noneText }}</span>
                                }
                            </dd>
                        </dl>
                    </div>
                </section>
            } @else {
                <section class="card card--muted">
                    <div class="card__body">
                        <p class="muted">
                            No render target was identified for this request.
                            See the step list above for which lookups returned
                            and where the chain terminated.
                        </p>
                    </div>
                </section>
            }
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; gap: 16px; }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 8px;
            overflow: hidden;
        }
        .card--muted { background: var(--cms-surface-muted); }
        .card__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            background: var(--cms-surface-muted);
        }
        .card__title {
            margin: 0;
            font-size: .9rem;
            font-weight: 600;
            color: var(--cms-text, #111);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card__count {
            font-size: .8rem;
            color: var(--cms-text-muted, #6b7280);
            background: var(--cms-surface-muted);
            border-radius: 10px;
            padding: 1px 8px;
        }
        .card__body { padding: 12px 16px; }

        .step-list { list-style: none; margin: 0; padding: 0; }
        .step-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px 12px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border, #f3f4f6);
            align-items: flex-start;
        }
        .step-row:nth-child(even) { background: var(--cms-surface-muted); }
        .step-row:last-child { border-bottom: 0; }
        .step-row__head {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .step-row__index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 22px;
            height: 22px;
            border-radius: 11px;
            background: var(--cms-surface-muted);
            color: var(--cms-text-body);
            font-size: .75rem;
            font-weight: 600;
        }
        .step-row__name { font-weight: 500; color: var(--cms-text, #111); }
        .step-row__note {
            margin-top: 4px;
            color: var(--cms-text-muted, #6b7280);
            font-size: .85rem;
        }
        .step-row__details { display: flex; align-items: center; }
        .step-row__payload {
            grid-column: 1 / -1;
            margin-top: 6px;
            background: #0f172a;
            color: #f1f5f9;
            border-radius: 4px;
            padding: 10px 12px;
            overflow: auto;
        }
        .step-row__payload pre {
            margin: 0;
            font-size: .8rem;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: .7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .03em;
            background: var(--cms-surface-muted);
            color: var(--cms-text-body);
        }
        .chip--matched     { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .chip--not-matched { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }
        .chip--skipped     { background: var(--cms-surface-muted); color: #4b5563; }
        .chip--error       { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .chip--kind        { background: var(--cms-info-subtle); color: var(--cms-info-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

        .kv {
            margin: 0;
            display: grid;
            grid-template-columns: minmax(120px, max-content) 1fr;
            gap: 6px 16px;
        }
        .kv dt {
            color: var(--cms-text-muted, #6b7280);
            font-size: .8rem;
            align-self: center;
        }
        .kv dd {
            margin: 0;
            color: var(--cms-text, #111);
            word-break: break-word;
            display: flex;
            gap: 6px;
            align-items: baseline;
            flex-wrap: wrap;
        }

        .mono  { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .muted { color: var(--cms-text-muted, #6b7280); }

    `],
})
export class RoutingInspectorStepsComponent {
    readonly noneText = '—';
    readonly state    = inject(RoutingInspectorStateService);

    /** True iff the step's `details` payload has at least one key. */
    hasDetails(s: RoutingStepDto): boolean {
        return typeof s.details === 'object' && Object.keys(s.details).length > 0;
    }

    /** snake_case -> Title Case ("section_resolution" -> "Section Resolution"). */
    formatStep(step: RoutingStepKind): string {
        return step.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    formatStatus(status: RoutingStepStatus): string {
        return status.replace(/_/g, ' ');
    }

    /** Renders `details` as a pretty-printed JSON blob. */
    formatDetails(details: Record<string, unknown>): string {
        try {
            return JSON.stringify(details, null, 2);
        } catch {
            // Unreachable on real API responses (JSON-serialisable by
            // construction) but guards against test stubs slipping
            // cycles through.
            return '[unrepresentable]';
        }
    }

    /** Shortens a UUID to `abc12345…` for display; full UUID surfaces in the tooltip. */
    shortenId(id: string | null): string {
        if (id === null || id === '') return this.noneText;
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }

    /** Exposes the `RoutingTargetKind` type for stricter templates if ever needed. */
    protected readonly targetKinds: ReadonlyArray<RoutingTargetKind> =
        ['template', 'package', 'directory', 'raw_file'];
}
