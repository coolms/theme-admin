import { Injectable, inject } from '@angular/core';
import { Observable, share } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

import { type MailAliasesChangedEvent, readAliasesChanged } from './mail-aliases';
import { type MailDraftsChangedEvent, readDraftsChanged } from './mail-drafts-changed';
import { type MailFlagRefusedEvent, readFlagRefused } from './mail-flag-refused';
import { type MailFolderJobEvent, readFolderJobEvent } from './mail-folder-actions';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';

/**
 * A realtime "new mail appeared" nudge for a mailbox the current user can see.
 * Ids and a count only -- never subject, sender, or snippet (the backend never puts
 * content on a per-user channel). The subscriber refetches the folder/list over REST
 * off the `type` discriminator.
 */
export interface EmailLiveEvent {
    readonly type: 'mail.received';
    readonly mailboxId: string;
    readonly folder: string;
    readonly newCount: number;
    /** The mailbox's unread number: its inbox's alone, as the mailbox list serves it. Absent from an older server. */
    readonly mailboxUnseen?: number;
    /** The mailbox's change sequence, shared with mail.messages.changed. Absent from an older server. */
    readonly seq?: number;
}

/** How a sync the person asked for ended. `skipped`: another import held the mailbox, or it was switched off; not an error. */
export interface EmailSyncFinishedEvent {
    readonly type: 'mail.sync.finished';
    readonly mailboxId: string;
    readonly syncId: string;
    readonly outcome: 'ok' | 'failed' | 'skipped';
    readonly newCount: number;
    readonly finishedAt: string;
}

/** Every event of the person's mail channel. */
export type EmailEvent =
    | EmailLiveEvent | EmailSyncFinishedEvent | MailMessagesChangedEvent | MailAliasesChangedEvent | MailFlagRefusedEvent
    | MailDraftsChangedEvent | MailFolderJobEvent;

/** A whole number, zero or more. */
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * FE -- typed wrapper over the realtime transport for the per-user
 * channel `email.user.{userIdRfc4122}`. Mirror of `InboxLiveEventsService`: the
 * backend publishes the nudge to a mailbox's owner + delegates, and each of them
 * subscribes only to their own channel (owner-only auth is enforced server-side, so a
 * subscription to anyone else's channel is a 403).
 *
 * Malformed events (missing/unknown `type`) are silently dropped so a schema bump
 * across a partial roll-out can't blank the subscription. The returned Observable
 * opens the centrifuge subscription on the first RxJS subscriber and closes it when
 * the last unsubscribes. Every caller on the same channel shares that one subscription: the realtime client holds one
 * subscription per channel, so a second watcher that closed its own would close the first's too.
 */
@Injectable({ providedIn: 'root' })
export class EmailLiveEventsService {
    private readonly client = inject(CentrifugoClientService);
    private readonly watching = new Map<string, Observable<EmailEvent>>();

    /**
     * Subscribe to the current user's per-user mailbox channel. `userId` is the
     * user's UUID (rfc4122), matching the backend `MailboxChannelNameBuilder`.
     */
    watch(userId: string): Observable<EmailEvent> {
        const channel = `email.user.${userId}`;
        let shared = this.watching.get(channel);
        if (shared === undefined) {
            shared = this.open(channel).pipe(share());
            this.watching.set(channel, shared);
        }

        return shared;
    }

    /** Whether realtime is connected now: while it is not, what it would tell is read over REST instead. */
    connected(): boolean {
        return this.client.isConnected();
    }

    private open(channel: string): Observable<EmailEvent> {
        return new Observable<EmailEvent>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx): void => {
                        const evt = this.tryParse(ctx.data);
                        if (evt !== null) {
                            subscriber.next(evt);
                        }
                    };
                    sub.on('publication', publicationHandler);
                    if (sub.state !== 'subscribed') {
                        sub.subscribe();
                    }
                })
                .catch((err: unknown) => subscriber.error(err));

            return () => {
                unsubscribed = true;
                const sub = this.tryGetSubscription(channel);
                if (sub !== null) {
                    if (publicationHandler !== null) {
                        sub.off('publication', publicationHandler);
                    }
                    sub.unsubscribe();
                }
            };
        });
    }

    private tryGetSubscription(channel: string): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }

    private tryParse(raw: unknown): EmailEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const type = obj['type'];
        if (type === 'mail.messages.changed') {
            return readMessagesChanged(raw);
        }
        if (type === 'mail.aliases.changed') {
            return readAliasesChanged(raw);
        }
        if (type === 'mail.flag.refused') {
            return readFlagRefused(raw);
        }
        if (type === 'mail.drafts.changed') {
            return readDraftsChanged(raw);
        }
        if (type === 'mail.folders.job') {
            return readFolderJobEvent(raw);
        }
        if (type === 'mail.sync.finished') {
            return typeof obj['mailboxId'] === 'string' && typeof obj['syncId'] === 'string'
                ? raw as EmailSyncFinishedEvent
                : null;
        }
        if (typeof type !== 'string' || type !== 'mail.received') {
            return null;
        }
        if (typeof obj['mailboxId'] !== 'string' || typeof obj['folder'] !== 'string') {
            return null;
        }
        // A number or a seq that is not a count is dropped, not the nudge: the page then treats it as an older
        // server's.
        const unseen = obj['mailboxUnseen'];
        const seq = obj['seq'];
        const { mailboxUnseen: _unseen, seq: _seq, ...rest } = raw as EmailLiveEvent;
        return {
            ...rest,
            ...(isCount(unseen) ? { mailboxUnseen: unseen } : {}),
            ...(isCount(seq) ? { seq } : {}),
        };
    }
}
