import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map, throwError } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { type CapabilityState } from '@coolms/ui-angular';
import {
    CreateDelegationRequest,
    DefinitionCatalogDto,
    EmailAttachmentDto,
    EmailAttachmentSaveResultDto,
    EmailBulkResultDto,
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
    MailboxDraftRequest,
    MailboxTestRequest,
    MailboxTestResult,
    MailboxWriteRequest,
    OutgoingEmailRequest,
    SystemMailChoice,
    SystemMailDto,
    SystemMailSendAsDto,
} from './email.types';
import type { FilterFolder, MailboxFilter, MailboxFilterWrite } from './mailbox-filters';

/** The actions on a mailbox's settings the page asks about. */
export type MailboxAction = 'email.mailbox.update' | 'email.mailbox.authorize';

/** A section save of a mailbox read with no version is not sent: it could only go over what is stored now, unseen. */
export class MailboxNotReadError extends Error {
    constructor(readonly mailboxId: string) {
        super(`The mailbox "${mailboxId}" was read with no version, so its settings are not saved.`);
        this.name = 'MailboxNotReadError';
    }
}

/**
 * A save refused because the mailbox's settings changed since they were read (412), or because they were read with
 * no version: nothing was saved. What the person can do is reload; the save is never sent again on its own.
 */
export function mailboxChangedSinceRead(err: unknown): boolean {
    return err instanceof MailboxNotReadError || (err instanceof HttpErrorResponse && err.status === 412);
}

/**
 * Thin API client for the Email mailbox client, over the backend
 * read/send/reply/folders/seen resources-). Standalone
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

    /** GET /email/mailboxes -- every configured mailbox (ROLE_ADMIN). */
    listMailboxes(): Observable<EmailMailboxDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<EmailMailboxDto>(raw)));
    }

    /**
     * GET /email/mailboxes?access=read -- every mailbox the caller may read: their own, the ones they manage, and the
     * ones delegated to them, each with the caller's `access`.
     */
    listReadableMailboxes(): Observable<EmailMailboxDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes`, { headers: this.jsonHeaders, params: { access: 'read' } })
            .pipe(map(raw => this.unwrap<EmailMailboxDto>(raw)));
    }

    /** GET /email/mailboxes/{id} -- one mailbox with its full connection settings. */
    getMailbox(id: string): Observable<EmailMailboxDto> {
        return this.http.get<EmailMailboxDto>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`, {
            headers: this.jsonHeaders,
        });
    }

    /** POST /email/mailboxes -- create a mailbox connection. */
    createMailbox(request: MailboxWriteRequest): Observable<EmailMailboxDto> {
        return this.http.post<EmailMailboxDto>(`${this.apiBase}/email/mailboxes`, request);
    }

    /**
     * PATCH /email/mailboxes/{id} for one settings section: only the section's fields, naming the version of the
     * settings as read (If-Match). API Platform's Patch requires `application/merge-patch+json` (else 415); only the
     * fields present in the body are applied. A mailbox read with no version is not written -- the save could only go over
     * whatever is stored now, unseen ({@link MailboxNotReadError}); one changed since is refused by the server (412).
     */
    saveMailboxSection(
        id: string,
        request: MailboxWriteRequest,
        version: string | number | null | undefined,
    ): Observable<EmailMailboxDto> {
        if (version === null || version === undefined || version === '') {
            return throwError(() => new MailboxNotReadError(id));
        }
        return this.http.patch<EmailMailboxDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`,
            request,
            { headers: new HttpHeaders({ 'Content-Type': 'application/merge-patch+json', 'If-Match': `"${version}"` }) },
        );
    }

    /**
     * POST /email/mailboxes/{id}/test: signs in to the incoming and the outgoing server with what is given -- a field
     * left out comes from the stored mailbox, the stored credential when no password is given -- and stores nothing.
     * Each protocol answers connected, or its error kind in a fixed sentence. Ten tests a person in ten minutes: then
     * 429, with Retry-After.
     */
    testMailbox(id: string, request: MailboxTestRequest): Observable<MailboxTestResult> {
        return this.http.post<MailboxTestResult>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}/test`, request);
    }

    /**
     * What the caller may do to one mailbox's settings, as GET /capabilities answers it -- `allowed`, `elevate` or
     * `denied` per action. An action the answer leaves out is `denied`.
     */
    mailboxCapabilities(id: string): Observable<Record<MailboxAction, CapabilityState>> {
        const actions: readonly MailboxAction[] = ['email.mailbox.update', 'email.mailbox.authorize'];
        const params = new HttpParams().set('actions', actions.join(',')).set('subject', id);
        return this.http
            .get<{ results?: ReadonlyArray<{ action?: string; state?: string }> }>(`${this.apiBase}/capabilities`, {
                headers: this.jsonHeaders,
                params,
            })
            .pipe(map(answer => {
                const states = {} as Record<MailboxAction, CapabilityState>;
                for (const action of actions) {
                    const state = (answer.results ?? []).find(r => r.action === action)?.state;
                    states[action] = state === 'allowed' || state === 'elevate' ? state : 'denied';
                }
                return states;
            }));
    }

    /** DELETE /email/mailboxes/{id} -- remove a mailbox connection. */
    deleteMailbox(id: string): Observable<unknown> {
        return this.http.delete<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}`);
    }

    /**
     * POST /email/mailboxes/{id}/authorize -- begin the OAuth connect flow for an
     * EXISTING OAuth mailbox (re-authorising one whose grant died). Returns the
     * provider consent URL; the caller redirects the browser there. Empty body (the
     * mailbox is the `{id}`).
     */
    authorizeMailbox(id: string): Observable<MailboxConnectResultDto> {
        return this.http.post<MailboxConnectResultDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(id)}/authorize`,
            {},
        );
    }

    /**
     * POST /email/mailboxes/connect -- begin an AUTHORIZE-FIRST connect for a NEW
     * OAuth mailbox. Creates no mailbox: the server keeps the intended mailbox as a
     * short-lived draft, answers with the consent URL, and builds the row only after
     * the callback has proven the grant. The caller redirects the browser to
     * `authorizationUrl`; the callback bounces to `/admin/email?oauth=connected&mailbox=`.
     */
    connectMailboxDraft(request: MailboxDraftRequest): Observable<MailboxConnectResultDto> {
        return this.http.post<MailboxConnectResultDto>(`${this.apiBase}/email/mailboxes/connect`, request);
    }

    /** GET /email/oauth/providers -- the registered OAuth mail providers for the picker. */
    listOAuthProviders(): Observable<EmailOAuthProviderDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/oauth/providers`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<EmailOAuthProviderDto>(raw)));
    }

    /**
     * GET /definitions?module=workflow -- every DEPLOYED workflow definition, for the
     * mailbox editor's inbound-workflow picker. Reuses the cross-module
     * Definition-catalog endpoint-, ROLE_ADMIN) rather than a bespoke
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

    /** GET /email/mailboxes/{id}/folders -- per-folder total + unread counts. */
    listFolders(mailboxId: string): Observable<EmailFolderDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/folders`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailFolderDto>(raw)));
    }

    /** GET /email/messages/{id}/thread -- the message's conversation, oldest-sent first. */
    listThread(messageId: string): Observable<EmailMessageDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/thread`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailMessageDto>(raw)));
    }

    /** GET /email/mailboxes/{id}/messages?folder=&page= -- newest-sent first, page size 50. */
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
     * GET /email/search -- full-text search across stored messages. Scoped by
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

    /** GET /email/messages/{id} -- one message with its raw RFC-822 body (detail). */
    getMessage(messageId: string): Observable<EmailMessageDetailDto> {
        return this.http.get<EmailMessageDetailDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}`,
            { headers: this.jsonHeaders },
        );
    }

    /** GET /email/messages/{id}/attachments -- attachment metadata parsed from the stored `.eml`. */
    listAttachments(messageId: string): Observable<EmailAttachmentDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<EmailAttachmentDto>(raw)));
    }

    /**
     * GET /email/messages/{id}/attachments/{index}/download as a Blob. Bearer-only --
     * a plain `<a href>` can't carry the token, so the caller hands the browser an object URL.
     */
    fetchAttachment(messageId: string, index: number): Observable<Blob> {
        return this.http.get(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments/${index}/download`,
            { responseType: 'blob' },
        );
    }

    /** POST /email/messages/{id}/attachments/{index}/save -- copy an attachment into the user's VFS home. */
    saveAttachment(messageId: string, index: number): Observable<EmailAttachmentSaveResultDto> {
        return this.http.post<EmailAttachmentSaveResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/attachments/${index}/save`,
            {},
        );
    }

    /** POST /email/messages/{id}/seen -- mark read/unread. */
    markSeen(messageId: string, seen = true): Observable<unknown> {
        return this.http.post<unknown>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/seen`,
            { seen },
        );
    }

    /** POST /email/messages/{id}/flag -- flag/star or unflag a message. */
    markFlagged(messageId: string, flagged = true): Observable<unknown> {
        return this.http.post<unknown>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/flag`,
            { flagged },
        );
    }

    /**
     * POST /email/messages/{id}/move -- move a message to another folder.
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
     * POST /email/messages/{id}/delete -- moves the message to Trash on the remote IMAP server, keeping its id. One
     * already in Trash is refused (409 `/errors/email/already-in-trash`). `permanent: true` is refused every time
     * (409 `permanent-deletion`) until the server's permanent slice; then it deletes for good, from Trash only.
     */
    deleteMessage(messageId: string, permanent = false): Observable<EmailDeleteResultDto> {
        return this.http.post<EmailDeleteResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/delete`,
            permanent ? { permanent } : {},
        );
    }

    /**
     * POST /email/messages/delete -- the bulk form, at most 200 ids of one mailbox: one outcome per id, in order. A
     * partial failure is the `refused` outcomes; the rest are done.
     */
    deleteMessages(ids: readonly string[], permanent = false): Observable<EmailBulkResultDto> {
        return this.http.post<EmailBulkResultDto>(
            `${this.apiBase}/email/messages/delete`,
            permanent ? { ids, permanent } : { ids },
        );
    }

    /**
     * POST /email/messages/restore -- the undo of a delete: back from Trash to the folder each was deleted from. Valid
     * while the message is still in Trash, with no time limit on the server.
     */
    restoreMessages(ids: readonly string[]): Observable<EmailBulkResultDto> {
        return this.http.post<EmailBulkResultDto>(`${this.apiBase}/email/messages/restore`, { ids });
    }

    /** POST /email/mailboxes/{id}/send -- send a new message through the mailbox's SMTP. */
    send(mailboxId: string, request: OutgoingEmailRequest): Observable<EmailSendResultDto> {
        return this.http.post<EmailSendResultDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/send`,
            request,
        );
    }

    /** POST /email/messages/{id}/reply -- reply to a stored message, threaded. */
    reply(messageId: string, request: OutgoingEmailRequest): Observable<EmailSendResultDto> {
        return this.http.post<EmailSendResultDto>(
            `${this.apiBase}/email/messages/${encodeURIComponent(messageId)}/reply`,
            request,
        );
    }

    /**
     * POST /email/mailboxes/{id}/import -- import a `.eml`/`.mbox` file's text into the
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

    /** GET /email/mailboxes/{mailboxId}/delegations -- the mailbox's delegates, MANAGE-gated. */
    listDelegations(mailboxId: string): Observable<MailboxDelegationDto[]> {
        return this.http
            .get<unknown>(`${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations`, {
                headers: this.jsonHeaders,
            })
            .pipe(map(raw => this.unwrap<MailboxDelegationDto>(raw)));
    }

    /** POST /email/mailboxes/{mailboxId}/delegations -- grant a delegate read + send-as; notifies the owner. */
    grantDelegation(mailboxId: string, request: CreateDelegationRequest): Observable<MailboxDelegationDto> {
        return this.http.post<MailboxDelegationDto>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations`,
            request,
        );
    }

    /** DELETE /email/mailboxes/{mailboxId}/delegations/{id} -- revoke a delegate. */
    revokeDelegation(mailboxId: string, id: string): Observable<unknown> {
        return this.http.delete<unknown>(
            `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/delegations/${encodeURIComponent(id)}`,
        );
    }

    /** GET /email/mailboxes/{mailboxId}/rules -- the mailbox's filters, in the order they are checked. */
    listFilters(mailboxId: string): Observable<MailboxFilter[]> {
        return this.http
            .get<unknown>(`${this.rulesBase(mailboxId)}`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<MailboxFilter>(raw)));
    }

    /** POST /email/mailboxes/{mailboxId}/rules -- a new filter, placed last. */
    createFilter(mailboxId: string, filter: MailboxFilterWrite): Observable<MailboxFilter> {
        return this.http.post<MailboxFilter>(this.rulesBase(mailboxId), filter, { headers: this.jsonHeaders });
    }

    /** PATCH /email/mailboxes/{mailboxId}/rules/{id} -- a merge patch of the filter's writable fields. */
    updateFilter(mailboxId: string, id: string, patch: Partial<MailboxFilterWrite>): Observable<MailboxFilter> {
        return this.http.patch<MailboxFilter>(
            `${this.rulesBase(mailboxId)}/${encodeURIComponent(id)}`,
            patch,
            { headers: new HttpHeaders({ Accept: 'application/json', 'Content-Type': 'application/merge-patch+json' }) },
        );
    }

    /** DELETE /email/mailboxes/{mailboxId}/rules/{id} -- the filters after it move up. */
    deleteFilter(mailboxId: string, id: string): Observable<unknown> {
        return this.http.delete<unknown>(`${this.rulesBase(mailboxId)}/${encodeURIComponent(id)}`);
    }

    /** PUT /email/mailboxes/{mailboxId}/rules/order -- every filter once, in the new order; answers them so. */
    reorderFilters(mailboxId: string, ids: readonly string[]): Observable<MailboxFilter[]> {
        return this.http
            .put<{ rules?: MailboxFilter[] }>(`${this.rulesBase(mailboxId)}/order`, { ids }, { headers: this.jsonHeaders })
            .pipe(map(answer => answer?.rules ?? []));
    }

    /**
     * GET /email/mailboxes/{mailboxId}/rules/folders -- every folder on the mail server, asked live, for a filter's
     * Move. The rail's list ({@link listFolders}) names only folders holding imported mail, so a new folder would be
     * missing from it.
     */
    listFilterFolders(mailboxId: string): Observable<FilterFolder[]> {
        return this.http
            .get<unknown>(`${this.rulesBase(mailboxId)}/folders`, { headers: this.jsonHeaders })
            .pipe(map(raw => this.unwrap<FilterFolder>(raw)));
    }

    /** GET /email/system-mail -- the system mail choice and its state (an elevated administrator). */
    getSystemMail(): Observable<SystemMailDto> {
        return this.http.get<SystemMailDto>(`${this.apiBase}/email/system-mail`, { headers: this.jsonHeaders });
    }

    /** GET /email/system-mail/send-as/{mailboxId} -- the Froms that mailbox may send system mail as. */
    getSystemMailSendAs(mailboxId: string): Observable<SystemMailSendAsDto> {
        return this.http.get<SystemMailSendAsDto>(
            `${this.apiBase}/email/system-mail/send-as/${encodeURIComponent(mailboxId)}`,
            { headers: this.jsonHeaders },
        );
    }

    /** PUT /email/system-mail -- choose the mailbox and the From; answers the new state. */
    chooseSystemMail(choice: SystemMailChoice): Observable<SystemMailDto> {
        return this.http.put<SystemMailDto>(`${this.apiBase}/email/system-mail`, choice, { headers: this.jsonHeaders });
    }

    /** DELETE /email/system-mail -- clear the choice: the configured transport carries system mail again. */
    clearSystemMail(): Observable<unknown> {
        return this.http.delete<unknown>(`${this.apiBase}/email/system-mail`);
    }

    /** POST /email/system-mail/test -- a test to the signed-in administrator's own address, sent at once (204). */
    testSystemMail(): Observable<unknown> {
        return this.http.post<unknown>(`${this.apiBase}/email/system-mail/test`, {});
    }

    private rulesBase(mailboxId: string): string {
        return `${this.apiBase}/email/mailboxes/${encodeURIComponent(mailboxId)}/rules`;
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
