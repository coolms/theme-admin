import { ChatConversationDto } from './messages.types';

/**
 * When a conversation may be marked read, and how the optimistic cursor moves
 * until the server confirms.
 *
 * Both clients had their own copy of this and had drifted: the page refused to
 * mark read for an owner-EXCLUDED viewer, the quick panel asked anyway (and had
 * the request refused), and the panel's optimistic clear wrote somewhere nothing
 * reads from.
 */

/** The optimistic "I have read up to here" cursor, keyed by conversation id. */
export type ReadOverrides = Readonly<Record<string, number>>;

/**
 * May this viewer mark this conversation read up to `seq`?
 *
 * Two refusals, both load-bearing:
 *  - `seq <= 0` — there is nothing to claim, and claiming 0 is how a client
 *    ends up telling the server "mark everything".
 *  - an owner-EXCLUDED viewer — they are read-only up to a frozen ceiling, the
 *    server refuses their mark-read, and hides the control from them.
 *    Asking anyway is a request that exists only to be rejected.
 *
 *  A MISSING conversation is allowed, deliberately. Absence of a row is not
 * evidence of exclusion, and since the inbox is paged a deep-linked
 * conversation can be open while its row has not loaded — refusing there would
 * leave those messages permanently unread. The seq being claimed is the
 * client's own high-water either way, so nothing is over-claimed.
 */
export function mayMarkRead(conversation: ChatConversationDto | null | undefined, seq: number): boolean {
    return seq > 0 && conversation?.viewerState !== 'excluded';
}

/**
 * Advance the optimistic cursor for one conversation, monotonically.
 *
 *  MAX, never assignment. Two surfaces can mark the same conversation read,
 * and a slower one must not undo a faster one — the same monotonicity the server
 * enforces on the stored cursor.
 *
 *  This is what the unread badge actually consults while a mark-read is in
 * flight (see `unreadFor`). Optimistically editing the participant roster
 * instead does nothing: the badge prefers the server's `viewerUnread`, so the
 * edit is written where nothing reads from — which is what the quick panel was
 * doing, invisibly.
 */
export function advanceReadOverride(current: ReadOverrides, conversationId: string, seq: number): ReadOverrides {
    if (seq <= (current[conversationId] ?? 0)) {
        return current;
    }

    return { ...current, [conversationId]: seq };
}
