import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

/**
 * M9.c payload — a flat, low-cardinality snapshot of a CallRecord state
 * transition, published by `CentrifugoCallEventPublisher`. The `type`
 * discriminator is `call.{state}` (`call.ringing` / `call.answered` /
 * `call.on_hold` / `call.ended`) so a wallboard can switch on the semantic
 * event; the rest is the same shape a call card renders from.
 */
export interface CallLiveEvent {
    readonly type:            string; // 'call.ringing' | 'call.answered' | 'call.on_hold' | 'call.ended'
    readonly id:              string;
    readonly callId:          string;
    readonly direction:       string;
    readonly state:           string; // 'ringing' | 'answered' | 'on_hold' | 'ended'
    readonly fromNumber:      string | null;
    readonly toNumber:        string | null;
    readonly callerName:      string | null;
    readonly assignedUserRef: string | null;
    /** M9.g A.2 — the extension that answered (raw fallback label). */
    readonly answeredExtension: string | null;
    /** M9.g A.2 — the answering agent's resolved display name, or null. */
    readonly answeredByName:  string | null;
    readonly startedAt:       string;
    readonly answeredAt:      string | null;
    readonly endedAt:         string | null;
    readonly durationSeconds: number | null;
}

/**
 * M9.f.3 — Call telephony realtime. Subscribes to the M9.c Centrifugo channels
 * and emits each parsed {@link CallLiveEvent}. Mirrors the per-feature
 * live-events-service convention ({@link MessagesLiveEventsService},
 * `InboxLiveEventsService`, `DynamicChatLiveEventsService`): a thin wrapper over
 * the shared {@link CentrifugoClientService} that owns the subscription's
 * listener lifecycle and degrades silently if realtime is unavailable.
 *
 * Two scopes (both server-gated — the per-channel subscription token is minted
 * by the client's `getToken` callback, `POST /centrifugo/subscription-token`):
 *  - `calls.broadcast`  — the wallboard firehose, `ROLE_CALL`-gated
 *    (`CallBroadcastChannelPolicyVoter`); carries caller phone numbers.
 *  - `calls.{agentUuid}` — an agent's own calls, own-user gated
 *    (`CallAgentChannelPolicyVoter`).
 */
@Injectable({ providedIn: 'root' })
export class CallLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /** Reactive WebSocket connection state (passthrough to the shared client). */
    readonly isConnected: Signal<boolean> = this.client.isConnected;

    /**
     * Live-observer count per channel. `getOrCreateSubscription` hands back ONE
     * shared Centrifugo subscription per channel, so `calls.broadcast` — watched
     * by BOTH the global screen-pop overlay (mounted for the whole session) and
     * the Live-calls wallboard page — must be `unsubscribe()`d only when the LAST
     * observer leaves. Without this refcount, navigating away from the wallboard
     * tore down the shared subscription and silently killed the overlay
     * everywhere but that page.
     */
    private readonly channelRefs = new Map<string, number>();

    /** Subscribe to the wallboard firehose (`calls.broadcast`). */
    watchBroadcast(): Observable<CallLiveEvent> {
        return this.observeChannel('calls.broadcast');
    }

    /** Subscribe to one agent's own-calls channel (`calls.{agentUuid}`). */
    watchAgent(agentUuid: string): Observable<CallLiveEvent> {
        return this.observeChannel(`calls.${agentUuid}`);
    }

    /**
     * Generic Centrifugo channel observer — connects, subscribes, emits each
     * publication `tryParse` recognises, and tears the subscription down on
     * unsubscribe. Mirrors {@link MessagesLiveEventsService.observeChannel}.
     */
    private observeChannel(channel: string): Observable<CallLiveEvent> {
        return new Observable<CallLiveEvent>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            // Retain synchronously — the teardown below is guaranteed to run once
            // per observer, so the count stays balanced even if connect() is still
            // pending when the observer unsubscribes.
            this.channelRefs.set(channel, (this.channelRefs.get(channel) ?? 0) + 1);

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx): void => {
                        const ev = this.tryParse(ctx.data);
                        if (ev !== null) {
                            subscriber.next(ev);
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
                const remaining = Math.max(0, (this.channelRefs.get(channel) ?? 1) - 1);
                if (remaining === 0) {
                    this.channelRefs.delete(channel);
                } else {
                    this.channelRefs.set(channel, remaining);
                }
                const sub = this.tryGetSubscription(channel);
                if (sub !== null) {
                    if (publicationHandler !== null) {
                        sub.off('publication', publicationHandler);
                    }
                    // Only tear down the SHARED subscription when the last observer
                    // leaves — otherwise a sibling consumer (e.g. the global overlay)
                    // would stop receiving publications.
                    if (remaining === 0) {
                        sub.unsubscribe();
                    }
                }
            };
        });
    }

    private tryGetSubscription(
        channel: string,
    ): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }

    /** Parse a recognised `call.*` transition; else null. */
    private tryParse(raw: unknown): CallLiveEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const o = raw as Record<string, unknown>;
        const type = o['type'];
        const id   = o['id'];
        if (typeof type !== 'string' || !type.startsWith('call.') || typeof id !== 'string') {
            return null;
        }
        const str  = (v: unknown): string        => (typeof v === 'string' ? v : '');
        const nStr = (v: unknown): string | null  => (typeof v === 'string' ? v : null);
        return {
            type,
            id,
            callId:          str(o['callId']),
            direction:       str(o['direction']),
            state:           str(o['state']),
            fromNumber:      nStr(o['fromNumber']),
            toNumber:        nStr(o['toNumber']),
            callerName:      nStr(o['callerName']),
            assignedUserRef: nStr(o['assignedUserRef']),
            answeredExtension: nStr(o['answeredExtension']),
            answeredByName:  nStr(o['answeredByName']),
            startedAt:       str(o['startedAt']),
            answeredAt:      nStr(o['answeredAt']),
            endedAt:         nStr(o['endedAt']),
            durationSeconds: typeof o['durationSeconds'] === 'number' ? o['durationSeconds'] : null,
        };
    }
}
