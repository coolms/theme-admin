/**
 * DTOs for the Email mailbox client, mirroring the backend read/write
 * resources-). Fields are optional/nullable to tolerate the
 * partial shapes each endpoint returns.
 */

/** A configured mailbox connection (`GET /email/mailboxes`, ). The read group
 *  exposes every connection setting (not the password); `hasCredential` reports
 *  whether a sealed credential is stored. */
export interface EmailMailboxDto {
    id: string;
    label?: string;
    emailAddress?: string;
    imapHost?: string;
    imapPort?: number;
    imapSecurity?: string;
    imapUsername?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecurity?: string;
    smtpUsername?: string;
    enabled?: boolean;
    /** Workflow-definition key started on a new-conversation inbound email. */
    inboundWorkflowKey?: string | null;
    hasCredential?: boolean;
    /** How the mailbox authenticates: `password` (default) or `oauth`. */
    authMethod?: string;
    /** OAuth provider key (e.g. `google`) when `authMethod` is `oauth`; null otherwise. */
    oauthProvider?: string | null;
    /** True when an OAuth mailbox has a sealed token grant -- i.e. it is connected. */
    oauthConnected?: boolean;
    createdAt?: string;
    updatedAt?: string;
    /** `personal` or `shared`: what happens to the mailbox when its owner's account is deleted. */
    kind?: string;
    ownerUserId?: string | null;
    /** The last fetch's outcome: `ok`, `transient`, `permanent` (stopped until a change or a retry), `pending_recheck`. */
    connectionKind?: string | null;
    connectionSince?: string | null;
    /** Why a stopped mailbox stopped: `auth_refused`, `reauth_required`, `unreachable`, `unknown`. */
    connectionErrorKind?: string | null;
    lastSuccessAt?: string | null;
    /**
     * The version of the settings this read was made at, when the server answers one. A section saves naming it
     * (If-Match); a mailbox changed since is refused (412) and nothing is changed. Without it nothing is saved.
     */
    version?: string | number | null;
    /**
     * The caller's access to the mailbox, as the read answers it: `owner` or `manager` may change its settings (a manager
     * is an administrator), `read_only` and `read_and_send` are a delegate's, who may read them.
     */
    access?: MailboxAccess | null;
    /** How much past mail a sync fetches: -1 all of it, 0 none, 1-600 months, null the installation's default. */
    backfillDepthMonths?: number | null;
    /** How the mailbox sends; part of the settings' version. Absent from a server that predates the choice. */
    sendVia?: SendVia;
    /** Whether it can send through its provider's API, as last learned (read-only). */
    sendApi?: SendApi | null;
    /** The days after which the SERVER empties Trash, where CoolMS knows it for the provider (a cited source); else null. */
    trashRetentionDays?: number | null;
}

/** Who the caller is to a mailbox: may change its settings (`owner`, `manager`), or may read them (a delegate). */
export type MailboxAccess = 'owner' | 'manager' | 'read_only' | 'read_and_send';

/** One protocol's answer to a connection test: connected, or why not -- a fixed sentence, never the server's text. */
export interface MailboxTestOutcome {
    ok: boolean;
    errorKind?: 'auth_refused' | 'reauth_required' | 'unreachable' | 'unknown' | null;
    message?: string | null;
}

/** A connection test's answer, per protocol. */
export interface MailboxTestResult {
    imap?: MailboxTestOutcome;
    smtp?: MailboxTestOutcome;
}

/** What a connection test tries in place of what is stored; a field left out comes from the stored mailbox. */
export interface MailboxTestRequest {
    imapHost?: string;
    imapPort?: number;
    imapSecurity?: string;
    imapUsername?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecurity?: string;
    smtpUsername?: string;
    password?: string;
}

/**
 * The write payload for creating/updating a mailbox (CRUD). On create the
 * connection fields + `password` are required; on update (merge-patch) only the
 * present fields are applied, and `password` is sent ONLY when changed (blank
 * keeps the stored credential). `inboundWorkflowKey: ''` clears the trigger.
 */
export interface MailboxWriteRequest {
    label?: string;
    emailAddress?: string;
    imapHost?: string;
    imapPort?: number;
    imapSecurity?: string;
    imapUsername?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecurity?: string;
    smtpUsername?: string;
    password?: string;
    enabled?: boolean;
    inboundWorkflowKey?: string;
    /** Auth method on CREATE only: `password` (default) or `oauth`. */
    authMethod?: string;
    /** OAuth provider key (e.g. `google`) when creating an `oauth` mailbox. */
    oauthProvider?: string;
    /** How much past mail a sync fetches (see {@link EmailMailboxDto.backfillDepthMonths}); null: the default. */
    backfillDepthMonths?: number | null;
    /** How the mailbox sends (see {@link EmailMailboxDto.sendVia}). */
    sendVia?: SendVia;
}

/** How a mailbox sends: `auto` through the provider's API where it can, else SMTP; `api` or `smtp` only that way. */
export type SendVia = 'auto' | 'api' | 'smtp';

/**
 * Whether the mailbox can send through its provider's API, as the server last learned it (by sending; a reconnect
 * clears it): `available` true, false, or null when not learned yet; `name` the API (`Gmail API`, `Microsoft Graph`),
 * null for a plain IMAP/SMTP server; `reason` why not, when not.
 */
export interface SendApi {
    available: boolean | null;
    name: string | null;
    reason: 'not_supported' | 'not_enabled' | 'no_consent' | null;
}

/** The allowed transport-security modes (`MailboxSecurity` enum). */
export type MailboxSecurity = 'none' | 'ssl' | 'starttls';

/** How a mailbox authenticates (`MailboxAuthMethod` enum, ). */
export type MailboxAuthMethod = 'password' | 'oauth';

/**
 * The consent URL an authorize call returns (`POST /email/mailboxes/{id}/authorize`,
 * ). The FE redirects the browser to `authorizationUrl` to start the
 * OAuth flow; the provider then calls back the public `/email/oauth/callback` which
 * seals the grant and bounces to `/admin/email?oauth=connected`.
 */
export interface MailboxConnectResultDto {
    id?: string;
    authorizationUrl?: string;
}

/**
 * The body of `POST /email/mailboxes/connect` -- an authorize-first connect. The
 * server stashes this as a short-lived draft and answers with the consent URL; the
 * mailbox row is built only after the provider callback has proven the grant, so
 * nothing is created for a consent that is refused or abandoned.
 *
 * There is no username here on purpose: an OAuth mailbox authenticates as its
 * address. `kind` is `personal` when absent.
 */
export interface MailboxDraftRequest {
    label: string;
    emailAddress: string;
    oauthProvider: string;
    kind?: 'personal' | 'shared';
    imapHost: string;
    imapPort: number;
    imapSecurity: MailboxSecurity;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: MailboxSecurity;
}

/**
 * A registered OAuth mail provider (`GET /email/oauth/providers`, ). The
 * mailbox editor's provider picker lists these -- a new backend provider appears with
 * no FE change. `key` is what `oauthProvider` stores (e.g. `google`, `microsoft`).
 */
export interface EmailOAuthProviderDto {
    key: string;
    label?: string;
}

/** Per-folder counts for the folder rail (`GET /email/mailboxes/{id}/folders`, ). */
export interface EmailFolderDto {
    folder: string;
    /** How many messages have been IMPORTED into this folder. */
    total: number;
    unseen: number;
    /**
     * How many MESSAGES the server holds, as of the last sync, or null/absent when no
     * sync has recorded it. `total` can be far smaller while the backfill is still
     * walking the older mail, so the rail shows the fraction rather than letting
     * `total` stand in for the whole folder.
     *
     * The unit is messages, not conversations. A webmail that groups by conversation
     * shows a smaller number for the same folder, which is a different unit rather
     * than a disagreement -- the rail says so, or an operator comparing the two reads
     * a defect that is not there.
     */
    serverTotal?: number | null;
    /**
     * How many of them are UNREAD on the server, or null/absent when unknown. `unseen`
     * counts only the imported unread messages and understates the truth badly on a
     * part-imported folder.
     */
    serverUnseen?: number | null;
}

/** A message summary in the list (`GET /email/mailboxes/{id}/messages`, ). */
export interface EmailMessageDto {
    id: string;
    mailboxId?: string;
    folder?: string;
    uid?: number;
    threadId?: string;
    fromAddress?: string;
    fromName?: string | null;
    toAddresses?: string[];
    subject?: string | null;
    snippet?: string | null;
    messageId?: string | null;
    inReplyTo?: string | null;
    sizeBytes?: number;
    seen?: boolean;
    flagged?: boolean;
    hasAttachments?: boolean;
    sentAt?: string | null;
    receivedAt?: string | null;
    hasBody?: boolean;
}

/** A message with its raw RFC-822 source (`GET /email/messages/{id}`, detail group). */
export interface EmailMessageDetailDto extends EmailMessageDto {
    rawBody?: string | null;
    /** Server-sanitised HTML body for safe display in a sandboxed iframe. */
    bodyHtml?: string | null;
    /** Plain-text body alternative, shown when there is no HTML. */
    bodyText?: string | null;
    /** Whether the sanitised HTML still references remote content (gated behind "Load images"). */
    hasRemoteContent?: boolean | null;
}

/**
 * One attachment parsed on demand from a stored `.eml` (`GET /email/messages/{id}/attachments`,
 * ). Addressed by 0-based `index` within the message's parts; `inline` marks a
 * cid-referenced body part vs a real attachment.
 */
export interface EmailAttachmentDto {
    index: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    contentId?: string | null;
    inline: boolean;
}

/** The confirmation echoed by "Save to my files" (`POST .../attachments/{index}/save`, ). */
export interface EmailAttachmentSaveResultDto {
    savedPath: string;
    filename: string;
}

/**
 * The result echoed by delete (`POST .../messages/{id}/delete`). `folder` is where the message now lives (Trash);
 * `purged` is true, with `folder` empty, when it was already gone from the server and only CoolMS's copy was
 * dropped -- nothing to undo. `undo.from` names the folder it was in, for the toast; the undo needs only the id.
 */
export interface EmailDeleteResultDto {
    id?: string;
    folder?: string;
    purged?: boolean;
    undo?: { from?: string } | null;
}

/**
 * One message's outcome in a bulk delete or restore (`POST .../messages/delete|restore`), in the order asked:
 * `moved` (to Trash, or back), `gone` (no longer on the server: its row goes), `refused` (nothing changed;
 * `reason` is the problem type, e.g. `/errors/email/origin-gone`).
 */
export interface EmailMessageOutcomeDto {
    id: string;
    outcome: 'moved' | 'gone' | 'refused';
    folder?: string;
    reason?: string | null;
}

export interface EmailBulkResultDto {
    results: EmailMessageOutcomeDto[];
}

/**
 * The write payload for send / reply. `to`/`cc`/`bcc` are
 * address arrays; the body is `text` and/or `html`. For a reply, `to` + `subject`
 * are optional -- the backend defaults them from the parent.
 */
export interface OutgoingEmailRequest {
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
}

/** The small confirmation a send/reply echoes. */
export interface EmailSendResultDto {
    id?: string;
    sent?: boolean;
    sentAt?: string | null;
    messageId?: string | null;
    inReplyTo?: string | null;
    threadId?: string | null;
}

/**
 * The subset of a Definition-catalog row (`GET /definitions?module=workflow`) the
 * mailbox editor consumes to build its inbound-workflow picker. The catalog
 * endpoint surfaces every deployed workflow definition across modules; we only need
 * the `definitionKey` (the value `inboundWorkflowKey` stores) and a human `displayName`.
 */
export interface DefinitionCatalogDto {
    definitionKey?: string;
    displayName?: string;
}

/**
 * A resolved option for the inbound-workflow `<select>`: `key` is the
 * deployed workflow's `definitionKey` (what the backend starts on a new-conversation
 * email), `label` is what the admin sees.
 */
export interface InboundWorkflowOption {
    key: string;
    label: string;
}

/**
 * One full-text search hit (`GET /email/search`, ). Mirrors the backend
 * `EmailSearchResource` -- it never carries the message body (the searchable body
 * stays in the index). `sentAt` is a Unix timestamp in **seconds** (or null).
 */
export interface EmailSearchHitDto {
    id: string;
    mailboxId?: string;
    threadId?: string;
    folder?: string;
    fromAddress?: string;
    fromName?: string | null;
    toAddresses?: string[];
    subject?: string | null;
    snippet?: string | null;
    seen?: boolean;
    hasAttachments?: boolean;
    sentAt?: number | null;
}

/**
 * The query the mailbox client issues to `GET /email/search`. `q` is the
 * search term; `mailboxId`/`folder`/`seen` narrow it; `page` offset-paginates
 * (server page size 20).
 */
export interface EmailSearchQuery {
    q: string;
    mailboxId?: string;
    folder?: string;
    seen?: boolean;
    page?: number;
}

/** The tally a `.eml`/`.mbox` import returns (`POST /email/mailboxes/{id}/import`, ). */
export interface EmailImportResultDto {
    imported?: number;
    skipped?: number;
    total?: number;
}

/**
 * A mailbox delegate grant (`GET /email/mailboxes/{mailboxId}/delegations`, ).
 * The Gmail/Workspace "delegate access" model: `delegateUserId` may read + send-as
 * the mailbox. Soft-ref uuids -- the FE shows shortened ids (no name resolution).
 */
export interface MailboxDelegationDto {
    id: string;
    mailboxId?: string;
    delegateUserId?: string;
    ownerUserId?: string;
    grantedById?: string | null;
    createdAt?: string;
}

/** The grant payload (`POST /email/mailboxes/{mailboxId}/delegations`, ). */
export interface CreateDelegationRequest {
    delegateUserId: string;
}
