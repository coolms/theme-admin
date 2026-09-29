import { Injectable, Signal, inject } from '@angular/core';
import { Subscription } from 'centrifuge';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';
import { RtcCallChannelNudge, RtcCallState, RtcIncomingCallNudge } from './rtc.types';

/**
 * Rtc realtime subscriber (Slice 4a) -- the same shape as
 * {@link MessagesLiveEventsService}, over the shared {@link CentrifugoClientService}:
 *
 *  - {@link watchUserRing} -- `rtc.user.{myId}`, the per-session incoming-call
 *    RING channel (someone placed a call to me).
 *  - {@link watchCall} -- `rtc.call.{id}`, the per-call channel carrying lifecycle
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

    /**
     * Ask for the realtime connection; {@link isConnected} says when it is up. Idempotent: the
     * shared client connects once, and after that reconnects by itself. Rejects when this
     * attempt fails (the connection token could not be had), so the caller can ask again.
     */
    async connect(): Promise<void> {
        await this.client.connect();
    }

    /**
     * `onSubscribed` runs each time the ring's subscription is confirmed by the server, reconnects
     * included -- the moment to read the calls ringing now, as {@link watchCall}'s is to read the
     * call: a ring published before it never arrives (Dmitry, 2026-09-29).
     */
    watchUserRing(userId: string, onSubscribed?: () => void): Observable<RtcIncomingCallNudge> {
        return this.observeChannel(`rtc.user.${userId}`, raw => this.parseIncoming(raw), onSubscribed);
    }

    /**
     * `onSubscribed` runs each time the channel's subscription becomes active -- at once when
     * it already is, and again after a resubscribe. The channel keeps no history, so what was
     * published on it before then never reaches this subscriber: a party that must not miss a
     * state reads it at that moment (a `call.state connected` published while the caller's
     * subscription was still being set up was lost, and the caller never started its media --
     * 1 of 60 call-harness runs, 2026-09-27).
     */
    watchCall(callId: string, onSubscribed?: () => void): Observable<RtcCallChannelNudge> {
        return this.observeChannel(`rtc.call.${callId}`, raw => this.parseCallNudge(raw), onSubscribed);
    }

    private observeChannel<T>(channel: string, parse: (raw: unknown) => T | null, onSubscribed?: () => void): Observable<T> {
        return new Observable<T>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;
            let subscribedHandler: (() => void) | null = null;

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
                    if (onSubscribed !== undefined) {
                        subscribedHandler = (): void => onSubscribed();
                        sub.on('subscribed', subscribedHandler);
                    }
                    if (sub.state !== 'subscribed') {
                        sub.subscribe();
                    } else {
                        onSubscribed?.();
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
                    if (subscribedHandler !== null) {
                        sub.off('subscribed', subscribedHandler);
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
            return {
                type: 'call.state',
                callId: raw['callId'],
                state: raw['state'] as RtcCallChannelNudge extends { state: infer S } ? S : never,
                politeUserId: typeof raw['politeUserId'] === 'string' ? raw['politeUserId'] : null,
                ...(typeof raw['version'] === 'number' ? { version: raw['version'] } : {}),
            };
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
