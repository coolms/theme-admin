import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';
import { InboxLiveEvent } from './inbox.types';

/**
 * FE — typed wrapper over the realtime transport for the
 * per-user channel `inbox.{userIdRfc4122}`. Mirror of
 * `CalendarLiveEventsService`.
 *
 * **Transport seam (a follow-up).** Today this injects
 * `CentrifugoClientService` directly because that's the only realtime
 * client wired on the FE. The backend already publishes through the
 * `RealtimeBusInterface` abstraction, so swapping to Mercure (or any
 * SSE / WebSocket transport) is a backend-only change there. On the FE
 * side we still bind to Centrifugo directly -- a small follow-up
 * (`Extract FE RealtimeClientService seam`) will introduce a transport-
 * agnostic interface that both this service and `CalendarLiveEventsService`
 * inject; until then we keep this single-line dependency so swapping
 * is just a constructor edit (no logic change needed).
 *
 * **Payload typing.** Centrifugo delivers JSON; we cast to the typed
 * union `InboxLiveEvent`. Subscribers should still narrow on `event.type`
 * before dereferencing payload fields. Malformed events (missing
 * `type` discriminator) are silently dropped so a future schema bump
 * can't blank the subscription.
 *
 * The returned Observable manages the centrifuge subscription
 * lifecycle: opens on first RxJS subscriber, closes when the last
 * unsubscribes. Same shape as the sibling DataGrid + Calendar live
 * streams.
 */
@Injectable({ providedIn: 'root' })
export class InboxLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /**
     * Subscribe to the per-user inbox channel. Emits a typed event on
     * every publication.
     *
     * `userId` is the current user's UUID (rfc4122), matching the
     * backend `InboxLivePublisher::channelFor()` output.
     */
    watch(userId: string): Observable<InboxLiveEvent> {
        const channel = `inbox.${userId}`;

        return new Observable<InboxLiveEvent>(subscriber => {
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

    /**
     * Defensive: drop payloads that don't carry a recognised `type`
     * discriminator. Belt-and-braces guard against backend schema
     * drift between deploys -- a partial roll-out shouldn't break
     * subscribers that haven't shipped the new event shape yet.
     */
    private tryParse(raw: unknown): InboxLiveEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const type = obj['type'];
        if (type !== 'task.assigned' && type !== 'task.removed' && type !== 'task.claimable') {
            return null;
        }
        return raw as InboxLiveEvent;
    }
}
