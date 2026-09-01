import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { AgentConversationDto, ChatAttachmentDto, ChatMessageDto } from './dynamic-chat.types';

/**
 * DynamicChat agent panel — thin API client.
 *
 * Standalone per-feature service (the precedent set by `InboxService` /
 * `CalendarLiveEventsService`), not bolted onto the large platform
 * `ApiService`. It spans two backend modules:
 *  - **DynamicChat agent** endpoints for the QUEUE + JOIN.
 *  - **Generic Chat** endpoints for reading history + posting replies
 *    (once joined, the agent is a normal participant).
 *
 * `Accept: application/json` is sent on the two collection reads so the
 * API-Platform providers return a BARE array (not a Hydra envelope). The
 * {@link unwrap} guard handles both shapes regardless, so a future content-
 * negotiation change can't break the page.
 */
@Injectable({ providedIn: 'root' })
export class DynamicChatService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    /** Force the bare-array representation on AP collection reads. */
    private get jsonHeaders(): HttpHeaders {
        return new HttpHeaders({ Accept: 'application/json' });
    }

    /**
     * GET /dynamic-chat/agent/conversations — the agent queue: every ACTIVE
     * DynamicChat conversation, most-recently-active first (NOT membership-
     * scoped, so unjoined visitor conversations show up).
     */
    listQueue(): Observable<AgentConversationDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/dynamic-chat/agent/conversations`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<AgentConversationDto>(raw)));
    }

    /**
     * POST /dynamic-chat/agent/conversations/{id}/join — join as an Agent
     * participant (idempotent). Returns the conversation enriched with
     * `agentParticipantId` (the id we post replies as / style "mine" by).
     */
    join(conversationId: string): Observable<AgentConversationDto> {
        return this.http.post<AgentConversationDto>(
            `${this.apiBase}/dynamic-chat/agent/conversations/${encodeURIComponent(conversationId)}/join`,
            {},
        );
    }

    /**
     * POST /dynamic-chat/agent/conversations/{id}/release — un-claim (leave) a
     * conversation so it returns to the Unassigned queue. Body-less ->
     * 204; the panel refetches the queue afterward. Idempotent.
     */
    release(conversationId: string): Observable<void> {
        return this.http.post<void>(
            `${this.apiBase}/dynamic-chat/agent/conversations/${encodeURIComponent(conversationId)}/release`,
            {},
        );
    }

    /**
     * GET /chat/messages?conversationId=&afterSeq=&limit= — the in-order
     * cursor catch-up read (every message with `seq > afterSeq`). Requires
     * the caller to be a participant, so call this only AFTER {@link join}.
     */
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
     * POST /chat/messages — post a reply. Delegates server-side to
     * `SendMessageService::sendAsUser` (row-locked seq, idempotency via
     * `clientId`, auto-resolves the agent's participant, realtime nudge).
     *
     * `attachments` carry the descriptors returned by {@link uploadAttachment};
     * only the durable fields are sent — the server re-derives `kind` from the
     * mime type.
     */
    postMessage(
        conversationId: string,
        body: string,
        clientId: string,
        attachments: readonly ChatAttachmentDto[] = [],
    ): Observable<ChatMessageDto> {
        const payload: Record<string, unknown> = { conversationId, body, clientId };
        if (attachments.length > 0) {
            payload['attachments'] = attachments.map(a => ({
                vfsNodeId: a.vfsNodeId,
                filename:  a.filename,
                mimeType:  a.mimeType,
                sizeBytes: a.sizeBytes,
            }));
        }
        return this.http.post<ChatMessageDto>(`${this.apiBase}/chat/messages`, payload);
    }

    /**
     * POST /chat/attachments — upload a file to the uploader's private VFS home
     * (multipart). Returns the descriptor to attach to a message. The server
     * gates the format + size (422 on a disallowed type,.
     */
    uploadAttachment(file: File): Observable<ChatAttachmentDto> {
        const form = new FormData();
        form.append('file', file);
        // Let the browser set the multipart boundary Content-Type; the auth
        // interceptor still attaches the Bearer token.
        return this.http.post<ChatAttachmentDto>(`${this.apiBase}/chat/attachments`, form);
    }

    /**
     * GET /chat/attachments/{id} — fetch the attachment bytes (authenticated,
     * participation-gated,. Returned as a Blob so the caller can
     * build an object URL for an `<img>` thumbnail or a download. An `<img src>`
     * can't carry the Bearer token, so images are loaded through this fetch.
     */
    downloadAttachment(vfsNodeId: string): Observable<Blob> {
        return this.http.get(
            `${this.apiBase}/chat/attachments/${encodeURIComponent(vfsNodeId)}`,
            { responseType: 'blob' },
        );
    }

    /**
     * Tolerate both a bare array and a Hydra collection envelope
     * (`member` / `hydra:member`) so the service is independent of the
     * negotiated representation.
     */
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
