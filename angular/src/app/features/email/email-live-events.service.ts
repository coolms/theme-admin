import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

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
}

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
 * the last unsubscribes.
 */
@Injectable({ providedIn: 'root' })
export class EmailLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /**
     * Subscribe to the current user's per-user mailbox channel. `userId` is the
     * user's UUID (rfc4122), matching the backend `MailboxChannelNameBuilder`.
     */
    watch(userId: string): Observable<EmailLiveEvent> {
        const channel = `email.user.${userId}`;

        return new Observable<EmailLiveEvent>(subscriber => {
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

    private tryParse(raw: unknown): EmailLiveEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const type = obj['type'];
        if (typeof type !== 'string' || type !== 'mail.received') {
            return null;
        }
        if (typeof obj['mailboxId'] !== 'string' || typeof obj['folder'] !== 'string') {
            return null;
        }
        return raw as EmailLiveEvent;
    }
}
