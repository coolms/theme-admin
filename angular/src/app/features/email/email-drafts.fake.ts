import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { isReplyMode } from './compose-draft';
import { type EmailDraftDto, type EmailDraftFileDto, type EmailDraftSent } from './email.types';

/** A call the fake drafts API was asked, as the specs read them back. */
export interface DraftCall {
    readonly op: 'create' | 'save' | 'read' | 'delete' | 'lookup' | 'list';
    readonly id?: string;
    /** A create's Idempotency-Key. */
    readonly key?: string;
    readonly version?: number;
    readonly body?: EmailDraftSent;
    readonly messageId?: string;
}

/**
 * The drafts API for the specs: one person's drafts in memory, answering as the server does. A second reply draft to a
 * message is 409 reply-draft-exists naming the first; a save from an older version is 409 draft-stale with the version
 * stored; a save that changes what a draft answers (but for reply and reply all) is 422; a discard of a draft already
 * gone is done. Where a draft is written (`composedIn`) stays `window` once said, a draft that never said reads
 * `window`, and a value the server does not know is 422. `failNextCreate()` makes the next create a server error. `hold()` keeps every answer back until
 * `release()`, for a request still on its way.
 */
export class FakeDraftsApi {
    readonly drafts = new Map<string, EmailDraftDto>();
    readonly calls: DraftCall[] = [];
    /** The files a draft may name, by id, as the attach routes stored them. */
    readonly files = new Map<string, EmailDraftFileDto>();
    private seq = 0;
    private clock = 0;
    private holding = false;
    private held: Array<() => void> = [];
    private failing: Array<{ status: number; committed: boolean }> = [];
    /** The draft each Idempotency-Key made, as the server keeps them. */
    private readonly byKey = new Map<string, string>();

    /**
     * The next create answers this status (a server error): with nothing written, or (`committed`) after the draft was
     * made, as a create whose answer was lost.
     */
    failNextCreate(status: number, committed = false): void {
        this.failing.push({ status, committed });
    }

    /** Answers are kept back from now on. */
    hold(): void {
        this.holding = true;
    }

    /** Every answer kept back is given, in order, and the next ones go at once. */
    release(): void {
        this.holding = false;
        const held = this.held;
        this.held = [];
        for (const run of held) {
            run();
        }
    }

    /** The requests whose answers are kept back. */
    get waiting(): number {
        return this.held.length;
    }

    /** A draft as another place wrote it: stored at version 1, or written over with a version one higher. */
    put(draft: Partial<EmailDraftDto> & { id: string }): EmailDraftDto {
        const before = this.drafts.get(draft.id);
        const stored: EmailDraftDto = {
            ...(before ?? this.blank(draft.id, 'mb1')),
            ...draft,
            version: (before?.version ?? 0) + 1,
            updatedAt: this.tick(),
        };
        stored.attachmentFiles = stored.attachments.map(id => this.files.get(id)).filter((f): f is EmailDraftFileDto => f !== undefined);
        this.drafts.set(stored.id, structuredClone(stored));

        return structuredClone(stored);
    }

    createDraft(mailboxId: string, body: EmailDraftSent, idempotencyKey: string): Observable<EmailDraftDto> {
        this.calls.push({ op: 'create', body: structuredClone(body), key: idempotencyKey });
        return this.answer(() => {
            if (!knownPlace(body)) {
                return problem(422, { status: 422 });
            }
            const made = this.byKey.get(idempotencyKey);
            const first = made === undefined ? undefined : this.drafts.get(made);
            if (first !== undefined) {
                return structuredClone(first);
            }
            const failure = this.failing.shift();
            if (failure !== undefined && !failure.committed) {
                return problem(failure.status, { status: failure.status });
            }
            const answers = body.answers ?? null;
            if (answers !== null && isReplyMode(answers.mode)) {
                const there = [...this.drafts.values()].find(d => d.answers?.messageId === answers.messageId && isReplyMode(d.answers.mode));
                if (there !== undefined) {
                    return problem(409, {
                        type: '/errors/email/reply-draft-exists', title: 'You already have a reply draft to this message',
                        status: 409, draftId: there.id, version: there.version,
                    });
                }
            }
            const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
            const stored = this.write(this.blank(id, mailboxId), body);
            stored.answers = answers;
            stored.version = 1;
            this.byKey.set(idempotencyKey, id);
            const kept = this.keep(stored);

            return failure !== undefined ? problem(failure.status, { status: failure.status }) : kept;
        });
    }

    saveDraft(_mailboxId: string, id: string, version: number, body: EmailDraftSent): Observable<EmailDraftDto> {
        this.calls.push({ op: 'save', id, version, body: structuredClone(body) });
        return this.answer(() => {
            if (!knownPlace(body)) {
                return problem(422, { status: 422 });
            }
            const stored = this.drafts.get(id);
            if (stored === undefined) {
                return problem(404, { status: 404 });
            }
            if (stored.version !== version) {
                return problem(409, { type: '/errors/email/draft-stale', title: 'The draft was saved elsewhere meanwhile', status: 409, version: stored.version });
            }
            const asked = body.answers ?? null;
            const had = stored.answers ?? null;
            if (asked !== null && had !== null && (asked.messageId !== had.messageId || isReplyMode(asked.mode) !== isReplyMode(had.mode))) {
                return problem(422, { type: '/errors/email/draft-answers-fixed', status: 422 });
            }
            const saved = this.write(structuredClone(stored), body);
            saved.answers = asked ?? had;
            saved.version = stored.version + 1;

            return this.keep(saved);
        });
    }

    readDraft(_mailboxId: string, id: string): Observable<EmailDraftDto> {
        this.calls.push({ op: 'read', id });
        return this.answer(() => {
            const stored = this.drafts.get(id);
            return stored === undefined ? problem(404, { status: 404 }) : structuredClone(stored);
        });
    }

    deleteDraft(_mailboxId: string, id: string): Observable<void> {
        this.calls.push({ op: 'delete', id });
        return this.answer(() => {
            this.drafts.delete(id);
            return undefined;
        });
    }

    draftsAnswering(_mailboxId: string, messageId: string): Observable<EmailDraftDto[]> {
        this.calls.push({ op: 'lookup', messageId });
        return this.answer(() => {
            const mine = [...this.drafts.values()].filter(d => d.answers?.messageId === messageId);
            return structuredClone([...mine.filter(d => isReplyMode(d.answers?.mode)), ...mine.filter(d => !isReplyMode(d.answers?.mode))]);
        });
    }

    listDrafts(_mailboxId: string): Observable<EmailDraftDto[]> {
        this.calls.push({ op: 'list' });
        return this.answer(() => structuredClone([...this.drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
    }

    /** The drafts calls, bound, to spread into a mocked mail service. */
    api(): Pick<FakeDraftsApi, 'createDraft' | 'saveDraft' | 'readDraft' | 'deleteDraft' | 'draftsAnswering' | 'listDrafts'> {
        return {
            createDraft: this.createDraft.bind(this),
            saveDraft: this.saveDraft.bind(this),
            readDraft: this.readDraft.bind(this),
            deleteDraft: this.deleteDraft.bind(this),
            draftsAnswering: this.draftsAnswering.bind(this),
            listDrafts: this.listDrafts.bind(this),
        };
    }

    /** The calls of one kind. */
    of(op: DraftCall['op']): DraftCall[] {
        return this.calls.filter(c => c.op === op);
    }

    private answer<T>(make: () => T | HttpErrorResponse): Observable<T> {
        return new Observable<T>(subscriber => {
            const run = (): void => {
                const result = make();
                if (result instanceof HttpErrorResponse) {
                    subscriber.error(result);
                } else {
                    subscriber.next(result);
                    subscriber.complete();
                }
            };
            if (this.holding) {
                this.held.push(run);
            } else {
                run();
            }
        });
    }

    private write(draft: EmailDraftDto, body: EmailDraftSent): EmailDraftDto {
        // A stored draft that never said is the window's; once the window's, always.
        const was = draft.version === 0 ? null : (draft.composedIn ?? 'window');

        return {
            ...draft,
            to: [...body.to],
            cc: [...body.cc],
            bcc: [...body.bcc],
            subject: body.subject,
            text: body.text,
            html: body.html,
            attachments: [...body.attachments],
            attachmentFiles: body.attachments.map(id => this.files.get(id)).filter((f): f is EmailDraftFileDto => f !== undefined),
            from: body.from,
            quote: body.quote,
            messageParts: structuredClone(body.messageParts),
            composedIn: was === 'window' ? 'window' : (body.composedIn ?? 'window'),
            updatedAt: this.tick(),
        };
    }

    private keep(draft: EmailDraftDto): EmailDraftDto {
        this.drafts.set(draft.id, structuredClone(draft));
        return structuredClone(draft);
    }

    private blank(id: string, mailboxId: string): EmailDraftDto {
        return {
            id, mailboxId, to: [], cc: [], bcc: [], subject: '', text: '', html: null, attachments: [], attachmentFiles: [],
            from: null, version: 0, updatedAt: '', answers: null, quote: null, messageParts: [], inReplyTo: null, references: [],
        };
    }

    private tick(): string {
        const s = ++this.clock;
        return `2026-11-12T10:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}+00:00`;
    }
}

/** A create or save says a place the server knows, or nothing. */
function knownPlace(body: EmailDraftSent): boolean {
    const said: unknown = (body as { composedIn?: unknown }).composedIn;

    return said === undefined || said === null || said === 'window' || said === 'quick-reply';
}

function problem(status: number, body: Record<string, unknown>): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: body, headers: undefined });
}
