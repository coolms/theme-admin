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
    /** What the provider said when the mailbox last failed, with credentials removed. Answered to owner and managers only. */
    connectionErrorDetail?: string | null;
    /** When the provider said it. It stays after the mailbox recovers. */
    connectionErrorAt?: string | null;
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
    /** The largest message this mailbox sends, in bytes; absent when it is not known. */
    maxMessageBytes?: number | null;
    /** Whether the mail server can search mail the platform does not hold; absent from a server that predates it. */
    serverSearch?: ServerSearchCapability | null;
}

/**
 * A mailbox's server search, as last learned: `supported`; `unsupported` (the server cannot search, `reason` is what it
 * answered); `unknown` (not probed yet, the first search decides); `unavailable` (the mailbox cannot be reached now,
 * `reason` is the connection's).
 */
export type ServerSearchState = 'supported' | 'unsupported' | 'unknown' | 'unavailable';

export interface ServerSearchCapability {
    state: ServerSearchState;
    reason?: string | null;
}

/** One message the mail server found: its headers only. `local` with `localId` when the platform already holds it. */
export interface ServerSearchHitDto {
    /** Names the message on the server; opaque, passed back as it came. */
    ref: string;
    folder: string;
    uid: number;
    from?: { name?: string | null; address?: string | null } | null;
    /** Absent when the message has none. */
    subject?: string;
    /** ISO 8601 with its offset. */
    date?: string | null;
    sizeBytes?: number | null;
    seen?: boolean;
    flagged?: boolean;
    /** Gmail only: where the message shows (Inbox, Sent, a label), as its folder is All Mail. */
    labels?: string[];
    local: boolean;
    localId?: string | null;
}

/** `GET /email/mailboxes/{id}/server-search`: one page of hits, newest first, `q` trimmed as the server searched it. */
export interface ServerSearchAnswerDto {
    q: string;
    folder?: string | null;
    state: string;
    /** What was searched: the folders, and a stable code for what the server matches (`gmail-raw`, `imap-text`). */
    searched?: { folders?: string[]; matches?: string } | null;
    hits: ServerSearchHitDto[];
    next: string | null;
    /** True once the search reached its limit of hits. */
    capped: boolean;
}

/**
 * `GET /email/mailboxes/{id}/server-messages`: one page of a folder's messages older than the oldest the platform holds
 * there, headers only, newest first, in the server search's hit shape.
 */
export interface ServerOlderMessagesDto {
    id: string;
    folder: string;
    hits: ServerSearchHitDto[];
    next: string | null;
}

/** What opening a server hit answers: the stored message's id and the folder it is stored in. */
export interface ServerMessageOpenedDto {
    id: string;
    folder: string;
}

/** A file attached to a message being written: an upload, or a reference to a file of the person's Drive. */
export interface OutgoingAttachmentDto {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    /** The file's part body as sent (base64 with line breaks), to the byte. */
    encodedBytes: number;
    source?: 'drive';
}

/** Why Drive did not attach a node. */
export type DriveAttachRefusal = 'not-found' | 'folder' | 'too-large' | 'over-message-limit';

/** One row of an attach from Drive, in the order the nodes were named: attached, or refused with why. */
export type DriveAttachRowDto =
    | (OutgoingAttachmentDto & { node: string; refused?: undefined })
    | { node: string; refused: DriveAttachRefusal };

export interface DriveAttachResultDto {
    attachments: DriveAttachRowDto[];
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
    /** Whose the mailbox is; on create `personal` when absent, and changeable afterwards. */
    kind?: MailboxKind;
}

/**
 * Whose a mailbox is: `personal`, a person's own, stopped when that person's account is deleted; `shared`, the
 * organisation's, kept when that account is deleted, without the person's credentials, until it is connected again.
 * Only a shared mailbox may send the installation's system mail. It decides nothing about who may read or manage it.
 */
export type MailboxKind = 'personal' | 'shared';

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
    kind?: MailboxKind;
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
    /**
     * Whose the folder is, as the mail server marks it: `inbox`, a special use (`sent`, `drafts`, `trash`, `junk`,
     * `archive`, `all`, `flagged`), or `system` for a Gmail system label; null or absent for the person's own folders.
     */
    role?: string | null;
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
    /**
     * True: the folder's message list is filled from the mail server, newest first, paged by X-Next-Cursor, with rows
     * nothing here stores (`fromServer`). False: its stored rows. Absent from a server that does not say.
     */
    listedFromServer?: boolean;
}

/**
 * A message summary in the list (`GET /email/mailboxes/{id}/messages`, ). In a folder listed from the mail server, a
 * row nothing here stores carries `fromServer: true` and a `ref`, and no `id` at all (see mail-server-rows).
 */
export interface EmailMessageDto {
    /** Absent on a server row (`fromServer`): read it only once isServerRow says the row is not one. */
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
    /** Whether the mail server can archive this message, as the server answers; missing or null reads as no. */
    canArchive?: boolean | null;
    /**
     * Whether Reply all would reach someone Reply does not, as the server answers; null while it cannot tell (a row
     * whose Cc and Reply-To are not read yet), which reads as no.
     */
    replyAllUseful?: boolean | null;
    /** True on a row the mail server lists and nothing here stores; false on a stored row. */
    fromServer?: boolean;
    /** A server row's ref, which opens it through the server-message opener; null on a stored row. */
    ref?: string | null;
}

/**
 * One page of a folder's list, with what the answer's headers say beside its rows: `next` the cursor of the next page
 * (`X-Next-Cursor`, null on the last page or a folder paged by number), `serverPages` the `X-Server-Pages` header.
 * A list answered without them reads as a folder paged by number.
 */
export type EmailMessageList = EmailMessageDto[] & { next?: string | null; serverPages?: string | null };

/** The ways of starting from a message that the server prepares (`GET /email/messages/{id}/compose?mode=`). */
export type EmailComposeMode = 'reply' | 'reply_all' | 'forward';

/**
 * A part of the original a forward carries, as the compose prefill lists it. An inline part is one the quote shows: it
 * goes with the quote, never on its own.
 */
export interface EmailComposePartDto {
    messageId: string;
    part: number;
    name: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    inline: boolean;
    contentId: string | null;
}

/** A part of a stored message to carry on send, `{messageId, part}` as the prefill lists it. */
export interface EmailMessagePartRef {
    messageId: string;
    part: number;
}

/** A recipient as the compose prefill names one; `name` null when the message names none. */
export interface EmailComposeRecipientDto {
    name: string | null;
    address: string;
}

/**
 * What an answer or a forward starts with, prepared by the server: the From and the addresses that may be sent as
 * (none for a reader who may not send), the recipients, the subject, the quote (null when the message could not be
 * read: `unreadable` says why) and the threading. `quote.html` goes below the person's own text, as served.
 */
export interface EmailComposeDto {
    id: string;
    mode: EmailComposeMode;
    from: { address: string; choices: string[] };
    to: EmailComposeRecipientDto[];
    cc: EmailComposeRecipientDto[];
    subject: string;
    quote: { text: string; html: string | null; attribution: string | null } | null;
    inReplyTo: string | null;
    references: string[];
    /** A forward's parts of the original, as references: nothing is copied until it is sent. */
    attachments: EmailComposePartDto[];
    unreadable: string | null;
}

/** The answer of an archive (`POST /email/messages/{id}/archive`): the folder the message is in now. */
export interface EmailArchiveResultDto {
    id: string;
    folder: string;
}

/** A message as opened (`GET /email/messages/{id}`, detail group). Its source is read on its own (getMessageSource). */
export interface EmailMessageDetailDto extends EmailMessageDto {
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
    outcome: 'moved' | 'gone' | 'archived' | 'refused';
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
    /** Ids of uploads and Drive references to send with a new message; their bytes are read at send. */
    attachments?: string[];
    /** The address to send from, one the mailbox may send as; the mailbox's own when left out. */
    from?: string;
    /**
     * The quote choice. A reply: true has the server append the message answered below this one, as its compose
     * prefill showed it; false or left out sends without it. A send with `forwardOf`: false sends without the
     * forwarded message; left out sends it. The page always states it for an answer or a forward.
     */
    quote?: boolean;
    /** A send only: the stored message this one forwards; the server appends it below the person's text. */
    forwardOf?: string;
    /** Parts of stored messages to carry, read at send: a forward's files. */
    messageParts?: EmailMessagePartRef[];
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

/** A folder in its mailbox's tree, as the server orders and names it. */
export interface EmailFolderTreeNodeDto extends EmailFolderDto {
    /** The name to draw: a role's in the reader's language, any other folder's own; a server's brackets dropped. */
    name: string;
    /** False for a folder that only holds folders, with nothing to open. */
    selectable: boolean;
    children: EmailFolderTreeNodeDto[];
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

/**
 * The mailbox the platform's own mail goes out through (`GET /email/system-mail`). Every member is present, nulls
 * included: with nothing chosen, `mailboxId` is null and the configured transport carries system mail.
 */
export interface SystemMailDto {
    mailboxId: string | null;
    fromAddress: string | null;
    /** Null keeps the configured From's name. */
    fromName: string | null;
    /** `none` (the configured transport), `sending`, or `stopped`. */
    state: 'none' | 'sending' | 'stopped';
    /** With `stopped`: `mailbox-gone`, `mailbox-disabled` or `mailbox-needs-reconnect`. */
    stopReason: string | null;
    /** How many messages are held, waiting for the mailbox. */
    held: number;
}

/** The choice `PUT /email/system-mail` takes. */
export interface SystemMailChoice {
    mailboxId: string;
    fromAddress: string;
    fromName: string | null;
}

/** The Froms a mailbox may send system mail as (`GET /email/system-mail/send-as/{mailboxId}`): its own first. */
export interface SystemMailSendAsDto {
    mailboxId: string;
    addresses: string[];
    /** Why the provider's list could not be read; only the own address is offered then. */
    unreadable: string | null;
}
