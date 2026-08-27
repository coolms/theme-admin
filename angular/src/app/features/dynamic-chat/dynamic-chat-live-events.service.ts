import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';
import { RoomNudge } from './dynamic-chat.types';

/** The single shared agent-queue channel (backend `DynamicChatQueueChannel`, #1042). */
const QUEUE_CHANNEL = 'chat.dynamic-chat-queue';

/**
 * DynamicChat agent panel — realtime wrapper over `chat.room.{conversationId}`
 * (ledger #995). Mirror of `InboxLiveEventsService` / `VfsLiveEventsService`:
 * opens the Centrifugo subscription on the first RxJS subscriber, closes it
 * when the last unsubscribes.
 *
 * The channel carries a **body-less nudge** (`message.posted` + ids + the
 * new `seq`); the page reacts by pulling the new bodies via the Chat cursor
 * read. Subscribing is permitted for any authenticated user by
 * `ChatRoomChannelPolicyVoter`; the per-channel `getToken` callback inside
 * `CentrifugoClientService` mints/refreshes the subscription JWT.
 */
@Injectable({ providedIn: 'root' })
export class DynamicChatLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /**
     * Reactive WebSocket connection state (passthrough to
     * {@link CentrifugoClientService.isConnected}) — lets the queue surfaces
     * SUSPEND their polling fallback while push is healthy (#1042). Polling is
     * the no-realtime fallback, not a parallel path.
     */
    readonly isConnected: Signal<boolean> = this.client.isConnected;

    /**
     * Subscribe to the shared agent-queue channel (`chat.dynamic-chat-queue`,
     * #1042); emits each time the queue changed (a new visitor session, a message
     * on a DynamicChat conversation, or a claim/release). Body-less — the
     * subscriber refetches `GET /dynamic-chat/agent/conversations` (authoritative).
     */
    watchQueue(): Observable<void> {
        return new Observable<void>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(QUEUE_CHANNEL);

                    publicationHandler = (ctx): void => {
                        const obj = ctx.data;
                        if (typeof obj === 'object' && obj !== null
                            && (obj as Record<string, unknown>)['type'] === 'queue.changed') {
                            subscriber.next();
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
                const sub = this.tryGetSubscription(QUEUE_CHANNEL);
                if (sub !== null) {
                    if (publicationHandler !== null) {
                        sub.off('publication', publicationHandler);
                    }
                    sub.unsubscribe();
                }
            };
        });
    }

    /** Subscribe to a conversation's room channel; emits each nudge. */
    watchRoom(conversationId: string): Observable<RoomNudge> {
        const channel = `chat.room.${conversationId}`;

        return new Observable<RoomNudge>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx): void => {
                        const nudge = this.tryParse(ctx.data);
                        if (nudge !== null) {
                            subscriber.next(nudge);
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
     * Drop publications without a recognised `message.posted` discriminator
     * + the fields we rely on. Belt-and-braces against backend schema drift.
     */
    private tryParse(raw: unknown): RoomNudge | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        if (obj['type'] !== 'message.posted') {
            return null;
        }
        if (typeof obj['conversationId'] !== 'string' || typeof obj['seq'] !== 'number') {
            return null;
        }
        return {
            type:                obj['type'],
            conversationId:      obj['conversationId'],
            messageId:           typeof obj['messageId'] === 'string' ? obj['messageId'] : '',
            seq:                 obj['seq'],
            messageType:         typeof obj['messageType'] === 'string' ? obj['messageType'] : 'text',
            senderParticipantId: typeof obj['senderParticipantId'] === 'string' ? obj['senderParticipantId'] : null,
        };
    }
}
