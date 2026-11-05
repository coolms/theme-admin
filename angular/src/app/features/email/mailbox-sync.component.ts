import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ErrorHandlerService } from '@coolms/core-angular';
import { DateTimePipe, StateComponent, ToastService } from '@coolms/ui-angular';

import { EmailSyncFinishedEvent } from './email-live-events.service';
import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';

/** How long a sync may go unanswered before the list is read anyway: a queued job can be lost at a worker restart. */
export const SYNC_ANSWER_WAIT_MS = 60_000;

/**
 * Refresh for the open mailbox: asks the server to sync it now, shows that it runs, and says when it last synced.
 * The server answers at once and says later, on the person's mailbox channel, how the sync it started ended. A frame
 * can arrive before the answer that names its sync, and a press inside the server's 30 seconds is answered with the
 * sync already running or just finished, so the last frame seen is kept.
 */
@Component({
    selector: 'app-mailbox-sync',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StateComponent, DateTimePipe],
    template: `
        <button type="button" class="cms-btn cms-btn-sm" data-test="mail-refresh"
                [disabled]="syncing() || mailbox() === null" (click)="refresh()">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh
        </button>
        @if (syncing()) {
            <cms-state kind="loading" title="Syncing this mailbox" placement="inline" />
        } @else if (mailbox()?.lastSuccessAt; as at) {
            <span class="mbsync__at" data-test="mail-synced-at">Synced at {{ at | appDateTime }}</span>
        }
    `,
    styles: [`
        :host {
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px;
            border-bottom: 1px solid var(--cms-border); min-height: 40px;
        }
        .mbsync__at { color: var(--cms-text-muted); font-size: .75rem; }
    `],
})
export class MailboxSyncComponent {
    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);

    readonly mailbox = input.required<EmailMailboxDto | null>();
    /** A sync ended, however it ended: the list and the mailbox's synced-at are worth reading again. */
    readonly finished = output<string>();

    readonly syncing = signal(false);

    private waitingFor: string | null = null;
    private lastFrame: EmailSyncFinishedEvent | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private openId: string | null = null;

    constructor() {
        // A sync belongs to the mailbox it was asked for: another one opening leaves it behind.
        effect(() => {
            const id = this.mailbox()?.id ?? null;
            untracked(() => {
                if (id !== this.openId) {
                    this.openId = id;
                    this.stop();
                }
            });
        });
        inject(DestroyRef).onDestroy(() => this.clearTimer());
    }

    refresh(): void {
        const id = this.mailbox()?.id;
        if (id === undefined || this.syncing()) {
            return;
        }
        this.syncing.set(true);
        this.email.syncMailbox(id).subscribe({
            next: started => {
                if (id !== this.openId) {
                    return;
                }
                if (this.lastFrame?.syncId === started.syncId) {
                    this.end(this.lastFrame);
                    return;
                }
                this.waitingFor = started.syncId;
                this.timer = setTimeout(() => this.end(null), SYNC_ANSWER_WAIT_MS);
            },
            error: (err: unknown) => {
                this.stop();
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    /** A frame from the person's mailbox channel. */
    frame(event: EmailSyncFinishedEvent): void {
        if (event.mailboxId !== this.openId) {
            return;
        }
        this.lastFrame = event;
        if (event.syncId === this.waitingFor) {
            this.end(event);
        }
    }

    private end(event: EmailSyncFinishedEvent | null): void {
        const id = this.openId;
        this.stop();
        if ('failed' === event?.outcome) {
            this.toast.error('The mailbox could not be synced.');
        }
        if (id !== null) {
            this.finished.emit(id);
        }
    }

    private stop(): void {
        this.clearTimer();
        this.waitingFor = null;
        this.syncing.set(false);
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
