import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RoutingOutcome } from '../../api/api.service';
import { RoutingInspectorStateService } from './routing-inspector-state.service';

/**
 * Routing Inspector outcome slot (`RoutingInspectorOutcome`).
 *
 * Renders a coloured banner with the resolved outcome and a tone
 * derived from the outcome family: rendered_* = success, forbidden =
 * warn, not_found/misconfigured = danger. Hidden until a trace lands.
 *
 * Reads state from `RoutingInspectorStateService`. No local state.
 */
@Component({
    selector: 'coolms-routing-inspector-outcome',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (state.trace(); as t) {
            <div class="banner"
                 [class.banner--success]="outcomeTone() === 'success'"
                 [class.banner--warn]="outcomeTone() === 'warn'"
                 [class.banner--danger]="outcomeTone() === 'danger'">
                <div class="banner__main">
                    <span class="banner__label">Outcome</span>
                    <span class="banner__value">{{ formatOutcome(t.outcome) }}</span>
                </div>
                <div class="banner__meta">
                    <span class="mono">{{ t.inputHost || '(empty)' }}</span>
                    <span class="mono">{{ t.inputPath || '(empty)' }}</span>
                </div>
            </div>
        } @else if (!state.loading()) {
            <div class="placeholder">
                Enter a host and path, then click <strong>Inspect</strong> to trace the routing pipeline.
            </div>
        }
    `,
    styles: [`
        :host { display: block; }

        .banner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 14px;
            border-radius: 6px;
            background: var(--cms-surface-muted);
            border: 1px solid var(--cms-border);
            flex-wrap: wrap;
        }
        .banner--success { background: var(--cms-success-subtle); border-color: var(--cms-success-subtle-border); color: var(--cms-success-text); }
        .banner--warn    { background: var(--cms-warning-subtle); border-color: #fcd34d; color: var(--cms-warning-text); }
        .banner--danger  { background: var(--cms-danger-subtle); border-color: var(--cms-danger-border); color: var(--cms-danger-text); }
        .banner__main { display: flex; gap: 8px; align-items: baseline; }
        .banner__label {
            font-size: .75rem;
            text-transform: uppercase;
            letter-spacing: .03em;
            opacity: .8;
        }
        .banner__value { font-weight: 600; font-size: 1rem; }
        .banner__meta { display: flex; gap: 12px; font-size: .85rem; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

        .placeholder {
            padding: 32px 16px;
            text-align: center;
            color: var(--cms-text-muted, #6b7280);
            border: 1px dashed var(--cms-border, #e5e7eb);
            border-radius: 8px;
        }
    `],
})
export class RoutingInspectorOutcomeComponent {
    readonly state = inject(RoutingInspectorStateService);

    /**
     * Maps the backend outcome string to a banner colour tone. Keeps
     * the colour decision in one place so the template can stay
     * structural.
     */
    readonly outcomeTone = computed<'success' | 'warn' | 'danger' | 'neutral'>(() => {
        const t = this.state.trace();
        if (!t) return 'neutral';
        switch (t.outcome) {
            case 'rendered_template':
            case 'rendered_package':
            case 'rendered_directory':
            case 'served_raw_file':
                return 'success';
            case 'forbidden':
                return 'warn';
            case 'not_found':
            case 'misconfigured':
                return 'danger';
            default:
                return 'neutral';
        }
    });

    formatOutcome(outcome: RoutingOutcome): string {
        return outcome.replace(/_/g, ' ');
    }
}
