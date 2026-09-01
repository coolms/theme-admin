/**
 * M8.a.4 — DTOs for the Email mailbox client, mirroring the backend read/write
 * resources–). Fields are optional/nullable to tolerate the
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
    /** How the mailbox authenticates: `password` (default) or `oauth` (M8.f, ). */
    authMethod?: string;
    /** OAuth provider key (e.g. `google`) when `authMethod` is `oauth`; null otherwise. */
    oauthProvider?: string | null;
    /** True when an OAuth mailbox has a sealed token grant — i.e. it is connected. */
    oauthConnected?: boolean;
    createdAt?: string;
    updatedAt?: string;
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
}

/** The allowed transport-security modes (`MailboxSecurity` enum). */
export type MailboxSecurity = 'none' | 'ssl' | 'starttls';

/** How a mailbox authenticates (`MailboxAuthMethod` enum, ). */
export type MailboxAuthMethod = 'password' | 'oauth';

/**
 * The consent URL an authorize call returns (`POST /email/mailboxes/{id}/authorize`,
 * M8.f.2d ). The FE redirects the browser to `authorizationUrl` to start the
 * OAuth flow; the provider then calls back the public `/email/oauth/callback` which
 * seals the grant and bounces to `/admin/email?oauth=connected`.
 */
export interface MailboxConnectResultDto {
    id?: string;
    authorizationUrl?: string;
}

/**
 * A registered OAuth mail provider (`GET /email/oauth/providers`, M8.h ). The
 * mailbox editor's provider picker lists these — a new backend provider appears with
 * no FE change. `key` is what `oauthProvider` stores (e.g. `google`, `microsoft`).
 */
export interface EmailOAuthProviderDto {
    key: string;
    label?: string;
}

/** Per-folder counts for the folder rail (`GET /email/mailboxes/{id}/folders`, ). */
export interface EmailFolderDto {
    folder: string;
    total: number;
    unseen: number;
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
 * The result echoed by delete (`POST .../messages/{id}/delete`, ). `purged`
 * is true when the message was permanently removed (it was already in Trash),
 * false when it was moved to Trash (recoverable); `folder` is where it now lives
 * (empty when purged).
 */
export interface EmailDeleteResultDto {
    id?: string;
    folder?: string;
    purged?: boolean;
}

/**
 * The write payload for send / reply. `to`/`cc`/`bcc` are
 * address arrays; the body is `text` and/or `html`. For a reply, `to` + `subject`
 * are optional — the backend defaults them from the parent.
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
 * `EmailSearchResource` — it never carries the message body (the searchable body
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
 * the mailbox. Soft-ref uuids — the FE shows shortened ids (no name resolution).
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
