import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DateTimeFormatService } from '@coolms/ui-angular';
import { AccountDeletionDto, AccountDeletionState } from '../../api/api.service';

/** What the state badge is called and coloured, shared by the drawer and the user panel. */
export const DELETION_STATE_LABELS: Readonly<Record<AccountDeletionState, { label: string; variant: string }>> = {
    pending:   { label: 'Pending',   variant: 'warning' },
    held:      { label: 'Held',      variant: 'danger' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
    executed:  { label: 'Executed',  variant: 'success' },
};

/**
 * One deletion, in full: the record, the hold that stopped it, what the
 * deletion reached (the four lists the record stores: erased, minimised,
 * kept, not covered -- structure, never a sentence parsed back), and the
 * last fire of its schedule row. Opened in the drawer from a row of the
 * deletions list. Presentation only: every fact here is the server's.
 */
@Component({
    selector: 'app-deletion-detail-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @let d = deletion();
        <div class="ddp">
            <dl class="ddp-facts">
                <dt>Account</dt><dd>{{ d.accountLabel }}</dd>
                <dt>State</dt><dd><span class="badge text-bg-{{ state().variant }}">{{ state().label }}</span></dd>
                <dt>Requested by</dt><dd>{{ d.requestedByLabel }}</dd>
                <dt>Requested</dt><dd>{{ dtf.dateTime(d.requestedAt) }}</dd>
                <dt>Due</dt>
                <dd>
                    {{ dtf.dateTime(d.dueAt) }}
                    @if (d.daysLeft !== null && d.daysLeft !== undefined) {
                        <span class="text-muted">&mdash; {{ d.daysLeft === 0 ? 'due now' : d.daysLeft + ' day' + (d.daysLeft === 1 ? '' : 's') + ' left' }}</span>
                    }
                </dd>
                @if (d.nextAttemptAt && d.state === 'held') {
                    <dt>Next attempt</dt><dd>{{ dtf.dateTime(d.nextAttemptAt) }} <span class="text-muted">(re-armed by the release)</span></dd>
                }
                @if (d.cancelledAt) {
                    <dt>Cancelled</dt><dd>{{ dtf.dateTime(d.cancelledAt) }} <span class="text-muted">by {{ d.cancelledByKind === 'administrator' ? 'an administrator' : 'the person' }}</span></dd>
                }
                @if (d.executedAt) {
                    <dt>Executed</dt><dd>{{ dtf.dateTime(d.executedAt) }}</dd>
                }
            </dl>

            @if (d.hold; as hold) {
                <h6 class="ddp-heading"><i class="bi bi-shield-lock me-1"></i>Legal hold</h6>
                <p class="ddp-reason">{{ hold.reason }}</p>
                <p class="text-muted small mb-1">
                    Placed by {{ hold.placedByLabel }} on {{ dtf.dateTime(hold.placedAt) }}.
                    @if (hold.active) {
                        <strong>Standing.</strong>
                    } @else {
                        Released by {{ hold.releasedByLabel ?? 'a deleted user' }} on {{ dtf.dateTime(hold.releasedAt) }}.
                    }
                </p>
            }

            @if (d.coverage; as c) {
                <h6 class="ddp-heading"><i class="bi bi-list-check me-1"></i>What the deletion reached</h6>
                <div class="ddp-lists">
                    <section>
                        <h6>Erased <span class="text-muted">({{ c.erased.length }})</span></h6>
                        <ul>@for (t of c.erased; track t) { <li>{{ t }}</li> } @empty { <li class="text-muted">&ndash;</li> }</ul>
                    </section>
                    <section>
                        <h6>Minimised <span class="text-muted">({{ c.minimised.length }})</span></h6>
                        <p class="small text-muted mb-1">The person's copied fields scrubbed; the record and its uuid kept.</p>
                        <ul>@for (t of c.minimised; track t) { <li>{{ t }}</li> } @empty { <li class="text-muted">&ndash;</li> }</ul>
                    </section>
                    <section>
                        <h6>Kept by declaration <span class="text-muted">({{ c.kept.length }})</span></h6>
                        <ul>@for (t of c.kept; track t) { <li>{{ t }}</li> } @empty { <li class="text-muted">&ndash;</li> }</ul>
                    </section>
                    <section class="ddp-uncovered">
                        <h6>Not covered <span class="text-muted">({{ c.uncovered.length }})</span></h6>
                        <p class="small text-muted mb-1">These survived this deletion undeclared.</p>
                        <ul>@for (t of c.uncovered; track t) { <li>{{ t }}</li> } @empty { <li class="text-muted">&ndash; nothing</li> }</ul>
                    </section>
                </div>
            } @else if (d.state === 'executed') {
                <p class="text-muted small">Executed before the record kept what a deletion reaches; the run row below, if any, carries it as a sentence.</p>
            }

            @if (d.run; as run) {
                <h6 class="ddp-heading"><i class="bi bi-alarm me-1"></i>Last run &mdash; {{ run.outcome }} on {{ dtf.dateTime(run.at) }}</h6>
                @if (run.outcome === 'skipped') {
                    <p class="ddp-reason">{{ run.error }}</p>
                } @else if (run.outcome === 'failed') {
                    <p class="ddp-reason text-danger">{{ run.error }}</p>
                } @else if (!d.coverage) {
                    <p class="ddp-reason">{{ run.detail ?? 'The run reported nothing.' }}</p>
                } @else {
                    <p class="text-muted small mb-1">The run row carries the lists above as a sentence.</p>
                }
            } @else if (d.state === 'executed') {
                <p class="text-muted small">Executed at once (no grace period): no schedule row fired.</p>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .ddp { padding: 12px 16px; font-size: 0.9rem; }
        .ddp-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 12px; }
        .ddp-facts dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }
        .ddp-facts dd { margin: 0; }
        .ddp-heading { margin: 14px 0 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--cms-text-muted, #848b96); }
        .ddp-reason { white-space: pre-wrap; margin: 0 0 6px; }
        .ddp-lists section { margin-bottom: 10px; }
        .ddp-lists h6 { font-size: 0.85rem; margin: 0 0 2px; }
        .ddp-lists ul { margin: 0; padding-left: 18px; font-family: var(--cms-font-mono, ui-monospace, 'SFMono-Regular', Menlo, monospace); font-size: 0.8rem; }
        .ddp-uncovered ul { color: var(--cms-danger, #dc2626); }
    `],
})
export class DeletionDetailPanelComponent {
    readonly deletion = input.required<AccountDeletionDto>();
    readonly dtf = inject(DateTimeFormatService);

    readonly state = computed(() => DELETION_STATE_LABELS[this.deletion().state] ?? { label: this.deletion().state, variant: 'secondary' });
}
