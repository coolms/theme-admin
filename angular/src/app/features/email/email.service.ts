import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CreateDelegationRequest,
    DefinitionCatalogDto,
    EmailAttachmentDto,
    EmailAttachmentSaveResultDto,
    EmailDeleteResultDto,
    EmailFolderDto,
    EmailMailboxDto,
    EmailImportResultDto,
    EmailMessageDetailDto,
    EmailMessageDto,
    EmailOAuthProviderDto,
    EmailSearchHitDto,
    EmailSearchQuery,
    EmailSendResultDto,
    InboundWorkflowOption,
    MailboxConnectResultDto,
    MailboxDelegationDto,
    MailboxWriteRequest,
    OutgoingEmailRequest,
} from './email.types';

/**
 * M8.a.4 — thin API client for the Email mailbox client, over the backend
 * read/send/reply/folders/seen resources–). Standalone
 * per-feature service, like {@link MessagesService}.
 *
 * `Accept: application/json` on collection reads forces the BARE array (not a
 * Hydra envelope); {@link unwrap} tolerates both shapes regardless.
 */
@Injectable({ providedIn: 'root' })
export class EmailService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    private get jsonHeaders(): HttpHeaders {
        return new HttpHeaders({ Accept: 'application/json' });
    }

    /** GET /email/mailboxes — every configured mailbox (ROLE_ADMIN). */
    listMailboxes(): Observable<EmailMailboxDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<EmailMailboxDto>(raw)));
    }

    /** GET /email/mailboxes/{id} — one mailbox with its full connection settings. */
    getMailbox(id: string): Observable<EmailMailboxDto> {
        return this.http.get<EmailMailboxDto>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`, {
            headers: this.jsonHeaders,
        });
    }

    /** POST /email/mailboxes — create a mailbox connection. */
    createMailbox(request: MailboxWriteRequest): Observable<EmailMailboxDto> {
        return this.http.post<EmailMailboxDto>(`${this.apiBase}/email/mailboxes`, request);
    }

    /**
     * PATCH /email/mailboxes/{id} — update a mailbox. API Platform's Patch
     * op REQUIRES the `application/merge-patch+json` content type (else 415); only
     * the fields present in the body are applied.
     */
    updateMailbox(id: string, request: MailboxWriteRequest): Observable<EmailMailboxDto> {
        return this.http.patch<EmailMailboxDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`,
            request,
            { headers: new HttpHeaders({ 'Content-Type': 'application/merge-patch+json' }) },
        );
    }

    /** DELETE /email/mailboxes/{id} — remove a mailbox connection. */
    deleteMailbox(id: string): Observable<unknown> {
        return this.http.delete<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`);
    }

    /**
     * POST /email/mailboxes/{id}/authorize — begin the OAuth connect flow for a
     * pending OAuth mailbox (M8.f.2d ). Returns the provider consent URL; the
     * caller redirects the browser there. Empty body (the mailbox is the `{id}`).
     */
    authorizeMailbox(id: string): Observable<MailboxConnectResultDto> {
        return this.http.post<MailboxConnectResultDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}/authorize`,
            {},
        );
    }

    /** GET /email/oauth/providers — the registered OAuth mail providers for the picker. */
    listOAuthProviders(): Observable<EmailOAuthProviderDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/oauth/providers`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<EmailOAuthProviderDto>(raw)));
    }

    /**
     * GET /definitions?module=workflow — every DEPLOYED workflow definition, for the
     * mailbox editor's inbound-workflow picker. Reuses the cross-module
     * Definition-catalog endpoint–, ROLE_ADMIN) rather than a bespoke
     * route, and maps each row to a `{key,label}` option: `key` is the `definitionKey`
     * the backend starts on a new-conversation email, `label` is `displayName (key)`.
     * `unwrap` tolerates the Hydra envelope or a bare array; rows without a key are dropped.
     */
    listInboundWorkflowOptions(): Observable<InboundWorkflowOption[]> {
        const params = new HttpParams().set('module', 'workflow').set('itemsPerPage', '200');
        return this.http
            .get<unknown>(`${this.apiBase}/definitions`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<DefinitionCatalogDto>(raw).flatMap(row => {
                const key = (row.definitionKey ?? '').trim();
                if (key === '') {
                    return [];
                }
                const name = (row.displayName ?? '').trim();
                return [{ key, label: name !== '' && name !== key ? `${name} (${key})` : key }];
            })));
    }

    /** GET /email/mailboxes/{id}/folders — per-folder total + unread counts. */
    listFolders(mailboxId: string): Observable<EmailFolderDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/folders`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailFolderDto>(raw)));
    }

    /** GET /email/messages/{id}/thread — the message's conversation, oldest-sent first. */
    listThread(messageId: string): Observable<EmailMessageDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/thread`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailMessageDto>(raw)));
    }

    /** GET /email/mailboxes/{id}/messages?folder=&page= — newest-sent first, page size 50. */
    listMessages(mailboxId: string, folder: string, page = 1): Observable<EmailMessageDto[]> {
        const params = new HttpParams().set('folder', folder).set('page', String(page));
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/messages`, {
                headers: this.jsonHeaders,
                params,
            })
            .pipe(map(raw => this.unwrap<EmailMessageDto>(raw)));
    }

    /**
     * GET /email/search — full-text search across stored messages. Scoped by
     * the optional `mailboxId`/`folder`/`seen` filters; offset-paginated (server page
     * size 20). The bare-array read (`Accept: application/json`) carries no total, so
     * the caller pages by "a full page came back" like {@link listMessages}.
     */
    searchMessages(query: EmailSearchQuery): Observable<EmailSearchHitDto[]> {
        let params = new HttpParams().set('q', query.q).set('page', String(query.page ?? 1));
        if (query.mailboxId !== undefined && query.mailboxId !== '') {
            params = params.set('mailboxId', query.mailboxId);
        }
        if (query.folder !== undefined && query.folder !== '') {
            params = params.set('folder', query.folder);
        }
        if (query.seen !== undefined) {
            params = params.set('seen', query.seen ? 'true' : 'false');
        }
        return this.http
            .get<unknown>(`${this.apiBase}/email/search`, { headers: this.jsonHeaders, params })
            .pipe(map(raw => this.unwrap<EmailSearchHitDto>(raw)));
    }

    /** GET /email/messages/{id} — one message with its raw RFC-822 body (detail). */
    getMessage(messageId: string): Observable<EmailMessageDetailDto> {
        return this.http.get<EmailMessageDetailDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}`,
            { headers: this.jsonHeaders },
        );
    }

    /** GET /email/messages/{id}/attachments — attachment metadata parsed from the stored `.eml`. */
    listAttachments(messageId: string): Observable<EmailAttachmentDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailAttachmentDto>(raw)));
    }

    /**
     * GET /email/messages/{id}/attachments/{index}/download as a Blob. Bearer-only —
     * a plain `<a href>` can't carry the token, so the caller hands the browser an object URL.
     */
    fetchAttachment(messageId: string, index: number): Observable<Blob> {
        return this.http.get(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments/${index}/download`,
            { responseType: 'blob' },
        );
    }

    /** POST /email/messages/{id}/attachments/{index}/save — copy an attachment into the user's VFS home. */
    saveAttachment(messageId: string, index: number): Observable<EmailAttachmentSaveResultDto> {
        return this.http.post<EmailAttachmentSaveResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments/${index}/save`,
            {},
        );
    }

    /** POST /email/messages/{id}/seen — mark read/unread. */
    markSeen(messageId: string, seen = true): Observable<unknown> {
        return this.http.post<unknown>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/seen`,
            { seen },
        );
    }

    /** POST /email/messages/{id}/flag — flag/star or unflag a message. */
    markFlagged(messageId: string, flagged = true): Observable<unknown> {
        return this.http.post<unknown>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/flag`,
            { flagged },
        );
    }

    /**
     * POST /email/messages/{id}/move — move a message to another folder.
     * PROPAGATES to the remote IMAP server; on success the message leaves its
     * current folder (re-homed under a new UID by the server).
     */
    moveMessage(messageId: string, folder: string): Observable<unknown> {
        return this.http.post<unknown>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/move`,
            { folder },
        );
    }

    /**
     * POST /email/messages/{id}/delete — Gmail-style delete: by default a
     * normal message is moved to Trash (recoverable) and one already in Trash is
     * purged; `permanent: true` forces a permanent delete from ANY folder (the
     * "Delete permanently" prompt choice). PROPAGATES to the remote IMAP server;
     * `purged` reports whether it was permanently removed.
     */
    deleteMessage(messageId: string, permanent = false): Observable<EmailDeleteResultDto> {
        return this.http.post<EmailDeleteResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/delete`,
            { permanent },
        );
    }

    /** POST /email/mailboxes/{id}/send — send a new message through the mailbox's SMTP. */
    send(mailboxId: string, request: OutgoingEmailRequest): Observable<EmailSendResultDto> {
        return this.http.post<EmailSendResultDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/send`,
            request,
        );
    }

    /** POST /email/messages/{id}/reply — reply to a stored message, threaded. */
    reply(messageId: string, request: OutgoingEmailRequest): Observable<EmailSendResultDto> {
        return this.http.post<EmailSendResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/reply`,
            request,
        );
    }

    /**
     * POST /email/mailboxes/{id}/import — import a `.eml`/`.mbox` file's text into the
     * mailbox. The file is read client-side and sent as the `content` string,
     * mirroring the module's other JSON action-POSTs; `mbox: true` bulk-splits an mbox
     * archive, else it's a single `.eml`. Imported mail is searchable but does NOT
     * trigger inbound workflows (the backend flags it, ).
     */
    importMail(mailboxId: string, content: string, folder: string, mbox: boolean): Observable<EmailImportResultDto> {
        return this.http.post<EmailImportResultDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/import`,
            { content, folder, mbox },
        );
    }

    /** GET /email/mailboxes/{mailboxId}/delegations — the mailbox's delegates, MANAGE-gated. */
    listDelegations(mailboxId: string): Observable<MailboxDelegationDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<MailboxDelegationDto>(raw)));
    }

    /** POST /email/mailboxes/{mailboxId}/delegations — grant a delegate read + send-as; notifies the owner. */
    grantDelegation(mailboxId: string, request: CreateDelegationRequest): Observable<MailboxDelegationDto> {
        return this.http.post<MailboxDelegationDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations`,
            request,
        );
    }

    /** DELETE /email/mailboxes/{mailboxId}/delegations/{id} — revoke a delegate. */
    revokeDelegation(mailboxId: string, id: string): Observable<unknown> {
        return this.http.delete<unknown>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations/${encodeURIComponent(id)}`,
        );
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
