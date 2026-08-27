import { ChatConversationDto, ConversationParticipantDto } from './messages.types';

/**
 * How a conversation ROW is projected for display (#2126) — its label, its
 * unread count, its preview line, its sort key and its presence dot.
 *
 * Every one of these was written twice: once in the Messages page, once in the
 * topbar quick panel. Three had already drifted apart by the time they were
 * pulled together here, each in a way nobody would notice from either side
 * alone — which is the same failure the read-receipt and paging rules produced
 * before they were shared (#2112, #2120).
 */

/** The minimum a viewer needs to be identified against a row. */
type Viewer = string | null;

/**
 * A conversation's display label: an explicit title, else the OTHER people in
 * it.
 *
 * ⚠️ A self-notes room has no title and no other participants, so without its
 * own branch it falls all the way through to "Conversation". That is what the
 * quick panel showed while the page showed "Notes" — the same room named two
 * different things in one app.
 */
export function conversationLabel(conversation: ChatConversationDto | null, meId: Viewer): string {
    if (conversation === null) {
        return '';
    }
    if (conversation.kind === 'self_notes') {
        return 'Notes';
    }
    if (conversation.title !== null && conversation.title !== undefined && conversation.title.trim() !== '') {
        return conversation.title;
    }

    const labels = (conversation.participants ?? [])
        .filter(p => p.userId !== null && p.userId !== meId)
        .map(p => p.displayName ?? p.userId ?? '—');

    return labels.length > 0 ? labels.join(', ') : 'Conversation';
}

/**
 * The row's unread badge.
 *
 * The order of these three sources is the whole rule, and each step was a bug
 * once:
 *  - the SERVER's `viewerUnread` wins (#2119) — it is the only party that knows
 *    an owner-excluded viewer's history CEILING, past which unread must stop
 *    accruing;
 *  - `viewerLastReadSeq` before the roster lookup (#2111) — an excluded viewer
 *    is deliberately absent from `participants`, so the lookup silently yielded
 *    0 and showed their whole history as unread, permanently;
 *  - `optimisticReadSeq` is the local override while a mark-read is in flight,
 *    the one thing the server cannot know yet. Pass 0 where there is no such
 *    state to track.
 */
export function unreadFor(
    conversation: ChatConversationDto | null,
    meId: Viewer,
    optimisticReadSeq = 0,
): number {
    if (conversation === null) {
        return 0;
    }
    if (typeof conversation.viewerUnread === 'number' && optimisticReadSeq === 0) {
        return conversation.viewerUnread;
    }

    const serverRead = conversation.viewerLastReadSeq
        ?? (conversation.participants ?? []).find(p => p.userId === meId)?.lastReadSeq
        ?? 0;

    return Math.max(0, (conversation.lastSeq ?? 0) - Math.max(serverRead, optimisticReadSeq));
}

/** The row's second line: the server-derived preview, marked when it is yours. */
export function rowPreview(conversation: ChatConversationDto): string {
    const preview = conversation.lastMessagePreview?.trim();
    if (preview === undefined || preview === '') {
        return 'No messages yet';
    }

    return conversation.lastMessageMine === true ? `You: ${preview}` : preview;
}

/**
 * Epoch-ms of a row's last activity — the inbox's most-recent-first sort key.
 * Falls back to `updatedAt` for a conversation with no messages yet, and to 0
 * when neither parses, so an unreadable date sorts last instead of throwing the
 * comparator.
 */
export function lastActivityTs(conversation: ChatConversationDto): number {
    const iso = conversation.lastMessageAt ?? conversation.updatedAt;
    const ts = iso !== null && iso !== undefined ? Date.parse(iso) : Number.NaN;

    return Number.isNaN(ts) ? 0 : ts;
}

/**
 * The presence dot for one participant: their self-set status overlaid on
 * whether they actually hold a live connection.
 *
 * ⚠️ **`busy` and `away` are reported even when the connection layer says
 * nothing.** That is deliberate: connection presence can be unavailable for
 * operational reasons (Centrifugo down, presence disabled), and "who is
 * away/busy" should stay legible regardless. The quick panel's copy had it the
 * other way round — it required a live connection first — so a user who set
 * Busy and closed their tab showed a busy dot on the page and NO dot in the
 * panel.
 *
 * `offline` is the one status that always wins: "appear offline" means appear
 * offline even while connected.
 */
export function presenceDot(
    userId: string | null | undefined,
    manualStatus: string | null | undefined,
    onlineUserIds: ReadonlySet<string>,
): string | null {
    if (manualStatus === 'busy' || manualStatus === 'away') {
        return manualStatus;
    }
    if (manualStatus === 'offline') {
        return null;
    }

    return userId !== null && userId !== undefined && onlineUserIds.has(userId) ? 'online' : null;
}

/** The first participant who is not the viewer — the row's "counterpart". */
export function counterpartOf(
    conversation: ChatConversationDto | null,
    meId: Viewer,
): ConversationParticipantDto | undefined {
    return (conversation?.participants ?? []).find(p => p.userId !== null && p.userId !== meId);
}
