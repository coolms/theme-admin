import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type Observable } from 'rxjs';
import { isReplyMode, replyDraftOf } from './compose-draft';
import { type EmailComposeMode, type EmailDraftAnswers, type EmailDraftDto, type EmailDraftWrite } from './email.types';
import { type MailDraftsChangedEvent } from './mail-drafts-changed';

/** A key for one create and its retries. */
function newIdempotencyKey(): string {
    const c = globalThis.crypto as Crypto | undefined;
    if (c !== undefined && typeof c.randomUUID === 'function') {
        return c.randomUUID();
    }

    return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** The first pause before a draft save that failed on the server is tried again. */
export const DRAFT_RETRY_FIRST_MS = 1000;
/** The longest pause between tries. */
export const DRAFT_RETRY_MOST_MS = 30_000;

/** The drafts API a draft is written through (the mail service). */
export interface DraftsApi {
    createDraft(mailboxId: string, body: EmailDraftWrite, idempotencyKey: string): Observable<EmailDraftDto>;
    saveDraft(mailboxId: string, id: string, version: number, body: EmailDraftWrite): Observable<EmailDraftDto>;
    readDraft(mailboxId: string, id: string): Observable<EmailDraftDto>;
    deleteDraft(mailboxId: string, id: string): Observable<void>;
    draftsAnswering(mailboxId: string, messageId: string): Observable<EmailDraftDto[]>;
}

/** What the place showing a draft is told. */
export interface DraftHost {
    /** The server's copy took the place of what was shown (a refused save, or a change made elsewhere): draw it. */
    loaded(draft: EmailDraftDto): void;
    /** The draft is gone (discarded or sent elsewhere): close or clear it. */
    gone(): void;
}

/** A 409 naming the person's reply draft to the message: the one to load instead of making a second. */
export function replyDraftExists(error: unknown): { draftId: string; version: number } | null {
    const p = problemOf(error, 409);
    const id = p?.['draftId'];
    const version = p?.['version'];

    return p !== null && typeof p['type'] === 'string' && p['type'].endsWith('/errors/email/reply-draft-exists')
        && typeof id === 'string' && typeof version === 'number'
        ? { draftId: id, version }
        : null;
}

/** A save made from an older version: any other 409 on a draft (an older server's was untyped). */
export function draftStale(error: unknown): boolean {
    return problemOf(error, 409) !== null && replyDraftExists(error) === null;
}

function problemOf(error: unknown, status: number): Record<string, unknown> | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== status) {
        return null;
    }

    return typeof error.error === 'object' && error.error !== null ? error.error as Record<string, unknown> : {};
}

/**
 * One draft on the server, as a compose window or the quick reply writes it. Saves go one at a time, each made from the
 * version the last one answered; a save asked for while one is on its way waits and goes with the latest content. A
 * second reply draft refused (409 reply-draft-exists) and a stale save (409 draft-stale) are never written over: the
 * server's draft is read and handed to the host to draw. A realtime change with a newer version is read the same way,
 * once nothing of this place's is on its way; a draft gone elsewhere is told to the host.
 */
export class ServerDraft {
    /** When the server last saved it (`updatedAt`); null until it is a draft there. */
    readonly savedAt = signal<string | null>(null);
    private draftId: string | null = null;
    private draftVersion: number | null = null;
    private busy = false;
    private owed: EmailDraftWrite | null = null;
    private toldVersion: number | null = null;
    private waiting: Array<() => void> = [];
    private released = false;
    private answersChanged = false;
    /** A failed save waits this long before it is tried again; doubled at each failure, up to the most. */
    private retryMs = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** A reply draft's create refused by the server: the draft is looked up by the message once. */
    private lookedUp = false;
    /**
     * The create on its way or failed, with its Idempotency-Key: every retry sends the same body with the same key,
     * so a create that did commit gives its draft back and never a second. Newer content goes after it as a save.
     */
    private creating: { key: string; body: EmailDraftWrite; from: EmailDraftWrite } | null = null;

    constructor(
        private readonly api: DraftsApi,
        readonly mailboxId: string,
        private answersOf: EmailDraftAnswers | null,
        private readonly host: DraftHost,
    ) {
    }

    get id(): string | null {
        return this.draftId;
    }

    get version(): number | null {
        return this.draftVersion;
    }

    get answers(): EmailDraftAnswers | null {
        return this.answersOf;
    }

    /** A save or a read of this draft is on its way. */
    get pending(): boolean {
        return this.busy;
    }

    /** A draft read from the server is this one from now on. */
    adopt(draft: EmailDraftDto): void {
        this.draftId = draft.id;
        this.draftVersion = draft.version;
        this.answersOf = draft.answers ?? this.answersOf;
        this.savedAt.set(draft.updatedAt);
    }

    /** Reply and reply all switch on the same draft: the next save says so. */
    switchMode(mode: EmailComposeMode): void {
        const a = this.answersOf;
        if (a !== null && a.mode !== mode && isReplyMode(a.mode) && isReplyMode(mode)) {
            this.answersOf = { ...a, mode };
            this.answersChanged = true;
        }
    }

    /** Saves this content: made on the server at the first save, written over it after. */
    save(body: EmailDraftWrite): void {
        this.stopRetry();
        if (this.busy) {
            this.owed = body;
            return;
        }
        this.write(body);
    }

    /** Runs `then` once nothing of this draft's is on its way: at once when nothing is. */
    settled(then: () => void): void {
        if (this.busy) {
            this.waiting.push(then);
        } else {
            then();
        }
    }

    /**
     * Discard: a save on its way is waited for, then the draft it made is deleted, so the two never cross. A save
     * still owed is not sent. `done` is told whether there was a draft to delete.
     */
    discard(done: (deleted: boolean) => void): void {
        this.owed = null;
        this.stopRetry();
        this.settled(() => {
            this.released = true;
            const id = this.draftId;
            if (id === null) {
                done(false);
                return;
            }
            this.api.deleteDraft(this.mailboxId, id).subscribe({ next: () => done(true), error: () => done(false) });
        });
    }

    /** The place showing it went: the host is told nothing more; a save on its way or owed still lands. */
    release(): void {
        this.released = true;
    }

    /**
     * A realtime change to one of the person's drafts. A newer version of this one is read again (after what is on its
     * way); a gone one is told to the host. With no draft yet, a reply draft to the same message made elsewhere is
     * taken as this one. True when the event was this draft's.
     */
    told(event: MailDraftsChangedEvent): boolean {
        if (this.released || event.mailboxId !== this.mailboxId) {
            return false;
        }
        if (this.draftId === null) {
            const mine = this.answersOf;
            if (event.version === null || this.busy || mine === null || event.answers === null
                || event.answers.messageId !== mine.messageId || !isReplyMode(mine.mode) || !isReplyMode(event.answers.mode)) {
                return false;
            }
            this.draftId = event.draftId;
            this.reload();
            return true;
        }
        if (event.draftId !== this.draftId) {
            return false;
        }
        if (event.version === null) {
            this.gone();
            return true;
        }
        if (this.busy) {
            this.toldVersion = Math.max(this.toldVersion ?? 0, event.version);
        } else if (this.draftVersion === null || event.version > this.draftVersion) {
            this.reload();
        }

        return true;
    }

    private write(body: EmailDraftWrite): void {
        this.busy = true;
        const id = this.draftId;
        const naming = id === null || this.answersChanged;
        let call: Observable<EmailDraftDto>;
        if (id === null || this.draftVersion === null) {
            if (this.creating === null) {
                this.creating = { key: newIdempotencyKey(), body: { ...body, answers: this.answersOf }, from: body };
            } else if (this.creating.from !== body) {
                // The same create is tried again as it was; what was written since is saved after it.
                this.owed = body;
            }
            call = this.api.createDraft(this.mailboxId, this.creating.body, this.creating.key);
        } else {
            const sent: EmailDraftWrite = naming ? { ...body, answers: this.answersOf } : body;
            call = this.api.saveDraft(this.mailboxId, id, this.draftVersion, sent);
        }
        call.subscribe({
            next: draft => {
                if (naming) {
                    this.answersChanged = false;
                }
                this.creating = null;
                this.retryMs = 0;
                this.adopt(draft);
                this.idle();
            },
            error: (e: unknown) => this.refused(e, body),
        });
    }

    private refused(error: unknown, body: EmailDraftWrite): void {
        const exists = replyDraftExists(error);
        if (exists !== null) {
            // One reply draft per person per message: that one is loaded, never a second made.
            this.owed = null;
            this.creating = null;
            this.draftId = exists.draftId;
            this.draftVersion = exists.version;
            this.reload();
            return;
        }
        if (draftStale(error)) {
            // Saved elsewhere meanwhile: the stored draft is read again, never written over.
            this.owed = null;
            this.reload();
            return;
        }
        if (error instanceof HttpErrorResponse && (error.status >= 500 || error.status === 0)) {
            const a = this.answersOf;
            if (this.draftId === null && !this.lookedUp && a !== null && isReplyMode(a.mode)) {
                // Two creates of the reply draft at once can fail one of them: the draft is looked up by the message,
                // and loaded when it is there.
                this.lookedUp = true;
                this.api.draftsAnswering(this.mailboxId, a.messageId).subscribe({
                    next: list => {
                        const found = replyDraftOf(list);
                        if (found === null) {
                            this.retryLater(body);
                            return;
                        }
                        this.adopt(found);
                        this.owed = null;
                        this.creating = null;
                        if (!this.released) {
                            this.host.loaded(found);
                        }
                        this.idle();
                    },
                    error: () => this.retryLater(body),
                });
                return;
            }
            this.retryLater(body);
            return;
        }
        this.idle();
    }

    /** The content is kept and saved again after a pause that grows with each failure; a newer save goes at once. */
    private retryLater(body: EmailDraftWrite): void {
        this.owed = this.owed ?? body;
        this.retryMs = Math.min(Math.max(DRAFT_RETRY_FIRST_MS, this.retryMs * 2), DRAFT_RETRY_MOST_MS);
        this.busy = false;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            const owed = this.owed;
            if (!this.busy && owed !== null) {
                this.owed = null;
                this.write(owed);
            }
        }, this.retryMs);
        this.flushWaiting();
    }

    private stopRetry(): void {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    private reload(): void {
        const id = this.draftId;
        if (id === null) {
            this.idle();
            return;
        }
        this.busy = true;
        this.api.readDraft(this.mailboxId, id).subscribe({
            next: draft => {
                this.adopt(draft);
                this.owed = null;
                if (!this.released) {
                    this.host.loaded(draft);
                }
                this.idle();
            },
            error: (e: unknown) => {
                if (e instanceof HttpErrorResponse && e.status === 404) {
                    this.gone();
                    return;
                }
                this.idle();
            },
        });
    }

    private gone(): void {
        const told = !this.released;
        this.released = true;
        this.busy = false;
        this.owed = null;
        this.draftId = null;
        this.draftVersion = null;
        this.savedAt.set(null);
        this.flushWaiting();
        if (told) {
            this.host.gone();
        }
    }

    private idle(): void {
        this.busy = false;
        const owed = this.owed;
        if (owed !== null) {
            this.owed = null;
            this.write(owed);
            return;
        }
        const told = this.toldVersion;
        this.toldVersion = null;
        if (told !== null && this.draftVersion !== null && told > this.draftVersion && !this.released) {
            this.reload();
            return;
        }
        this.flushWaiting();
    }

    private flushWaiting(): void {
        const waiting = this.waiting;
        this.waiting = [];
        for (const then of waiting) {
            then();
        }
    }
}
