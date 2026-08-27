import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

/**
 * Notification Sub-phase F -- payload-aware Centrifugo watcher for
 * the `notifications.user.{userId}` and `notifications.broadcast`
 * channels. Sibling to `VfsLiveEventsService` and the void-only
 * `CentrifugoNotificationStreamService`; all three layer over the
 * same singleton `CentrifugoClientService` connection.
 *
 * The returned Observable wires a `publication` listener to the
 * underlying centrifuge `Subscription`, narrows the wire payload
 * via `coerce`, and emits typed events. Invalid payloads (anything
 * the backend `NotificationLivePublisher` would not produce) are
 * silently dropped. The teardown function removes the listener and
 * unsubscribes the centrifuge subscription when the last RxJS
 * subscriber goes away.
 *
 * Frontend uses the emitted event as a ping signal; actual
 * notification data comes from the REST polling endpoint.
 * `NotificationPollingService` calls `fetchNow()` on each emission.
 */
@Injectable({ providedIn: 'root' })
export class NotificationLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    watch(channel: string): Observable<NotificationPingEvent> {
        return new Observable<NotificationPingEvent>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx: { data: unknown }): void => {
                        const event = this.coerce(ctx.data);
                        if (event !== null) {
                            subscriber.next(event);
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

    private coerce(raw: unknown): NotificationPingEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const type = obj['type'];
        if (typeof type !== 'string') {
            return null;
        }
        return { type };
    }

    private tryGetSubscription(channel: string): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }
}

/**
 * Payload shape from backend `NotificationLivePublisher`. The
 * backend currently ships `{type: 'check'}`; the type field is kept
 * open so future ping variants can carry additional discriminators
 * without breaking the wire contract.
 */
export interface NotificationPingEvent {
    readonly type: string;
}

/**
 * Frontend mirror of backend `NotificationChannelNameBuilder`.
 * Centralizes the two notification channel names so the polling
 * service does not concatenate strings ad hoc.
 */
export const NotificationChannels = {
    user: (userId: string): string => `notifications.user.${userId}`,
    broadcast: (): string => 'notifications.broadcast',
} as const;
