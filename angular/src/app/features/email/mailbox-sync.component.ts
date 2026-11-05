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
 * sync already running or just finished, so the last frame seen is kept. An answer counts only for the press it
 * answers, and a frame later than the wait still ends its sync: a slow one is not left saying the old time.
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
    /** Which press an answer belongs to: moved on by a new press, and by whatever ends or leaves one behind. */
    private press = 0;
    private readonly lastFrames = new Map<string, EmailSyncFinishedEvent>();
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
        const press = ++this.press;
        this.email.syncMailbox(id).subscribe({
            next: started => {
                if (press !== this.press) {
                    return;
                }
                const seen = this.lastFrames.get(id);
                if (seen?.syncId === started.syncId) {
                    this.end(seen);
                    return;
                }
                this.waitingFor = started.syncId;
                this.timer = setTimeout(() => this.waitedLongEnough(), SYNC_ANSWER_WAIT_MS);
            },
            error: (err: unknown) => {
                if (press !== this.press) {
                    return;
                }
                this.stop();
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    /** A frame from the person's mailbox channel. */
    frame(event: EmailSyncFinishedEvent): void {
        this.lastFrames.set(event.mailboxId, event);
        if (event.mailboxId !== this.openId) {
            // A sync that ended while another mailbox is open: its time is worth reading, and nothing else here moves.
            this.finished.emit(event.mailboxId);
            return;
        }
        if (event.syncId === this.waitingFor) {
            this.end(event);
        }
    }

    /** No frame in time: read the list anyway, and keep listening, since a frame may still come. */
    private waitedLongEnough(): void {
        this.timer = null;
        this.syncing.set(false);
        if (this.openId !== null) {
            this.finished.emit(this.openId);
        }
    }

    private end(event: EmailSyncFinishedEvent): void {
        const id = this.openId;
        this.stop();
        if ('failed' === event.outcome) {
            this.toast.error('The mailbox could not be synced.');
        }
        if (id !== null) {
            this.finished.emit(id);
        }
    }

    private stop(): void {
        this.press += 1;
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
