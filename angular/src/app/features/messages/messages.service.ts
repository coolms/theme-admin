import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, catchError, map, of } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { ChatAttachmentDto, ChatChannelDto, ChatConversationDto, ChatMessageDto, MentionRef } from './messages.types';

/** A directory user surfaced by the mention typeahead (member or not). */
export interface MentionDirectoryUser {
    readonly userId: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
}

/**
 * Internal Messages — thin API client over the generic Chat conversation +
 * message API. Standalone per-feature service, like
 * {@link DynamicChatService} (the agent-panel sibling).
 *
 * `Accept: application/json` on collection reads forces the BARE array (not a
 * Hydra envelope); {@link unwrap} tolerates both shapes regardless.
 */
@Injectable({ providedIn: 'root' })
export class MessagesService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    private get jsonHeaders(): HttpHeaders {
        return new HttpHeaders({ Accept: 'application/json' });
    }

    /**
     * GET /chat/conversations — the current user's conversations, newest-active
     * first, PAGED.
     *
     * The response is a bare array with no total, so "is there more?" is read
     * off the LENGTH: fewer rows back than asked for means that was the last
     * page. Omitting `limit` takes the server default (30) rather than the whole
     * inbox — an unbounded read is no longer on offer from either side.
     */
    listConversations(limit?: number, offset = 0): Observable<ChatConversationDto[]> {
        let params = new HttpParams();
        if (typeof limit === 'number') {
            params = params.set('limit', String(limit));
        }
        if (offset > 0) {
            params = params.set('offset', String(offset));
        }
        return this.http
            .get<unknown>(`${this.apiBase}/chat/conversations`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatConversationDto>(raw)));
    }

    /**
     * POST /chat/conversations {withUserId} — open (or get the existing) 1:1
     * DM with another user; the response carries both participants.
     */
    openDirect(withUserId: string): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations`,
            { withUserId },
        );
    }

    /**
     * POST /chat/conversations {participantUserIds, title?} — open a NEW `group`
     * conversation with the given members (besides the creator, who is joined as
     * owner). Unlike {@link openDirect} this is NOT idempotent — each call mints
     * a fresh room. `title` is optional; when blank the FE renders the members'
     * names. The response carries every participant enriched with labels.
     */
    openGroup(participantUserIds: readonly string[], title?: string | null): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations`,
            { participantUserIds, title: title?.trim() ? title.trim() : undefined },
        );
    }

    /**
     * POST /chat/conversations {visibility:'public', title} — open a new PUBLIC
     * CHANNEL (Chat-channels arc): a discoverable, open-join group created solo
     * (the creator is its owner; others self-join). The response carries the
     * conversation so it can be selected immediately.
     */
    createChannel(title: string): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations`,
            { visibility: 'public', title: title.trim() },
        );
    }

    /**
     * POST /chat/conversations {selfNotes:true} — open (or return the existing)
     * the current user's private "message yourself" NOTES conversation:
     * a single-participant self-chat, idempotent (one per user). The response
     * carries the conversation (kind `self_notes`) so it drops straight into the
     * inbox and can be selected.
     */
    openSelfNotes(): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations`,
            { selfNotes: true },
        );
    }

    /**
     * GET /chat/channels — the public-channel discovery list (Chat-channels arc).
     * Every active public channel, each flagged `joined` for the current user
     * (Join vs Open). Membership-unscoped — the whole point of browsing.
     */
    listChannels(): Observable<ChatChannelDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/chat/channels`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<ChatChannelDto>(raw)));
    }

    /**
     * POST /chat/conversations/{id}/join — open self-join a public channel. Any
     * authenticated user; returns the conversation (with refreshed members) so
     * it drops straight into the inbox. Idempotent server-side.
     */
    joinChannel(conversationId: string): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations/${conversationId}/join`,
            {},
        );
    }

    /**
     * GET /chat/conversations/{id} — refetch ONE conversation (its enriched
     * participants). Used to refresh the members panel after a change that
     * returns 204 (a remove), where the response carries no body.
     */
    getConversation(conversationId: string): Observable<ChatConversationDto> {
        return this.http.get<ChatConversationDto>(
            `${this.apiBase}/chat/conversations/${conversationId}`,
            { headers: this.jsonHeaders },
        );
    }

    /**
     * POST /chat/conversations/{id}/participants {participantUserIds, shareHistory}
     * — add members to a GROUP (Chat-groups G2). Owner-only server-side (403 else).
     * Returns the conversation with its refreshed, enriched participant list.
     *
     * `shareHistory` (G2.1, default `true`) decides whether the new members may
     * read messages posted BEFORE they joined: `true` -> full history, `false` ->
     * they see only messages from now on. Enforced server-side per participant.
     */
    addParticipants(
        conversationId: string,
        participantUserIds: readonly string[],
        shareHistory = true,
    ): Observable<ChatConversationDto> {
        return this.http.post<ChatConversationDto>(
            `${this.apiBase}/chat/conversations/${conversationId}/participants`,
            { participantUserIds, shareHistory },
        );
    }

    /**
     * DELETE /chat/conversations/{id}/participants/{userId} — remove a member
     * (Owner) or leave the group yourself (`userId` == me). 204, no body.
     */
    removeParticipant(conversationId: string, userId: string): Observable<void> {
        return this.http.delete<void>(
            `${this.apiBase}/chat/conversations/${conversationId}/participants/${encodeURIComponent(userId)}`,
        );
    }

    /**
     * GET {identity.usersUrl}/{id} -> a user's display label, for a group-composer
     * chip (the group slice). Best-effort: falls back to the raw id on any error
     * or missing manifest URL, so a chip always renders. Mirrors the label
     * fallback chain used by `<app-user-search-select>`
     * (name -> fullName -> email -> identifier -> slug).
     */
    resolveUserLabel(userId: string): Observable<string> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const usersUrl = manifest?.identity?.usersUrl;
        if (!usersUrl) {
            return of(userId);
        }
        return this.http
            .get<Record<string, unknown>>(`${usersUrl}/${encodeURIComponent(userId)}`, { headers: this.jsonHeaders })
            .pipe(
                map(row => this.userLabel(row, userId)),
                catchError(() => of(userId)),
            );
    }

    /**
     * GET {identity.usersUrl}?filter=firstName cn "q"|lastName cn "q"|identifier cn "q"
     * &filter=isSystem eq false — the mention typeahead's DIRECTORY search
     * (`@`-mentions v2 / ): find users NOT (necessarily) in the conversation
     * so a mention can reach anyone. Matches by NAME (profile first/last) OR email
     * — the pipe (`|`) is one RQL OR-group inside a single `filter` param; the
     * repeated `filter` AND-combines the system-user exclusion. System
     * users are hidden. Best-effort: degrades to `[]` on error / missing manifest
     * URL / blank query. Labels prefer the full name (the backend's `displayName`
     * policy), so results read as real names, not emails.
     */
    searchUsers(query: string, limit = 8): Observable<MentionDirectoryUser[]> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const usersUrl = manifest?.identity?.usersUrl;
        // Strip quotes/backslashes (break the quoted RQL value) and pipes (the
        // OR-group separator) so the query can't escape its own clause.
        const q = query.trim().replace(/["\\|]/g, '');
        if (!usersUrl || q === '') {
            return of([]);
        }
        // Repeated `filter` params AND-combine server-side (the raw-QUERY_STRING RQL
        // parser honours duplicate keys, ); the first clause is a single
        // pipe-separated OR group (name OR email) — hide system users.
        const params = new HttpParams()
            .append('filter', `firstName cn "${q}"|lastName cn "${q}"|identifier cn "${q}"`)
            .append('filter', 'isSystem eq false')
            .set('itemsPerPage', String(limit));
        return this.http
            .get<unknown>(usersUrl, { headers: this.jsonHeaders, params })
            .pipe(
                map(raw => this.unwrap<Record<string, unknown>>(raw)
                    .map(row => ({
                        userId: typeof row['id'] === 'string' ? row['id'] : '',
                        displayName: this.userLabel(row, ''),
                        avatarUrl: typeof row['avatarUrl'] === 'string' ? row['avatarUrl'] : null,
                    }))
                    .filter(u => u.userId !== '')
                    .slice(0, limit)),
                catchError(() => of<MentionDirectoryUser[]>([])),
            );
    }

    /** Best display label for a user row (name -> fullName -> email -> identifier -> slug -> fallback). */
    private userLabel(row: Record<string, unknown>, fallback: string): string {
        for (const key of ['name', 'fullName', 'email', 'identifier', 'slug']) {
            const v = row[key];
            if (typeof v === 'string' && v.trim() !== '') {
                return v;
            }
        }
        return fallback;
    }

    /** GET /chat/messages?conversationId=&afterSeq=&limit= — the in-order cursor read. */
    listMessages(conversationId: string, afterSeq = 0, limit = 200): Observable<ChatMessageDto[]> {
        const params = new HttpParams()
            .set('conversationId', conversationId)
            .set('afterSeq', String(afterSeq))
            .set('limit', String(limit));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/messages`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatMessageDto>(raw)));
    }

    /**
     * GET /chat/messages?conversationId=&limit= (NO cursor) — the NEWEST `limit`
     * messages, ascending. The initial thread read for lazy paging: a
     * long conversation opens on its latest page, not its head. Older pages are
     * pulled on demand via {@link listBefore} as the user scrolls up.
     */
    listLatest(conversationId: string, limit = 40): Observable<ChatMessageDto[]> {
        const params = new HttpParams()
            .set('conversationId', conversationId)
            .set('limit', String(limit));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/messages`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatMessageDto>(raw)));
    }

    /**
     * GET /chat/messages?conversationId=&beforeSeq=&limit= — the `limit` messages
     * immediately BEFORE `beforeSeq`, ascending (lazy "load earlier", ).
     * The caller passes the lowest seq it currently holds and prepends the
     * returned page.
     */
    listBefore(conversationId: string, beforeSeq: number, limit = 40): Observable<ChatMessageDto[]> {
        const params = new HttpParams()
            .set('conversationId', conversationId)
            .set('beforeSeq', String(beforeSeq))
            .set('limit', String(limit));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/messages`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatMessageDto>(raw)));
    }

    /**
     * POST /chat/messages — post a message. Delegates server-side to
     * `SendMessageService::sendAsUser` (row-locked seq, `clientId` idempotency,
     * auto-resolves the sender's participant, realtime nudge). `bodyFormat`
     * selects the body kind: `plain` (escaped on render) or `html` (the rich
     * `comment`-profile composer, ) — the backend sanitises `html` to the
     * comment allow-list on write before it ever persists. Attachments are a
     * later slice.
     */
    postMessage(
        conversationId: string,
        body: string,
        clientId: string,
        bodyFormat: 'plain' | 'html' = 'plain',
        attachments: readonly ChatAttachmentDto[] = [],
        threadRootId?: string,
        mentions: readonly MentionRef[] = [],
    ): Observable<ChatMessageDto> {
        return this.http.post<ChatMessageDto>(
            `${this.apiBase}/chat/messages`,
            // `threadRootId` (Threads T1) posts the message as a reply under that
            // root; omitted -> a top-level message. `mentions` = the @-mentioned
            // users (each `{userId, label}`; may include non-members — the server
            // de-dupes + caps but does NOT membership-gate).
            {
                conversationId, body, clientId, bodyFormat, attachments,
                ...(threadRootId ? { threadRootId } : {}),
                ...(mentions.length ? { mentions } : {}),
            },
        );
    }

    /**
     * GET /chat/messages?conversationId=&threadRootId=&limit= — read ONE thread
     * (Threads T1): the root message + its replies, ascending seq. The thread
     * side-panel's read.
     */
    listThread(conversationId: string, rootId: string, limit = 200): Observable<ChatMessageDto[]> {
        const params = new HttpParams()
            .set('conversationId', conversationId)
            .set('threadRootId', rootId)
            .set('limit', String(limit));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/messages`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatMessageDto>(raw)));
    }

    /**
     * GET /chat/messages?conversationId=&pinned=1 — read the conversation's PINNED
     * messages (pinning), most-recently-pinned first. Feeds the pinned bar.
     */
    listPinned(conversationId: string, limit = 100): Observable<ChatMessageDto[]> {
        const params = new HttpParams()
            .set('conversationId', conversationId)
            .set('pinned', '1')
            .set('limit', String(limit));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/messages`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<ChatMessageDto>(raw)));
    }

    /**
     * POST /chat/messages/{id}/pin — pin a message to its conversation (pinning).
     * Any active member; 204. The server publishes a `pin` room nudge so peers
     * refresh their pinned bar.
     */
    pinMessage(messageId: string): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/chat/messages/${messageId}/pin`, {});
    }

    /** POST /chat/messages/{id}/unpin — unpin a message (pinning). 204. */
    unpinMessage(messageId: string): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/chat/messages/${messageId}/unpin`, {});
    }

    /**
     * POST /chat/messages/{id}/react `{emoji}` — TOGGLE the caller's emoji reaction
     * on a message. Reacting with an emoji the caller already used removes
     * it; 204. The server publishes a `reaction` room nudge so peers reconcile the
     * affected message's reaction chips. Reactions ride on the normal message reads
     * (no separate list endpoint — like mentions).
     */
    reactToMessage(messageId: string, emoji: string): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/chat/messages/${messageId}/react`, { emoji });
    }

    /**
     * POST /chat/attachments (multipart) — upload one file to the current user's
     * private chat-uploads store; returns the attachment descriptor to thread
     * into a subsequent {@link postMessage}. The server sniffs the
     * MIME (never trusts the client) + enforces an allow-list, so a rejected file
     * surfaces as a 4xx. We deliberately do NOT set `Content-Type` — the browser
     * must set the multipart boundary itself; the auth interceptor adds Bearer.
     */
    uploadAttachment(file: File): Observable<ChatAttachmentDto> {
        const form = new FormData();
        form.append('file', file, file.name);
        return this.http.post<ChatAttachmentDto>(`${this.apiBase}/chat/attachments`, form);
    }

    /**
     * POST /chat/conversations/{id}/typing — signal the current user is typing
     *. Fire-and-forget + ephemeral: the server publishes a body-less
     * `typing` nudge on the room channel (nothing persisted), so a transient
     * failure is harmless — the next keystroke re-sends. Returns 204 (no body).
     */
    sendTyping(conversationId: string): Observable<void> {
        return this.http.post<void>(
            `${this.apiBase}/chat/conversations/${conversationId}/typing`,
            {},
        );
    }

    /**
     * GET /chat/unread — unread messages across EVERY conversation, as one
     * number.
     *
     * The topbar badge used to fetch the whole inbox for this — every
     * conversation, with participants enriched from the identity directory and a
     * last-message preview each — to subtract two integers per row and sum them.
     * Muted conversations are excluded server-side, matching the per-row badge.
     *
     * Best-effort by convention: a caller keeps its last count on failure rather
     * than flashing to zero.
     */
    fetchUnreadTotal(): Observable<number> {
        return this.http
            .get<unknown>(`${this.apiBase}/chat/unread`, { headers: this.jsonHeaders })
            .pipe(map(raw => {
                const total = (raw as { total?: unknown } | null)?.total;

                return typeof total === 'number' && total > 0 ? total : 0;
            }));
    }

    /**
     * POST /chat/conversations/{id}/read[?upToSeq=N] — advance the caller's
     * `lastReadSeq`. Used to clear the unread badge on open.
     * Fire-and-forget; the cursor only moves forward server-side, so a redundant
     * call is harmless. Returns 204.
     *
     *  SEND `upToSeq` — the seq this client has actually received.
     * Without it the server marks everything up to the conversation's CURRENT
     * `lastSeq`, including messages that landed after this client's last fetch:
     * they are silently cleared from the badge, and — worse — the read receipt
     * tells their sender "Read" for a message the reader has never seen. The
     * server still clamps to its own `lastSeq`, so a stale or forged value can
     * only ever mark LESS.
     */
    markRead(conversationId: string, upToSeq?: number): Observable<void> {
        const params = typeof upToSeq === 'number' && upToSeq > 0
            ? new HttpParams().set('upToSeq', String(upToSeq))
            : undefined;

        return this.http.post<void>(
            `${this.apiBase}/chat/conversations/${conversationId}/read`,
            {},
            { params },
        );
    }

    /**
     * POST|DELETE /chat/conversations/{id}/mute — MUTE (`POST`) or UNMUTE
     * (`DELETE`) this conversation for the current user: a per-viewer
     * notification preference. A muted conversation still delivers messages but is
     * excluded from the global unread badge + produces no live inbox nudge.
     * Body-less; 204. Idempotent server-side, so a redundant toggle is harmless.
     */
    mute(conversationId: string): Observable<void> {
        return this.http.post<void>(
            `${this.apiBase}/chat/conversations/${conversationId}/mute`,
            {},
        );
    }

    unmute(conversationId: string): Observable<void> {
        return this.http.delete<void>(
            `${this.apiBase}/chat/conversations/${conversationId}/mute`,
        );
    }

    /**
     * PATCH /auth/me/status {status} — set the current user's presence status
     * (online/away/busy/offline,. The new status surfaces as a
     * colored dot on every avatar the user appears on (others' Messages views).
     * Returns the updated user resource (ignored by the caller).
     *
     * Must send `Content-Type: application/merge-patch+json`: the global
     * `api_platform.yaml` declares no `patch_formats`, so every PATCH op accepts
     * ONLY merge-patch — a plain `application/json` body is rejected 415
     * (the documented API-Platform PATCH gotcha; mirrors `ApiService.patchHeaders`).
     */
    setStatus(status: string): Observable<unknown> {
        return this.http.patch<unknown>(
            `${this.apiBase}/auth/me/status`,
            { status },
            { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
    }

    /**
     * GET /chat/presence?userIds=a,b,c — batched connection-derived online
     * lookup. Returns a `{uid -> online}` map for the queried
     * users, where `online` is TRUE iff that user currently holds a live
     * realtime connection (NOT the self-set status, ). Best-effort: the
     * caller polls this (debounced) and degrades to "all offline" on error.
     * An empty `userIds` resolves to `{}` without a round-trip.
     */
    fetchOnline(userIds: readonly string[]): Observable<Record<string, boolean>> {
        if (userIds.length === 0) {
            return of({});
        }
        const params = new HttpParams().set('userIds', userIds.join(','));
        return this.http
            .get<unknown>(`${this.apiBase}/chat/presence`, { headers: this.jsonHeaders, params })
            .pipe(
                map(raw => {
                    const out: Record<string, boolean> = {};
                    for (const row of this.unwrap<{ userId?: string; online?: boolean }>(raw)) {
                        if (typeof row.userId === 'string') {
                            out[row.userId] = row.online === true;
                        }
                    }
                    return out;
                }),
            );
    }

    /**
     * The authenticated download URL for an attachment (`GET /chat/attachments/
     * {vfsNodeId}`). Bearer-only — a plain `<img src>`/`<a href>` can't carry the
     * token, so callers fetch through HttpClient ({@link fetchAttachment} or the
     * `[vfsSecureSrc]` directive) and hand the browser an object URL.
     */
    downloadUrl(vfsNodeId: string): string {
        return `${this.apiBase}/chat/attachments/${vfsNodeId}`;
    }

    /** GET /chat/attachments/{id} as a Blob (participation-gated server-side). */
    fetchAttachment(vfsNodeId: string): Observable<Blob> {
        return this.http.get(this.downloadUrl(vfsNodeId), { responseType: 'blob' });
    }

    /** Tolerate a bare array OR a Hydra collection envelope. */
    private unwrap<T>(raw: unknown): T[] {
        if (Array.isArray(raw)) {
            return raw as T[];
        }
        if (raw !== null && typeof raw === 'object') {
            const obj = raw as Record<string, unknown>;
            const member = obj['member'] ?? obj['hydra:member'];
            if (Array.isArray(member)) {
                return member as T[];
            }
        }
        return [];
    }
}
