import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    input,
    OnInit,
    output,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { filter, forkJoin, switchMap } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';
import { AccountDeletionDto, ApiService, LegalHoldDto } from '../../api/api.service';
import { DELETION_STATE_LABELS } from './deletion-detail-panel.component';
import { LegalHoldDialogComponent, LegalHoldDialogData } from './legal-hold-dialog.component';

/**
 * Level two of "Legal holds": one person's pending deletion
 * and every hold ever placed on them, on the user page. Cancel, place and
 * release are elevated acts -- the 403 prompts elevation through the
 * interceptor and the same request is re-sent; this panel re-reads after
 * every success and derives nothing from a remembered flag.
 *
 * Absent entirely when the server does not expose the deletion screens.
 */
@Component({
    selector: 'app-user-deletion-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (api.hasDeletionScreens) {
            <div class="udp">
                <h6 class="udp-heading"><i class="bi bi-person-x me-1"></i>Deletion</h6>
                @if (loading()) {
                    <p class="text-muted small mb-2">Loading&hellip;</p>
                } @else if (pending(); as d) {
                    <p class="mb-1">
                        <span class="badge text-bg-{{ stateOf(d).variant }} me-1">{{ stateOf(d).label }}</span>
                        Requested by {{ d.requestedByLabel }} on {{ dtf.dateTime(d.requestedAt) }};
                        due {{ dtf.dateTime(d.dueAt) }}
                        @if (d.daysLeft !== null && d.daysLeft !== undefined) {
                            ({{ d.daysLeft === 0 ? 'due now' : d.daysLeft + ' day' + (d.daysLeft === 1 ? '' : 's') + ' left' }})
                        }
                    </p>
                    @if (d.hold; as hold) {
                        <p class="small text-muted mb-1">
                            @if (hold.active) {
                                Stopped by the hold below; nothing is scheduled while it stands.
                            } @else {
                                The last attempt was stopped by a hold since released; the schedule tries again {{ d.nextAttemptAt ? 'on ' + dtf.dateTime(d.nextAttemptAt) : 'at the due date' }}.
                            }
                        </p>
                    }
                    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="cancelDeletion(d)">
                        <i class="bi bi-arrow-counterclockwise me-1"></i>Cancel the deletion
                    </button>
                } @else {
                    <p class="text-muted small mb-1">No deletion is pending. Deleting the user requests one: access ends at once and the account is deleted when the grace period ends.</p>
                }

                <h6 class="udp-heading mt-3"><i class="bi bi-shield-lock me-1"></i>Legal holds</h6>
                @if (!loading()) {
                    @if (holds().length === 0) {
                        <p class="text-muted small mb-1">None ever placed.</p>
                    }
                    <ul class="udp-holds">
                        @for (h of holds(); track h.id) {
                            <li [class.udp-hold--released]="!h.active">
                                <div class="udp-hold-reason">{{ h.reason }}</div>
                                <div class="small text-muted">
                                    Placed {{ dtf.dateTime(h.placedAt) }}
                                    @if (h.active) {
                                        &mdash; <strong>standing</strong>
                                        <button type="button" class="btn btn-link btn-sm p-0 ms-2 text-danger" (click)="release(h)">Release</button>
                                    } @else {
                                        &mdash; released {{ dtf.dateTime(h.releasedAt) }}
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                    @if (!hasActiveHold()) {
                        <button type="button" class="btn btn-sm btn-outline-secondary" (click)="placeHold()">
                            <i class="bi bi-shield-lock me-1"></i>Place a hold
                        </button>
                    }
                }
            </div>
        }
    `,
    styles: [`
        :host { display: block; }
        .udp { font-size: 0.9rem; }
        .udp-heading { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--cms-text-muted, #848b96); margin: 0 0 6px; }
        .udp-holds { list-style: none; padding: 0; margin: 0 0 8px; }
        .udp-holds li { padding: 6px 0; border-top: 1px solid var(--cms-border, #e5e7eb); }
        .udp-hold--released .udp-hold-reason { color: var(--cms-text-muted, #848b96); }
        .udp-hold-reason { white-space: pre-wrap; }
    `],
})
export class UserDeletionPanelComponent implements OnInit {
    readonly userId       = input.required<string>();
    readonly accountLabel = input<string>('this account');
    /** After a cancel, a hold or a release succeeded: the host may want to refresh its own view. */
    readonly changed      = output<void>();

    readonly api = inject(ApiService);
    readonly dtf = inject(DateTimeFormatService);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(true);
    readonly pending = signal<AccountDeletionDto | null>(null);
    readonly holds   = signal<LegalHoldDto[]>([]);

    hasActiveHold(): boolean {
        return this.holds().some(h => h.active);
    }

    stateOf(d: AccountDeletionDto): { label: string; variant: string } {
        return DELETION_STATE_LABELS[d.state] ?? { label: d.state, variant: 'secondary' };
    }

    ngOnInit(): void {
        this.reload();
    }

    reload(): void {
        if (!this.api.hasDeletionScreens) {
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        forkJoin({
            pending: this.api.getPendingDeletion(this.userId()),
            holds:   this.api.listLegalHolds(this.userId()),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ pending, holds }) => {
                this.pending.set(pending);
                this.holds.set(holds);
                this.loading.set(false);
            },
            error: err => {
                this.loading.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    cancelDeletion(d: AccountDeletionDto): void {
        this.confirmSvc.open({
            title:        `Cancel the deletion of ${this.accountLabel()}?`,
            message:      'Access is restored at once and the person is told who cancelled.',
            confirmLabel: 'Cancel the deletion',
            cancelLabel:  'Keep it',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.cancelDeletion(d.userId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Deletion cancelled; access restored'); this.afterChange(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    placeHold(): void {
        const data: LegalHoldDialogData = { userId: this.userId(), accountLabel: this.accountLabel() };
        this.dialog.open(LegalHoldDialogComponent, { data })
            .closed.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.afterChange());
    }

    release(h: LegalHoldDto): void {
        this.confirmSvc.open({
            title:        'Release the hold?',
            message:      'A pending deletion is re-armed: due now, or at its own date if that is later.',
            confirmLabel: 'Release',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.releaseLegalHold(this.userId(), h.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Hold released'); this.afterChange(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private afterChange(): void {
        this.reload();
        this.changed.emit();
    }
}
