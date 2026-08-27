import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { DocumentGenerationDto } from '../../../api/api.service';

/**
 * Read-only summary card for a `DocumentGenerationDto`. Renders the
 * status badge, progress bar, counters, and metadata block; emits a
 * `retry` event when the user clicks the retry-failed button. The
 * button is only rendered when `failedCount > 0` AND the generation
 * has reached a terminal state -- the page passes the same
 * information back to the parent so action handling stays single-
 * sourced.
 */
@Component({
    selector: 'cms-generation-status-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DatePipe, DecimalPipe],
    template: `
        <section class="cms-gen-status" aria-labelledby="cms-gen-status-title">
            <header class="cms-gen-status__head">
                <h2 id="cms-gen-status-title" class="cms-gen-status__title">
                    Generation
                    <code class="cms-gen-status__id">{{ shortId() }}</code>
                </h2>
                <span class="cms-gen-status__badge"
                      [class.cms-gen-status__badge--pending]="generation().status === 'pending'"
                      [class.cms-gen-status__badge--running]="generation().status === 'running'"
                      [class.cms-gen-status__badge--completed]="generation().status === 'completed'"
                      [class.cms-gen-status__badge--partial]="generation().status === 'partially_failed'"
                      [class.cms-gen-status__badge--failed]="generation().status === 'failed'">
                    {{ statusLabel() }}
                </span>
            </header>

            <div class="cms-gen-status__progress" aria-live="polite" aria-atomic="true">
                <div class="cms-gen-status__bar">
                    <div class="cms-gen-status__bar-fill" [style.width.%]="progressPct()"></div>
                </div>
                <div class="cms-gen-status__progress-text">
                    {{ generation().completedCount | number }} of {{ generation().totalCount | number }} done
                    @if (generation().failedCount > 0) {
                        <span class="cms-gen-status__failed">
                            ({{ generation().failedCount | number }} failed)
                        </span>
                    }
                </div>
            </div>

            <dl class="cms-gen-status__meta">
                <dt>Template</dt>
                <dd>{{ templateLabel() }}</dd>

                <dt>Mode</dt>
                <dd>{{ modeLabel() }}</dd>

                <dt>Format</dt>
                <dd>{{ generation().outputFormat || '—' }}</dd>

                <dt>Created</dt>
                <dd>{{ generation().createdAt | date: 'medium' }}</dd>

                @if (generation().completedAt) {
                    <dt>Completed</dt>
                    <dd>{{ generation().completedAt | date: 'medium' }}</dd>
                }

                @if (generation().errorMessage) {
                    <dt>Error</dt>
                    <dd class="cms-gen-status__error">{{ generation().errorMessage }}</dd>
                }
            </dl>

            @if (canRetry()) {
                <div class="cms-gen-status__actions">
                    <button type="button"
                            class="cms-btn cms-btn-danger"
                            [disabled]="retryBusy()"
                            (click)="retry.emit()">
                        @if (retryBusy()) {
                            Retrying…
                        } @else {
                            Retry {{ generation().failedCount }} failed
                        }
                    </button>
                </div>
            }
        </section>
    `,
    styles: [`
        :host { display: block; }

        .cms-gen-status {
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 1rem 1.25rem;
            display: flex;
            flex-direction: column;
            gap: .75rem;
        }
        .cms-gen-status__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: .75rem;
        }
        .cms-gen-status__title {
            margin: 0;
            font-size: 1rem;
            display: flex;
            align-items: center;
            gap: .5rem;
        }
        .cms-gen-status__id {
            font-family: monospace;
            font-size: .85rem;
            color: var(--cms-text-secondary);
        }
        .cms-gen-status__badge {
            padding: 2px 10px;
            border-radius: 999px;
            font-size: .75rem;
            font-weight: 600;
            text-transform: capitalize;
            background: var(--cms-border-light);
            color: var(--cms-text-secondary);
        }
        .cms-gen-status__badge--pending {
            background: var(--cms-info-bg, rgba(33, 150, 243, .12));
            color: var(--cms-info, #1d6fd0);
        }
        .cms-gen-status__badge--running {
            background: var(--cms-info-bg, rgba(33, 150, 243, .12));
            color: var(--cms-info, #1d6fd0);
        }
        .cms-gen-status__badge--completed {
            background: var(--cms-success-bg, rgba(76, 175, 80, .12));
            color: var(--cms-success, #1f8a32);
        }
        .cms-gen-status__badge--partial {
            background: var(--cms-warning-bg, rgba(255, 152, 0, .12));
            color: var(--cms-warning, #b06a00);
        }
        .cms-gen-status__badge--failed {
            background: var(--cms-danger-bg, rgba(244, 67, 54, .12));
            color: var(--cms-danger, #c62828);
        }

        .cms-gen-status__progress { display: flex; flex-direction: column; gap: .25rem; }
        .cms-gen-status__bar {
            height: 8px;
            background: var(--cms-border-light);
            border-radius: 4px;
            overflow: hidden;
        }
        .cms-gen-status__bar-fill {
            height: 100%;
            background: var(--cms-info, #1d6fd0);
            transition: width .2s ease;
        }
        .cms-gen-status__progress-text {
            font-size: .85rem;
            color: var(--cms-text-secondary);
        }
        .cms-gen-status__failed {
            color: var(--cms-danger);
            font-weight: 600;
        }

        .cms-gen-status__meta {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: .35rem 1rem;
            margin: 0;
            font-size: .85rem;
        }
        .cms-gen-status__meta dt {
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-gen-status__meta dd {
            margin: 0;
            color: var(--cms-text);
        }
        .cms-gen-status__error {
            color: var(--cms-danger);
            white-space: pre-wrap;
        }

        .cms-gen-status__actions {
            display: flex;
            justify-content: flex-end;
        }
        /* Kit shadows removed (#2030). .cms-btn--danger was a PRIVATE variant
           in kit-looking clothing: the kit spells it .cms-btn-danger, single
           dash, so this name matched nothing shared and quietly diverged into a
           solid red fill. The markup now uses the kit's variant. */
    `],
})
export class GenerationStatusCardComponent {
    readonly generation = input.required<DocumentGenerationDto>();
    readonly templateName = input<string | null>(null);
    readonly retryBusy = input<boolean>(false);

    readonly retry = output<void>();

    protected readonly shortId = computed(() => {
        const id = this.generation().id;
        if (id.length <= 12) {
            return id;
        }
        return id.slice(0, 8) + '…' + id.slice(-4);
    });

    protected readonly progressPct = computed(() => {
        const g = this.generation();
        if (g.totalCount <= 0) {
            return 0;
        }
        return Math.min(100, Math.round((g.completedCount / g.totalCount) * 100));
    });

    protected readonly statusLabel = computed(() => {
        const s = this.generation().status;
        if (s === 'partially_failed') {
            return 'Partially failed';
        }
        return s;
    });

    protected readonly modeLabel = computed(() => {
        const m = this.generation().mode;
        return m.charAt(0).toUpperCase() + m.slice(1);
    });

    protected readonly templateLabel = computed(() => this.templateName() ?? this.generation().templateId);

    protected readonly canRetry = computed(() => {
        const g = this.generation();
        const terminal = g.status === 'completed' || g.status === 'partially_failed' || g.status === 'failed';
        return terminal && g.failedCount > 0;
    });
}
