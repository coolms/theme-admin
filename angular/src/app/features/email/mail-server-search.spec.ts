import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { type WritableSignal, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import { type Observable, Subject, throwError } from 'rxjs';

import { EmailService, SERVER_MESSAGE_OPEN_SERVED } from './email.service';
import type { ServerSearchAnswerDto, ServerSearchCapability, ServerSearchHitDto } from './email.types';
import { MailServerSearch, OtherMailboxesSearch, retryAfterSeconds, searchCommits, type SearchCommit, type SearchKey } from './mail-server-search';

const URL = '/api/v1/email/mailboxes/mb1/server-search';

const serverHit = (n: number, extra: Partial<ServerSearchHitDto> = {}): ServerSearchHitDto => ({
    ref: `ref-${n}`, folder: 'INBOX', uid: n, from: { name: `Sender ${n}`, address: `s${n}@example.test` },
    subject: `Subject ${n}`, date: '2019-03-04T10:00:00+03:00', sizeBytes: 2048, seen: true, flagged: false,
    local: false, localId: null, ...extra,
});

const serverAnswer = (q: string, hits: ServerSearchHitDto[], extra: Partial<ServerSearchAnswerDto> = {}): ServerSearchAnswerDto => ({
    q, folder: null, state: 'supported', searched: { folders: ['INBOX'], matches: 'imap-text' }, hits, next: null, capped: false, ...extra,
});

const problem = (reason: string, extra: Record<string, string> = {}): Record<string, unknown> => ({
    type: `/errors/email/server-search/${reason}`, title: 'refused', ...extra,
});

/**
 * The server search behind the mail page's "More on the server": a search runs after typing pauses or at Enter, a new
 * query aborts the request in flight, an answer for another query is dropped, each refusal is a view of its own, a
 * mailbox that cannot search is shown so without asking, pages follow the cursor, and a stale cursor starts again.
 */
describe('Mail server search', () => {
    describe('when a search runs', () => {
        let keys: Subject<SearchKey>;
        let commits: SearchCommit[];

        beforeEach(() => {
            keys = new Subject<SearchKey>();
            commits = [];
            searchCommits(keys).subscribe(c => commits.push(c));
        });

        it('not while typing; once, 600 ms after typing pauses', fakeAsync(() => {
            for (const text of ['i', 'in', 'inv', 'invo', 'invoice ']) {
                keys.next({ kind: 'typed', q: text });
                tick(300);
            }
            expect(commits).withContext('nothing while the keys come faster than the pause').toEqual([]);

            tick(299);
            expect(commits).withContext('599 ms after the last key').toEqual([]);

            tick(1);
            expect(commits).withContext('600 ms after the last key, trimmed').toEqual([{ q: 'invoice', entered: false }]);

            tick(5000);
            expect(commits.length).withContext('one search for one pause').toBe(1);
        }));

        it('at once on Enter, and the pause it ended asks nothing more', fakeAsync(() => {
            keys.next({ kind: 'typed', q: 'report' });
            tick(100);
            keys.next({ kind: 'entered', q: 'report' });

            expect(commits).withContext('Enter does not wait').toEqual([{ q: 'report', entered: true }]);

            tick(2000);
            expect(commits.length).withContext('the pending pause was ended by Enter').toBe(1);
        }));

        it('a cleared search drops the pause in progress', fakeAsync(() => {
            keys.next({ kind: 'typed', q: 'report' });
            tick(300);
            keys.next({ kind: 'cleared' });
            tick(2000);

            expect(commits).toEqual([]);
        }));
    });

    describe('against the server', () => {
        let http: HttpTestingController;
        let capability: WritableSignal<ServerSearchCapability | null>;
        let learned: ServerSearchCapability[];
        let search: MailServerSearch;

        beforeEach(() => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Store, useValue: { selectSnapshot: () => null } }],
            });
            const email = TestBed.inject(EmailService);
            http = TestBed.inject(HttpTestingController);
            capability = signal<ServerSearchCapability | null>({ state: 'supported' });
            learned = [];
            search = new MailServerSearch(
                (q, cursor) => email.serverSearch('mb1', q, cursor),
                () => capability(),
                c => learned.push(c),
            );
        });

        afterEach(() => http.verify());

        const firstPage = (): TestRequest => http.expectOne(r => r.url === URL && !r.params.has('cursor'));
        const cursorPage = (cursor: string): TestRequest => http.expectOne(r => r.url === URL && r.params.get('cursor') === cursor);

        it('a new query aborts the request in flight', () => {
            search.run('invoice');
            const first = firstPage();
            expect(first.request.params.get('q')).toBe('invoice');

            search.run('invoices');

            expect(first.cancelled).withContext('the first request was aborted').toBeTrue();
            const second = firstPage();
            second.flush(serverAnswer('invoices', [serverHit(1)]));
            expect(search.hits().map(h => h.ref)).toEqual(['ref-1']);
            expect(search.view().kind).toBe('answered');
        });

        it('asks with the trimmed query, and takes an answer that echoes it', () => {
            search.run('  invoice  ');
            const req = firstPage();
            expect(req.request.params.get('q')).toBe('invoice');

            req.flush(serverAnswer('invoice', [serverHit(1), serverHit(2)]));

            expect(search.hits().length).toBe(2);
            expect(search.view().kind).toBe('answered');
            expect(search.matches()).toBe('imap-text');
        });

        it('drops an answer whose q is not the query asked', () => {
            search.run('invoice');
            firstPage().flush(serverAnswer('invoices', [serverHit(1)]));

            expect(search.hits()).withContext('a stale answer shows nothing').toEqual([]);
        });

        it('a dropped answer ends its request: the first page settles with nothing, and a next page is not blocked', () => {
            let settled = 0;
            search.run('invoice');
            search.whenSettled().subscribe(() => { settled += 1; });
            firstPage().flush(serverAnswer('invoices', [serverHit(1)]));

            expect(search.view().kind).withContext('answered, with nothing').toBe('answered');
            expect(search.hits()).toEqual([]);
            expect(settled).withContext('the first page settled').toBe(1);

            search.run('invoice');
            firstPage().flush(serverAnswer('invoice', [serverHit(1)], { next: 'c1' }));
            search.more();
            cursorPage('c1').flush(serverAnswer('other', [serverHit(2)], { next: 'c2' }));

            expect(search.loadingMore()).withContext('the dropped page is not loading').toBeFalse();
            expect(search.hits().map(h => h.ref)).withContext('the rows shown stay').toEqual(['ref-1']);
            search.more();
            cursorPage('c1').flush(serverAnswer('invoice', [serverHit(2)]));
            expect(search.hits().length).withContext('the next page was asked again').toBe(2);
        });

        it('unsupported: said with the server\'s reason, and kept on the mailbox', () => {
            search.run('x');
            firstPage().flush(problem('unsupported', { reason: 'BAD [BADCHARSET]' }), { status: 422, statusText: 'Unprocessable' });

            expect(search.view()).toEqual({ kind: 'unsupported', reason: 'BAD [BADCHARSET]' });
            expect(learned).toEqual([{ state: 'unsupported', reason: 'BAD [BADCHARSET]' }]);
        });

        it('query-invalid', () => {
            search.run('x'.repeat(201));
            firstPage().flush(problem('query-invalid'), { status: 422, statusText: 'Unprocessable' });

            expect(search.view()).toEqual({ kind: 'query-invalid' });
            expect(learned).toEqual([]);
        });

        it('unavailable, with the connection\'s reason', () => {
            search.run('x');
            firstPage().flush(problem('unavailable', { reason: 'unreachable' }), { status: 503, statusText: 'Unavailable' });

            expect(search.view()).toEqual({ kind: 'unavailable', reason: 'unreachable' });
        });

        it('failed, naming the server, and Retry asks again', () => {
            search.run('x');
            firstPage().flush(problem('failed', { server: 'imap.example.test' }), { status: 502, statusText: 'Bad Gateway' });

            expect(search.view()).toEqual({ kind: 'failed', server: 'imap.example.test' });

            search.retry();
            firstPage().flush(serverAnswer('x', [serverHit(1)]));
            expect(search.view().kind).toBe('answered');
        });

        it('rate-limited: counts Retry-After down, asks once at zero, and waits for a press after that', fakeAsync(() => {
            search.run('x');
            firstPage().flush(problem('rate-limited'), { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '3' } });
            expect(search.view()).toEqual({ kind: 'rate-limited', seconds: 3, willRetry: true });

            tick(1000);
            expect(search.view()).toEqual({ kind: 'rate-limited', seconds: 2, willRetry: true });
            http.expectNone(r => r.url === URL);

            tick(2000);
            const again = firstPage();
            again.flush(problem('rate-limited'), { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '2' } });
            expect(search.view()).toEqual({ kind: 'rate-limited', seconds: 2, willRetry: false });

            tick(10000);
            http.expectNone(r => r.url === URL);
            expect(search.view()).withContext('no second asking on its own').toEqual({ kind: 'rate-limited', seconds: 0, willRetry: false });

            search.retry();
            firstPage().flush(serverAnswer('x', []));
            expect(search.view().kind).toBe('answered');
        }));

        it('unsupported or unavailable on the mailbox is shown before any search, and nothing is asked', () => {
            capability.set({ state: 'unsupported', reason: 'BAD [BADCHARSET]' });
            expect(search.shown()).withContext('before searching').toEqual({ kind: 'unsupported', reason: 'BAD [BADCHARSET]' });

            search.run('x');
            http.expectNone(r => r.url === URL);
            expect(search.shown()).toEqual({ kind: 'unsupported', reason: 'BAD [BADCHARSET]' });

            capability.set({ state: 'unavailable', reason: 'auth_refused' });
            search.run('y');
            http.expectNone(r => r.url === URL);
            expect(search.shown()).toEqual({ kind: 'unavailable', reason: 'auth_refused' });
        });

        it('unknown: the first search asks', () => {
            capability.set({ state: 'unknown' });
            expect(search.shown()).toEqual({ kind: 'idle' });

            search.run('x');
            firstPage().flush(serverAnswer('x', [serverHit(1)]));
            expect(search.view().kind).toBe('answered');
        });

        it('loads more by the cursor, and a stale cursor starts again from page 1', () => {
            const page = (from: number): ServerSearchHitDto[] => Array.from({ length: 50 }, (_, i) => serverHit(from + i));
            search.run('a');
            firstPage().flush(serverAnswer('a', page(0), { next: 'c1' }));
            expect(search.next()).toBe('c1');

            search.more();
            cursorPage('c1').flush(serverAnswer('a', page(50), { next: 'c2' }));
            expect(search.hits().length).withContext('the second page follows the first').toBe(100);

            search.more();
            cursorPage('c2').flush(problem('stale-cursor'), { status: 409, statusText: 'Conflict' });

            const restart = firstPage();
            expect(restart.request.params.get('q')).toBe('a');
            restart.flush(serverAnswer('a', page(1000), { next: 'c9' }));
            expect(search.hits().length).withContext('page 1 again, alone').toBe(50);
            expect(search.hits()[0].ref).toBe('ref-1000');
            expect(search.view().kind).toBe('answered');
        });

        it('opening a hit: a POST with no body, answering the stored id; null while it is not offered', () => {
            const email = TestBed.inject(EmailService);
            let stored: unknown = null;
            email.postServerMessageOpen('mb1', 'r/1').subscribe(a => { stored = a; });
            const req = http.expectOne('/api/v1/email/mailboxes/mb1/server-messages/r%2F1/open');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toBeNull();
            req.flush({ id: 'm42', folder: 'Archive' });
            expect(stored).toEqual({ id: 'm42', folder: 'Archive' });

            expect(SERVER_MESSAGE_OPEN_SERVED).toBeFalse();
            expect(email.openServerMessage('mb1', serverHit(1))).withContext('not offered yet: nothing asked').toBeNull();
        });

        it('capped: the answer says so', () => {
            search.run('a');
            firstPage().flush(serverAnswer('a', [serverHit(1)], { next: null, capped: true }));

            expect(search.capped()).toBeTrue();
            expect(search.next()).toBeNull();
        });
    });

    describe('on the other mailboxes', () => {
        it('a mailbox rate-limited twice ends its wait, and the next mailbox is still searched', fakeAsync(() => {
            const asked: string[] = [];
            const limited = (): HttpErrorResponse => new HttpErrorResponse({
                status: 429,
                error: { type: '/errors/email/server-search/rate-limited' },
                headers: new HttpHeaders({ 'Retry-After': '2' }),
            });
            const section = (id: string, answer: () => Observable<ServerSearchAnswerDto>) => ({
                mailboxId: id,
                title: id,
                search: new MailServerSearch(() => {
                    asked.push(id);
                    return answer();
                }),
                open: () => null,
            });
            const others = new OtherMailboxesSearch();
            const first = section('mb2', () => throwError(() => limited()));
            others.start('x', [first, section('mb3', () => new Subject<ServerSearchAnswerDto>())]);
            expect(asked).toEqual(['mb2']);

            tick(2000);
            expect(asked).withContext('one search again at zero, rate-limited again').toEqual(['mb2', 'mb2']);
            expect(first.search.view()).toEqual({ kind: 'rate-limited', seconds: 2, willRetry: false });

            tick(2000);
            expect(first.search.view()).withContext('its Retry stays').toEqual({ kind: 'rate-limited', seconds: 0, willRetry: false });
            expect(asked).withContext('the chain reached the next mailbox').toEqual(['mb2', 'mb2', 'mb3']);
            others.stop();
        }));

        it('one after another, each once the one before has answered', () => {
            const asked: string[] = [];
            const answers = new Map<string, Subject<ServerSearchAnswerDto>>();
            const section = (id: string) => ({
                mailboxId: id,
                title: id,
                search: new MailServerSearch((q) => {
                    asked.push(id);
                    const s = new Subject<ServerSearchAnswerDto>();
                    answers.set(id, s);
                    return s;
                }),
                open: () => null,
            });
            const others = new OtherMailboxesSearch();

            others.start('x', [section('mb2'), section('mb3')]);
            expect(asked).withContext('the first only').toEqual(['mb2']);

            answers.get('mb2')?.next(serverAnswer('x', []));
            expect(asked).withContext('the next once the first answered').toEqual(['mb2', 'mb3']);

            others.stop();
            expect(others.sections()).toEqual([]);
        });
    });

    it('Retry-After as seconds or a date', () => {
        expect(retryAfterSeconds('12')).toBe(12);
        expect(retryAfterSeconds(null)).toBe(60);
        expect(retryAfterSeconds(new Date(1_000_000 + 5000).toUTCString(), 1_000_000)).toBe(5);
    });
});
