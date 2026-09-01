/**
 * Internal Messages (admin user↔user chat) — shared DTOs.
 *
 * The page consumes the generic Chat conversation + message API (M7.d):
 *  - `GET /chat/conversations` / `POST /chat/conversations {withUserId}` ->
 *    {@link ChatConversationDto} (carries enriched {@link ConversationParticipantDto}s).
 *  - `GET/POST /chat/messages` -> {@link ChatMessageDto}.
 *
 * Field names mirror the backend `ChatConversationResource` /
 * `ChatMessageResource` verbatim so the JSON deserialises straight on.
 */

/** One active participant of a conversation (enriched by the backend factory). */
export interface ConversationParticipantDto {
    /** Matches a message's `senderParticipantId` — so we can mark "my" messages. */
    readonly participantId: string;
    /** The identity user behind a human participant (null for anonymous). */
    readonly userId: string | null;
    readonly displayName: string | null;
    /** Public avatar URL for a real photo (null -> render colored initials). */
    readonly avatarUrl?: string | null;
    /** Self-set presence status — `online`|`away`|`busy`|`offline` (null -> no dot). */
    readonly presenceStatus?: string | null;
    /** This participant's read cursor. For the VIEWER's own unread, prefer `viewerUnread`. */
    readonly lastReadSeq?: number;
    /** `human` | `anonymous` | `bot` | … */
    readonly kind: string;
    /** `owner` | `member` | … */
    readonly role: string;
}

/**
 * A public channel row from the discovery list (`GET /chat/channels`,
 * Chat-channels arc). Lean by design — a browse list only needs the name +
 * whether the caller has already joined (Join vs Open).
 */
export interface ChatChannelDto {
    readonly id: string;
    readonly title: string | null;
    /**
     * The handle `#qa-public-channel` cites — derived from the name when
     * the channel is opened and never changed, so an old reference keeps
     * resolving. Null for a channel whose name yields nothing sluggable; it is
     * browsable and joinable, just not `#`-citable.
     */
    readonly slug?: string | null;
    /** Whether the current user is already an active member of this channel. */
    readonly joined: boolean;
    readonly createdAt: string | null;
}

/** A conversation row (the Messages inbox + thread header). */
export interface ChatConversationDto {
    readonly id: string;
    /** `direct` | `group` | `internal` | `dynamic_chat`. */
    readonly kind: string;
    readonly title: string | null;
    readonly status: string;
    /** `private` (default) | `public` — a public GROUP is a channel (Chat-channels arc). */
    readonly visibility?: string;
    /** Per-conversation seq high-water mark (last message seq). */
    readonly lastSeq: number | null;
    readonly updatedAt: string | null;
    /**
     * One-line plain-text preview of the most recent top-level message — the
     * inbox row's second line (HTML flattened, whitespace collapsed, clipped
     * server-side). `'Message deleted'` for a tombstoned last message,
     * `📎 <filename>` for an attachment-only one; null when the conversation
     * has no messages yet.
     */
    readonly lastMessagePreview?: string | null;
    /** ISO timestamp of that most-recent message — the row's shown time + the most-recent-first sort key; null when none. */
    readonly lastMessageAt?: string | null;
    /** Whether the CURRENT viewer sent that most-recent message (the row prefixes "You: "); null when not resolved / no messages. */
    readonly lastMessageMine?: boolean | null;
    readonly participants?: readonly ConversationParticipantDto[];
    /**
     * The CURRENT viewer's membership state (membership/history semantics):
     * `'active'` (a normal member) or `'excluded'` (removed by the owner but
     * keeping read-only history — the FE shows a read-only banner + hides the
     * composer). Absent when not resolved.
     */
    readonly viewerState?: string | null;
    /**
     * The current viewer's own participant id — surfaced so the FE can mark "my"
     * messages even when the viewer is NOT in the active {@link participants}
     * roster (an excluded member isn't). Absent when not resolved.
     */
    readonly viewerParticipantId?: string | null;
    /**
     * Whether the CURRENT viewer has MUTED this conversation. A muted
     * conversation still delivers messages but is silenced: it's excluded from
     * the global unread badge and its row is dimmed. Toggled via
     * {@link MessagesService.mute}/{@link MessagesService.unmute}. Absent when not
     * resolved / not a participant.
     */
    readonly viewerMuted?: boolean;
    /**
     * The VIEWER's own read cursor.
     *
     *  Prefer this over looking yourself up in `participants` — an EXCLUDED
     * viewer is deliberately absent from that roster, so the lookup returned
     * nothing, the cursor fell back to 0, and the badge showed the whole
     * conversation as unread with no way to clear it.
     */
    readonly viewerLastReadSeq?: number;
    /**
     * The VIEWER's unread count for this conversation, computed server-side
     *.
     *
     *  Prefer this over `lastSeq - viewerLastReadSeq`. That form knows nothing
     * about the history CEILING an owner-excluded member has: their cursor
     * freezes at removal while the others keep talking, so the subtraction
     * climbed forever over messages they are forbidden to read and (rightly)
     * cannot mark read. The topbar total is computed server-side too, so
     * deriving the row differently is how the two come to disagree on screen.
     */
    readonly viewerUnread?: number;
}

/**
 * A file attached to a message. The shape is identical on the
 * upload response (`POST /chat/attachments`), on the message write payload, and
 * on the message read — `kind` is derived server-side from `mimeType` and is
 * absent on the write payload (sent-but-ignored is harmless).
 */
export interface ChatAttachmentDto {
    /** The VFS node id — also the download path segment: `/chat/attachments/{vfsNodeId}`. */
    readonly vfsNodeId: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    /** `image` (render inline thumbnail) | `file` (render a download chip). Read-only. */
    readonly kind?: 'image' | 'file';
}

/** One message in a thread (generic Chat shape). */
export interface ChatMessageDto {
    readonly id: string;
    readonly conversationId: string;
    /** Server-assigned, strictly-increasing per-conversation sequence. */
    readonly seq: number;
    /** `text` | `system` | `event`. */
    readonly type: string;
    readonly body: string | null;
    /** `plain` (render escaped) | `html` (already-sanitised fragment). */
    readonly bodyFormat?: string;
    readonly senderParticipantId: string | null;
    readonly clientId: string | null;
    readonly createdAt: string | null;
    /** Files attached to this message (empty/absent when none). */
    readonly attachments?: readonly ChatAttachmentDto[];
    /**
     * Threads T1. The top-level ROOT message this is a reply to; null/absent
     * for a top-level message. The main timeline shows only top-level messages;
     * replies are read via the thread panel (`listThread`).
     */
    readonly threadRootId?: string | null;
    /** Direct-reply count on THIS message (0 unless it is a thread root). */
    readonly replyCount?: number;
    /** ISO timestamp of the most-recent reply on this thread; null if none. */
    readonly lastReplyAt?: string | null;
    /** Pinning: ISO timestamp of when this message was pinned; null/absent = not pinned. */
    readonly pinnedAt?: string | null;
    /** Pinning: the participant id who pinned it; null when not pinned. */
    readonly pinnedByParticipantId?: string | null;
    /**
     * `@`-mentions: the users this message references, each `{userId, label}`
     * (`label` = the name as typed, snapshotted). A mention MAY target a
     * non-member ("mention anyway"). The page flags "mentions you" when any
     * entry is the current user's id + tints each `@label` token.
     */
    readonly mentions?: readonly MentionRef[];
    /**
     * Emoji reactions on this message: the stored `{emoji, userId}` set.
     * The page aggregates it into per-emoji chips (count + a "you reacted"
     * highlight). Toggled via {@link MessagesService.reactToMessage}; empty/absent
     * when no one has reacted.
     */
    readonly reactions?: readonly ReactionRef[];
}

/** One `@`-mention: a referenced user + the display label snapshotted into the body. */
export interface MentionRef {
    readonly userId: string;
    readonly label: string;
}

/** One emoji reaction: a short emoji grapheme + the user who reacted with it. */
export interface ReactionRef {
    readonly emoji: string;
    readonly userId: string;
}

/**
 * A row in the `@`-mention typeahead (v2). Merges conversation members
 * (`inConversation: true`) with directory search results (`false`, offered so a
 * mention can reach someone not in the conversation).
 */
export interface MentionCandidate {
    readonly userId: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
    readonly inConversation: boolean;
}
