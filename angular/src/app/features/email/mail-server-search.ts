import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { EMPTY, Subject, concat, defer, interval, map, of, switchMap, take, timer, type Observable, type Subscription } from 'rxjs';
import type { ServerMessageOpenedDto, ServerSearchAnswerDto, ServerSearchCapability, ServerSearchHitDto } from './email.types';

/** How long typing must pause before a search runs. */
export const SEARCH_PAUSE_MS = 600;

/** The wait when a rate-limited answer names none. */
const DEFAULT_RETRY_AFTER_S = 60;

/** What the search box reports: its text as typed, Enter, or the search cleared. */
export type SearchKey = { kind: 'typed' | 'entered'; q: string } | { kind: 'cleared' };

/** A query to search for, trimmed; `entered` when Enter asked for it rather than a pause. */
export interface SearchCommit {
    q: string;
    entered: boolean;
}

/**
 * The searches the box asks for: typed text after a pause of `pauseMs`, Enter at once. A key pressed before the pause
 * ends starts it again, Enter ends a pending pause, and a clear drops it.
 */
export function searchCommits(keys$: Observable<SearchKey>, pauseMs: number = SEARCH_PAUSE_MS): Observable<SearchCommit> {
    return keys$.pipe(switchMap(key => {
        if (key.kind === 'cleared') {
            return EMPTY;
        }
        const commit = { q: key.q.trim(), entered: key.kind === 'entered' };

        return key.kind === 'entered' ? of(commit) : timer(pauseMs).pipe(map(() => commit));
    }));
}

/** Why a server search answered no hits, by the problem's type (`/errors/email/server-search/<reason>`). */
export interface ServerSearchRefusal {
    reason: 'unsupported' | 'query-invalid' | 'unavailable' | 'rate-limited' | 'stale-cursor' | 'failed' | 'gone' | null;
    /** What the server or the connection said, for `unsupported` and `unavailable`. */
    said: string | null;
    /** The server that failed, for `failed`. */
    server: string | null;
    /** Seconds to wait, for `rate-limited`. */
    retryAfter: number | null;
}

const REASONS = ['unsupported', 'query-invalid', 'unavailable', 'rate-limited', 'stale-cursor', 'failed', 'gone'] as const;

export function serverSearchRefusal(error: unknown): ServerSearchRefusal {
    if (!(error instanceof HttpErrorResponse)) {
        return { reason: null, said: null, server: null, retryAfter: null };
    }
    let body: unknown = error.error;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = null;
        }
    }
    const problem = (typeof body === 'object' && body !== null ? body : {}) as { type?: unknown; reason?: unknown; server?: unknown };
    const type = typeof problem.type === 'string' ? problem.type : '';
    const tail = type.includes('/errors/email/server-search/') ? type.slice(type.lastIndexOf('/') + 1) : '';
    const reason = (REASONS as readonly string[]).includes(tail) ? tail as ServerSearchRefusal['reason'] : null;
    const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

    return {
        reason,
        said: text(problem.reason),
        server: text(problem.server),
        retryAfter: reason === 'rate-limited' ? retryAfterSeconds(error.headers.get('Retry-After') ?? null) : null,
    };
}

/** Retry-After as seconds: a number of seconds or an HTTP date; at least 1. */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number {
    if (header === null || header.trim() === '') {
        return DEFAULT_RETRY_AFTER_S;
    }
    const n = Number(header.trim());
    if (Number.isFinite(n)) {
        return Math.max(1, Math.ceil(n));
    }
    const at = Date.parse(header);

    return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_S : Math.max(1, Math.ceil((at - now) / 1000));
}

/** What a server search section shows. */
export type ServerSearchView =
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'answered' }
    | { kind: 'unsupported'; reason: string | null }
    | { kind: 'unavailable'; reason: string | null }
    | { kind: 'rate-limited'; seconds: number; willRetry: boolean }
    | { kind: 'failed'; server: string | null }
    | { kind: 'query-invalid' }
    | { kind: 'error' };

/** One page of a server search: the first without a cursor. Unsubscribing aborts it. */
export type ServerSearchFetch = (q: string, cursor: string | null) => Observable<ServerSearchAnswerDto>;

/** The views a first page ends in; a rate-limited one is still waiting until its last countdown ends. */
const SETTLED = new Set<ServerSearchView['kind']>(['answered', 'unsupported', 'unavailable', 'failed', 'query-invalid', 'error']);

/**
 * One mailbox's server search: the hits a query found, page by page, and what the section shows. A new query aborts
 * the request in flight, and an answer for another query than the one asked is dropped. A server that cannot search,
 * or a mailbox that cannot be reached, is shown from the mailbox's capability without asking.
 */
export class MailServerSearch {
    readonly view = signal<ServerSearchView>({ kind: 'idle' });
    /** The query asked, trimmed. */
    readonly query = signal('');
    readonly hits = signal<ServerSearchHitDto[]>([]);
    readonly next = signal<string | null>(null);
    readonly capped = signal(false);
    /** What the server matched (`gmail-raw`, `imap-text`), from the last answer. */
    readonly matches = signal<string | null>(null);
    readonly loadingMore = signal(false);

    /** The mailbox's server search as last learned; null when the server did not say. */
    readonly capabilityState = computed(() => this.capability()?.state ?? null);

    /** The capability's own view, before any search: unsupported or unavailable; null when a search may run. */
    readonly before = computed<ServerSearchView | null>(() => {
        const c = this.capability();
        if (c?.state === 'unsupported') {
            return { kind: 'unsupported', reason: c.reason ?? null };
        }
        if (c?.state === 'unavailable') {
            return { kind: 'unavailable', reason: c.reason ?? null };
        }

        return null;
    });

    /** What the section shows: the capability's view until a search has answered otherwise. */
    readonly shown = computed<ServerSearchView>(() => {
        const view = this.view();

        return view.kind === 'idle' ? this.before() ?? view : view;
    });

    private readonly settled = new Subject<void>();
    private request: Subscription | null = null;
    private countdown: Subscription | null = null;
    private lastCursor: string | null = null;

    constructor(
        private readonly fetch: ServerSearchFetch,
        private readonly capability: () => ServerSearchCapability | null | undefined = () => null,
        private readonly learned: (capability: ServerSearchCapability) => void = () => undefined,
    ) {}

    /** Search for `q` from its first page. An empty query stops. */
    run(q: string): void {
        this.start(q.trim(), null, false);
    }

    /** The next page, by the cursor the last answer named. */
    more(): void {
        const cursor = this.next();
        if (cursor === null || this.request !== null) {
            return;
        }
        this.start(this.query(), cursor, false);
    }

    /** The page last asked for, asked again. */
    retry(): void {
        this.start(this.query(), this.lastCursor, false);
    }

    /** Stops: the request in flight is aborted, and nothing is shown. */
    stop(): void {
        this.cancel();
        this.query.set('');
        this.reset();
        this.view.set({ kind: 'idle' });
    }

    /** Whether the first page has ended in what it shows for good (a rate-limited one is still waiting). */
    isSettled(): boolean {
        const shown = this.shown();
        // A rate-limited search that will not ask again on its own has ended once its countdown has.
        return SETTLED.has(shown.kind) || (shown.kind === 'rate-limited' && !shown.willRetry && shown.seconds === 0);
    }

    /** Emits each time a first page ends in what it shows for good. */
    whenSettled(): Observable<void> {
        return this.isSettled() ? of(undefined) : this.settled.pipe(take(1));
    }

    /** A hit opened elsewhere: it is now held, as `localId`. */
    markLocal(ref: string, localId: string): void {
        this.hits.set(this.hits().map(h => (h.ref === ref ? { ...h, local: true, localId } : h)));
    }

    /** A hit the server no longer has leaves the list. */
    drop(ref: string): void {
        this.hits.set(this.hits().filter(h => h.ref !== ref));
    }

    private start(q: string, cursor: string | null, auto: boolean): void {
        this.cancel();
        if (cursor === null) {
            this.query.set(q);
            this.reset();
        }
        if (q === '') {
            this.view.set({ kind: 'idle' });
            return;
        }
        const before = cursor === null ? this.before() : null;
        if (before !== null) {
            this.view.set(before);
            this.settled.next();
            return;
        }
        this.lastCursor = cursor;
        if (cursor === null) {
            this.view.set({ kind: 'searching' });
        } else {
            this.loadingMore.set(true);
        }
        this.request = this.fetch(q, cursor).subscribe({
            next: answer => this.answered(answer, cursor),
            error: (error: unknown) => this.refused(error, cursor, auto),
        });
    }

    private answered(answer: ServerSearchAnswerDto, cursor: string | null): void {
        this.request = null;
        this.loadingMore.set(false);
        if (answer.q !== this.query()) {
            // An answer for another query is dropped: the page asked ends with nothing from it.
            this.view.set({ kind: 'answered' });
            if (cursor === null) {
                this.settled.next();
            }
            return;
        }
        // A later page never repeats a hit already listed (a page can overlap the last when the server moved on).
        const listed = new Set(cursor === null ? [] : this.hits().map(h => h.ref));
        this.hits.set([...(cursor === null ? [] : this.hits()), ...answer.hits.filter(h => !listed.has(h.ref))]);
        this.next.set(answer.next ?? null);
        this.capped.set(answer.capped === true);
        this.matches.set(answer.searched?.matches ?? null);
        this.view.set({ kind: 'answered' });
        if (cursor === null) {
            this.settled.next();
        }
    }

    private refused(error: unknown, cursor: string | null, auto: boolean): void {
        this.request = null;
        this.loadingMore.set(false);
        const refusal = serverSearchRefusal(error);
        switch (refusal.reason) {
            case 'stale-cursor':
                if (cursor !== null) {
                    this.start(this.query(), null, false);
                    return;
                }
                this.view.set({ kind: 'error' });
                break;
            case 'rate-limited':
                this.wait(refusal.retryAfter ?? DEFAULT_RETRY_AFTER_S, cursor, !auto);
                return;
            case 'unsupported':
                this.view.set({ kind: 'unsupported', reason: refusal.said });
                this.learned({ state: 'unsupported', reason: refusal.said });
                break;
            case 'unavailable':
                this.view.set({ kind: 'unavailable', reason: refusal.said });
                break;
            case 'failed':
                this.view.set({ kind: 'failed', server: refusal.server });
                break;
            case 'query-invalid':
                this.view.set({ kind: 'query-invalid' });
                break;
            default:
                this.view.set({ kind: 'error' });
        }
        this.settled.next();
    }

    /** Counts Retry-After down; at zero asks once more, unless this answer was that once. */
    private wait(seconds: number, cursor: string | null, willRetry: boolean): void {
        this.view.set({ kind: 'rate-limited', seconds, willRetry });
        this.countdown = interval(1000).pipe(take(seconds)).subscribe(tick => {
            const left = seconds - tick - 1;
            if (left > 0) {
                this.view.set({ kind: 'rate-limited', seconds: left, willRetry });
                return;
            }
            this.countdown = null;
            if (willRetry) {
                this.start(this.query(), cursor, true);
            } else {
                this.view.set({ kind: 'rate-limited', seconds: 0, willRetry: false });
                this.settled.next();
            }
        });
    }

    private cancel(): void {
        this.request?.unsubscribe();
        this.request = null;
        this.countdown?.unsubscribe();
        this.countdown = null;
        this.loadingMore.set(false);
    }

    private reset(): void {
        this.hits.set([]);
        this.next.set(null);
        this.capped.set(false);
        this.matches.set(null);
        this.lastCursor = null;
    }
}

/** One other mailbox's section of a search across the person's other mailboxes. */
export interface OtherMailboxSection {
    mailboxId: string;
    title: string;
    search: MailServerSearch;
    /** Opens a hit of this mailbox the platform does not hold; null while that is not offered. */
    open: (hit: ServerSearchHitDto) => Observable<ServerMessageOpenedDto> | null;
}

/**
 * The same query on the person's other mailboxes, one after another: each starts once the one before has answered or
 * refused (a rate-limited one is waited for). Stopping aborts the one in flight and drops the rest.
 */
export class OtherMailboxesSearch {
    readonly sections = signal<OtherMailboxSection[]>([]);
    readonly query = signal('');
    private chain: Subscription | null = null;

    start(q: string, sections: OtherMailboxSection[]): void {
        this.stop();
        this.query.set(q.trim());
        this.sections.set(sections);
        this.chain = concat(...sections.map(s => defer(() => {
            s.search.run(q);
            return s.search.whenSettled();
        }))).subscribe();
    }

    stop(): void {
        this.chain?.unsubscribe();
        this.chain = null;
        for (const s of this.sections()) {
            s.search.stop();
        }
        this.sections.set([]);
        this.query.set('');
    }
}

/** A message size in the page's words: bytes, KB or MB. */
export function sizeText(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
        return '';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the server matched, in the page's words, from the stable code. */
export function matchesText(code: string | null): string | null {
    switch (code) {
        case null:
            return null;
        case 'gmail-raw':
            return 'Gmail\'s own search, over the whole mailbox.';
        case 'imap-text':
            return 'The mail server\'s search of headers and message text.';
        default:
            return `The mail server's search (${code}).`;
    }
}
