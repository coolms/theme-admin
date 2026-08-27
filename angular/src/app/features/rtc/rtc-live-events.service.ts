import { Injectable, Signal, inject } from '@angular/core';
import { Subscription } from 'centrifuge';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';
import { RtcCallChannelNudge, RtcCallState, RtcIncomingCallNudge } from './rtc.types';

/**
 * Rtc realtime subscriber (Slice 4a) — the same shape as
 * {@link MessagesLiveEventsService}, over the shared {@link CentrifugoClientService}:
 *
 *  - {@link watchUserRing} — `rtc.user.{myId}`, the per-session incoming-call
 *    RING channel (someone placed a call to me).
 *  - {@link watchCall} — `rtc.call.{id}`, the per-call channel carrying lifecycle
 *    `call.state` nudges + `call.signal` SDP/ICE relays (subscribed only while a
 *    call is active).
 *
 * Each returns a cold Observable that subscribes on first subscriber and
 * unsubscribes from the Centrifugo channel on teardown.
 */
@Injectable({ providedIn: 'root' })
export class RtcLiveEventsService {
    private readonly client = inject(CentrifugoClientService);
    readonly isConnected: Signal<boolean> = this.client.isConnected;

    watchUserRing(userId: string): Observable<RtcIncomingCallNudge> {
        return this.observeChannel(`rtc.user.${userId}`, raw => this.parseIncoming(raw));
    }

    watchCall(callId: string): Observable<RtcCallChannelNudge> {
        return this.observeChannel(`rtc.call.${callId}`, raw => this.parseCallNudge(raw));
    }

    private observeChannel<T>(channel: string, parse: (raw: unknown) => T | null): Observable<T> {
        return new Observable<T>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client
                .connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);
                    publicationHandler = (ctx): void => {
                        const parsed = parse(ctx.data);
                        if (parsed !== null) {
                            subscriber.next(parsed);
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

    private tryGetSubscription(channel: string): Subscription | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }

    private parseIncoming(raw: unknown): RtcIncomingCallNudge | null {
        if (!this.isRecord(raw) || raw['type'] !== 'call.incoming') {
            return null;
        }
        const { callId, conversationId, fromUserId, mediaKind } = raw;
        if (typeof callId !== 'string' || typeof conversationId !== 'string' || typeof fromUserId !== 'string') {
            return null;
        }
        return {
            type: 'call.incoming',
            callId,
            conversationId,
            fromUserId,
            mediaKind: mediaKind === 'video' ? 'video' : 'audio',
        };
    }

    private parseCallNudge(raw: unknown): RtcCallChannelNudge | null {
        if (!this.isRecord(raw)) {
            return null;
        }
        if (raw['type'] === 'call.state' && typeof raw['callId'] === 'string' && typeof raw['state'] === 'string') {
            return { type: 'call.state', callId: raw['callId'], state: raw['state'] as RtcCallChannelNudge extends { state: infer S } ? S : never };
        }
        if (raw['type'] === 'call.signal' && typeof raw['callId'] === 'string' && typeof raw['from'] === 'string' && this.isRecord(raw['signal'])) {
            const signal = raw['signal'];
            const sigType = signal['type'];
            if (sigType === 'offer' || sigType === 'answer' || sigType === 'candidate') {
                return {
                    type: 'call.signal',
                    callId: raw['callId'],
                    from: raw['from'],
                    signal: { type: sigType, payload: signal['payload'], to: typeof signal['to'] === 'string' ? signal['to'] : undefined },
                };
            }
        }
        return null;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }
}
