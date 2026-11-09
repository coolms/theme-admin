import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ErrorHandlerService } from '@coolms/core-angular';
import { CmsPaneToolbarComponent, DateTimeFormatService, type PaneToolbarAction, ToastService } from '@coolms/ui-angular';

import { EmailSyncFinishedEvent } from './email-live-events.service';
import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';

/** How long a sync may go unanswered before the list is read anyway: a queued job can be lost at a worker restart. */
export const SYNC_ANSWER_WAIT_MS = 60_000;

/**
 * The list pane's row (the pane toolbar): Refresh for the open mailbox, which asks the server to sync it now and is busy
 * while it runs, and at the row's end when the mailbox last synced, kept until the sync ends.
 * The server answers at once and says later, on the person's mailbox channel, how the sync it started ended. A frame
 * can arrive before the answer that names its sync, and a press inside the server's 30 seconds is answered with the
 * sync already running or just finished, so the last frame seen is kept. An answer counts only for the press it
 * answers, and a frame later than the wait still ends its sync: a slow one is not left saying the old time.
 */
@Component({
    selector: 'app-mailbox-sync',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPaneToolbarComponent],
    template: `
        <cms-pane-toolbar [actions]="actions()" label="Mailbox" [status]="status()" (action)="onAction($event)" />
        <span class="mbsync__sr" role="status" data-test="mail-syncing">{{ syncing() ? 'Syncing this mailbox' : '' }}</span>
    `,
    styles: [`
        :host { display: block; padding: 0 10px; border-bottom: 1px solid var(--cms-border); }
        .mbsync__sr {
            position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap;
        }
    `],
})
export class MailboxSyncComponent {
    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);

    readonly mailbox = input.required<EmailMailboxDto | null>();
    /** The list pane's actions from the server's tree (navi.toolbar.email.list), mapped by the page; none while it serves none. */
    readonly served = input<readonly PaneToolbarAction[]>([]);
    /** A sync ended, however it ended: the list and the mailbox's synced-at are worth reading again. */
    readonly finished = output<string>();

    readonly syncing = signal(false);

    private readonly dates = inject(DateTimeFormatService);
    /**
     * Refresh as the server's tree gives it (its label, icon, group and overflow), or the page's own while the tree has
     * no refresh node; disabled with no mailbox, busy while a sync runs.
     */
    readonly actions = computed((): PaneToolbarAction[] => {
        const node = this.served().find(a => a.id === 'refresh') ?? { id: 'refresh', label: 'Refresh', icon: 'arrow-clockwise', group: 'sync' };
        return [{
            ...node,
            ...(this.mailbox() === null ? { disabled: true } : {}),
            ...(this.syncing() ? { busy: true } : {}),
        }];
    });
    /** When the open mailbox last synced, as the server says; nothing when it never has. */
    readonly status = computed(() => {
        const at = this.mailbox()?.lastSuccessAt;
        return at !== undefined && at !== null && at !== '' ? 'Synced at ' + this.dates.auto(at) : null;
    });

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

    /** The row's one action: Refresh. */
    onAction(id: string): void {
        if (id === 'refresh') {
            this.refresh();
        }
    }

    refresh(): void {
        const id = this.mailbox()?.id;
        if (id === undefined || this.syncing()) {
            return;
        }
        this.syncing.set(true);
        // A frame still due from an earlier sync must not end this one while its answer is on the way.
        this.waitingFor = null;
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
