import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

/**
 * A body-less realtime nudge published on a conversation's `chat.room.{id}`
 * channel when a message is posted (ledger #1010). The payload deliberately
 * carries no body — the page refetches the new message(s) via the REST cursor
 * (`GET /chat/messages?afterSeq=`), which re-enforces the read ACLs.
 */
export interface ChatMessagePostedNudge {
    readonly type: 'message.posted';
    readonly conversationId: string;
    readonly messageId: string;
    readonly seq: number;
}

/**
 * An EPHEMERAL "X is typing…" nudge (ledger #1016) — nothing persisted, no `seq`.
 * Carries only the typist's `participantId`; the page maps it to a name from the
 * participants it already holds, shows the hint, and auto-clears it on idle.
 */
export interface ChatTypingNudge {
    readonly type: 'typing';
    readonly conversationId: string;
    readonly participantId: string;
}

/**
 * A READ-RECEIPT nudge (ledger #1018) — a participant advanced their read cursor
 * to `seq`. Carries the reader's `participantId` + their new read high-water so a
 * peer can flip the messages it sent (up to `seq`) to "Read" without a reload.
 * The durable cursor lives on the Participant row server-side; this is the live
 * hint, so dropping it only delays the receipt until the next (re)load.
 */
export interface ChatReadNudge {
    readonly type: 'read';
    readonly conversationId: string;
    readonly participantId: string;
    readonly seq: number;
}

/**
 * A PRESENCE nudge (ledger #1020) — a participant changed their self-set status
 * (online/away/busy/offline). Keyed by `userId` (presence is a per-USER
 * attribute that spans every conversation) so the page can flip the colored dot
 * on that person's avatar everywhere they appear, without a reload. Ephemeral;
 * the durable status lives on the user's profile.
 */
export interface ChatPresenceNudge {
    readonly type: 'presence';
    readonly conversationId: string;
    readonly userId: string;
    readonly status: string;
}

/**
 * A PIN nudge (pinning) — the conversation's set of pinned messages changed (a
 * message was pinned or unpinned). Body-less (just the `conversationId`); the
 * page re-fetches the pinned-messages bar via `GET /chat/messages?pinned=1`. The
 * pinned-list REST read is the source of truth, so dropping it only delays the
 * bar until the next (re)load.
 */
export interface ChatPinNudge {
    readonly type: 'pin';
    readonly conversationId: string;
}

/**
 * A REACTION nudge (#1334) — a message's emoji reactions changed (someone reacted
 * or un-reacted). Body-less (just the `conversationId`); the page reconciles the
 * affected message's reaction chips by re-reading the current window. The message
 * REST read is the source of truth, so dropping it only delays the chips until the
 * next (re)load.
 */
export interface ChatReactionNudge {
    readonly type: 'reaction';
    readonly conversationId: string;
}

/** Any room nudge the page reacts to (discriminated by `type`). */
export type ChatRoomNudge =
    | ChatMessagePostedNudge
    | ChatTypingNudge
    | ChatReadNudge
    | ChatPresenceNudge
    | ChatPinNudge
    | ChatReactionNudge;

/**
 * A per-USER inbox-activity nudge (ledger #1021) published on `chat.user.{uid}`
 * when a new message lands in ANY of the user's conversations. Body-less (just
 * the `conversationId`): the page refetches its conversation LIST so background
 * unread badges + presence dots update live, even for a conversation it isn't
 * currently viewing. The user subscribes to this channel for the whole session.
 */
export interface ChatInboxNudge {
    readonly type: 'inbox.activity';
    readonly conversationId: string;
}

/**
 * Internal Messages realtime (ledger #1010) — subscribes to a conversation's
 * `chat.room.{conversationId}` Centrifugo channel and emits each `message.posted`
 * nudge. Mirrors the per-feature live-events-service convention
 * (`VfsLiveEventsService`, `InboxLiveEventsService`, `DynamicChatLiveEventsService`):
 * a thin wrapper over the shared {@link CentrifugoClientService} that owns the
 * subscription's listener lifecycle and degrades silently if realtime is
 * unavailable (the page keeps a slow reconcile poll as the safety net).
 *
 * The per-channel subscription token is minted automatically by the client's
 * `getToken` callback (`POST /centrifugo/subscription-token`), gated server-side
 * by `ChatRoomChannelPolicyVoter`.
 */
@Injectable({ providedIn: 'root' })
export class MessagesLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /**
     * Reactive WebSocket connection state (passthrough to
     * {@link CentrifugoClientService.isConnected}): `true` only while the
     * Centrifugo push transport is connected. Lets a consumer SUSPEND its
     * polling fallback while push is healthy — polling is the no-realtime
     * fallback, not a parallel path (ledger #1041).
     */
    readonly isConnected: Signal<boolean> = this.client.isConnected;

    /** Subscribe to a conversation's room channel; emits each parsed nudge. */
    watchRoom(conversationId: string): Observable<ChatRoomNudge> {
        return this.observeChannel(`chat.room.${conversationId}`, raw => this.tryParse(raw));
    }

    /**
     * Subscribe to MY per-user inbox channel for the whole session (#1021),
     * independent of which conversation is open — emits an `inbox.activity` nudge
     * whenever a new message lands in any of my conversations. Gated server-side
     * to SELF by `ChatUserChannelPolicyVoter`.
     */
    watchUser(userId: string): Observable<ChatInboxNudge> {
        return this.observeChannel(`chat.user.${userId}`, raw => this.tryParseInbox(raw));
    }

    /**
     * Generic Centrifugo channel observer — connects, subscribes, emits each
     * publication the `parse` callback recognises, and tears the subscription
     * down on unsubscribe. Shared by {@link watchRoom} + {@link watchUser}.
     */
    private observeChannel<T>(channel: string, parse: (raw: unknown) => T | null): Observable<T> {
        return new Observable<T>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx): void => {
                        const nudge = parse(ctx.data);
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

    private tryGetSubscription(
        channel: string,
    ): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }

    /** Parse a recognised room nudge (`message.posted` / `typing` / `read` / `presence`); else null. */
    private tryParse(raw: unknown): ChatRoomNudge | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const conversationId = obj['conversationId'];
        if (typeof conversationId !== 'string') {
            return null;
        }

        if (obj['type'] === 'message.posted' && typeof obj['seq'] === 'number') {
            return {
                type:           'message.posted',
                conversationId,
                messageId:      typeof obj['messageId'] === 'string' ? obj['messageId'] : '',
                seq:            obj['seq'],
            };
        }

        if (obj['type'] === 'typing' && typeof obj['participantId'] === 'string') {
            return { type: 'typing', conversationId, participantId: obj['participantId'] };
        }

        if (
            obj['type'] === 'read'
            && typeof obj['participantId'] === 'string'
            && typeof obj['seq'] === 'number'
        ) {
            return { type: 'read', conversationId, participantId: obj['participantId'], seq: obj['seq'] };
        }

        if (
            obj['type'] === 'presence'
            && typeof obj['userId'] === 'string'
            && typeof obj['status'] === 'string'
        ) {
            return { type: 'presence', conversationId, userId: obj['userId'], status: obj['status'] };
        }

        if (obj['type'] === 'pin') {
            return { type: 'pin', conversationId };
        }

        if (obj['type'] === 'reaction') {
            return { type: 'reaction', conversationId };
        }

        return null;
    }

    /** Parse a per-user `inbox.activity` nudge (#1021); else null. */
    private tryParseInbox(raw: unknown): ChatInboxNudge | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        if (obj['type'] === 'inbox.activity' && typeof obj['conversationId'] === 'string') {
            return { type: 'inbox.activity', conversationId: obj['conversationId'] };
        }
        return null;
    }
}
