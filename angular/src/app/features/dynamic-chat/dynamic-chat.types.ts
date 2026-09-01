/**
 * DynamicChat agent panel — shared DTOs.
 *
 * The agent surface composes TWO backend modules:
 *  - DynamicChat owns discovery/join (`GET/POST /dynamic-chat/agent/conversations*`)
 *    -> {@link AgentConversationDto}.
 *  - Chat owns the message read/write (`GET/POST /chat/messages`) ->
 *    {@link ChatMessageDto}; realtime nudges arrive on `chat.room.{id}`
 *    -> {@link RoomNudge}.
 *
 * Field names mirror the backend resources verbatim
 * (`DynamicChatAgentConversationResource`, `ChatMessageResource`) so the JSON
 * deserialises straight onto these interfaces.
 */

/** A staff agent already handling a conversation. */
export interface QueueAgentDto {
    readonly userId: string;
    readonly displayName: string | null;
    /** Public avatar URL for a real photo (null -> render colored initials). */
    readonly avatarUrl?: string | null;
    /** Self-set presence status — `online`|`away`|`busy`|`offline` (null -> no dot). */
    readonly presenceStatus?: string | null;
}

/** A row in the agent queue (one active DynamicChat conversation). */
export interface AgentConversationDto {
    readonly id: string;
    readonly kind: string;
    /** Visitor display name captured when the session opened. */
    readonly title: string | null;
    readonly status: string;
    /** Per-conversation seq high-water mark (last message seq). */
    readonly lastSeq: number | null;
    /** Generic external-context link — for DynamicChat this is `'lead'`. */
    readonly contextType: string | null;
    readonly contextId: string | null;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    /** The agent's participant id — populated only by the join response. */
    readonly agentParticipantId?: string | null;
    /**
     * The staff agents who have JOINED this conversation — so the queue
     * shows who is already handling a visitor and a second agent doesn't
     * double-answer. Empty / absent for an unclaimed visitor.
     */
    readonly agents?: readonly QueueAgentDto[];
    /**
     * TRUE iff the CURRENT agent has claimed this conversation — i.e.
     * they are among {@link agents}. Drives the "Mine" queue tab + the Release
     * button.
     */
    readonly assignedToMe?: boolean;
    /**
     * Triage status: `'new'` (the visitor sent the latest message and
     * is waiting) or `'answered'` (an agent replied last). Drives the per-row
     * status badge; independent of who claimed it.
     */
    readonly agentStatus?: string;
}

/**
 * A file attached to a message (mirrors the backend `ChatAttachmentResource` /
 * the `attachments` element of `ChatMessageResource`,–).
 *
 * `vfsNodeId` is the durable reference; the bytes are fetched (authenticated)
 * from `GET /chat/attachments/{vfsNodeId}`. `kind` (`image` | `file`) is the
 * server-derived render hint.
 */
export interface ChatAttachmentDto {
    readonly vfsNodeId: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly kind: string;
}

/** One message in a conversation thread (generic Chat shape). */
export interface ChatMessageDto {
    readonly id: string;
    readonly conversationId: string;
    /** Server-assigned, strictly-increasing per-conversation sequence. */
    readonly seq: number;
    /** `text` | `system` | `event`. */
    readonly type: string;
    readonly body: string | null;
    readonly senderParticipantId: string | null;
    readonly clientId: string | null;
    readonly editedAt: string | null;
    readonly deletedAt: string | null;
    readonly createdAt: string | null;
    /** Files attached to the message (empty when none). */
    readonly attachments?: readonly ChatAttachmentDto[];
}

/**
 * The body-less realtime nudge published on `chat.room.{conversationId}`
 * by `ChatLivePublisher`. Carries only ids + the new `seq`; the body is
 * fetched via the cursor read (`GET /chat/messages?afterSeq=`).
 */
export interface RoomNudge {
    readonly type: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly seq: number;
    readonly messageType: string;
    readonly senderParticipantId: string | null;
}
