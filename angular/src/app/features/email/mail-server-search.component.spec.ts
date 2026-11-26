import { TestBed, type ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { type WritableSignal, signal } from '@angular/core';
import { Subject, throwError } from 'rxjs';
import { DateTimeFormatService } from '@coolms/ui-angular';

import { EmailService, SERVER_MESSAGE_OPEN_SERVED } from './email.service';
import type { ServerSearchAnswerDto, ServerSearchCapability, ServerSearchHitDto } from './email.types';
import { MailServerSearchComponent, OLDER_WORDS, SEARCH_WORDS, type ServerHitFailed, type ServerHitOpened, type ServerHitOpening } from './mail-server-search.component';
import { MailServerSearch, matchesText } from './mail-server-search';

const hit = (n: number, extra: Partial<ServerSearchHitDto> = {}): ServerSearchHitDto => ({
    ref: `ref-${n}`, folder: 'INBOX', uid: n, from: { name: `Sender ${n}`, address: `s${n}@example.test` },
    subject: `Subject ${n}`, date: '2019-03-04T10:00:00+03:00', sizeBytes: 2048, seen: true, flagged: false,
    local: false, localId: null, ...extra,
});

const answer = (q: string, hits: ServerSearchHitDto[], extra: Partial<ServerSearchAnswerDto> = {}): ServerSearchAnswerDto => ({
    q, folder: null, state: 'supported', searched: { folders: ['INBOX'], matches: 'imap-text' }, hits, next: null, capped: false, ...extra,
});

const refused = (status: number, reason: string, extra: Record<string, string> = {}): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: { type: `/errors/email/server-search/${reason}`, ...extra } });

/**
 * The "More results" section as drawn: hit rows with their headers; a hit the local results show is not drawn twice; a
 * held hit opens as stored and any other says opening is coming; each refusal in its own words; the cap; the next page
 * read when the section's end comes into view, once, with a row saying so. No word of a server in what it says.
 */
describe('MailServerSearchComponent', () => {
    let fixture: ComponentFixture<MailServerSearchComponent>;
    let capability: WritableSignal<ServerSearchCapability | null>;
    let replies: Subject<ServerSearchAnswerDto>;
    let asked: number;
    let search: MailServerSearch;
    let opened: ServerHitOpened[];

    function render(localIds: string[] = []): HTMLElement {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: DateTimeFormatService, useValue: { row: (iso: string | null | undefined) => iso ?? '' , auto: (iso: string | null | undefined) => iso ?? '' } },
                provideHttpClient(), provideHttpClientTesting(), { provide: Store, useValue: { selectSnapshot: () => null } },
            ],
        });
        fixture = TestBed.createComponent(MailServerSearchComponent);
        fixture.componentRef.setInput('search', search);
        fixture.componentRef.setInput('localIds', new Set(localIds));
        opened = [];
        fixture.componentInstance.opened.subscribe(o => opened.push(o));
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    it('its heading, and what it says while the first page is read', () => {
        const el = render();
        search.run('q');
        fixture.detectChanges();

        expect(el.querySelector('.mss__title')?.textContent?.trim()).toBe('More results');
        expect(el.querySelector('[data-test="server-search"]')?.getAttribute('aria-label')).toBe('More results');
        expect(el.querySelector('[role="status"]')?.textContent?.trim()).toBe('Looking for more results…');
        replies.next(answer('q', []));
        fixture.detectChanges();
        expect(text(el, 'server-search-empty')).toBe('No more results.');
    });

    it('none of its words names a server', () => {
        for (const said of [...Object.values(SEARCH_WORDS), ...Object.values(OLDER_WORDS), matchesText('imap-text'), matchesText('other')]) {
            expect(said).not.toMatch(/server/i);
        }
        expect(matchesText('imap-text')).toBe('The mailbox\'s own search, of headers and message text.');
        expect(matchesText('other')).toBe('The mailbox\'s own search (other).');
    });

    const text = (el: HTMLElement, test: string): string =>
        (el.querySelector(`[data-test="${test}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

    beforeEach(() => {
        capability = signal<ServerSearchCapability | null>({ state: 'supported' });
        asked = 0;
        search = new MailServerSearch(() => {
            asked += 1;
            replies = new Subject<ServerSearchAnswerDto>();
            return replies;
        }, () => capability());
    });

    it('draws each hit\'s headers: sender, subject, date, folder or Gmail labels, size', () => {
        const el = render();
        search.run('q');
        replies.next(answer('q', [hit(1), hit(2, { labels: ['Inbox', 'Receipts'], folder: '[Gmail]/All Mail', sizeBytes: 3 * 1024 * 1024 })]));
        fixture.detectChanges();

        const rows = Array.from(el.querySelectorAll('[data-test="server-hit"]')).map(r => (r.textContent ?? '').replace(/\s+/g, ' ').trim());
        expect(rows.length).toBe(2);
        expect(rows[0]).toContain('Sender 1');
        expect(rows[0]).toContain('Subject 1');
        expect(rows[0]).toContain('2019-03-04T10:00:00+03:00');
        expect(rows[0]).toContain('INBOX');
        expect(rows[0]).toContain('2 KB');
        expect(rows[1]).withContext('Gmail labels in place of All Mail').toContain('Inbox');
        expect(rows[1]).toContain('Receipts');
        expect(rows[1]).not.toContain('All Mail');
        expect(rows[1]).toContain('3.0 MB');
        expect(text(el, 'server-search-matches')).toContain('headers and message text');
    });

    it('a held hit the local results show is not drawn twice; another held hit opens as stored', () => {
        const el = render(['m1']);
        search.run('q');
        replies.next(answer('q', [hit(1, { local: true, localId: 'm1' }), hit(2, { local: true, localId: 'm9', seen: false }), hit(3)]));
        fixture.detectChanges();

        const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-test="server-hit"]'));
        expect(rows.map(r => r.textContent ?? '').map(t => /Sender (\d)/.exec(t)?.[1])).withContext('m1 is in the results above').toEqual(['2', '3']);

        rows[0].click();
        expect(opened).toEqual([jasmine.objectContaining({ id: 'm9', folder: 'INBOX', seen: false })]);
    });

    it('every hit already in the results above: says so instead of an empty list', () => {
        const el = render(['m1']);
        search.run('q');
        replies.next(answer('q', [hit(1, { local: true, localId: 'm1' })]));
        fixture.detectChanges();

        expect(el.querySelectorAll('[data-test="server-hit"]').length).toBe(0);
        expect(text(el, 'server-search-all-local')).toBe('Everything found is in the results above.');
    });

    it('once open is offered: the stored id opens, and a hit gone from the server leaves the list', () => {
        const el = render();
        search.run('q');
        replies.next(answer('q', [hit(3), hit(4)]));
        fixture.componentRef.setInput('opener', (h: ServerSearchHitDto) => (h.ref === 'ref-3'
            ? throwError(() => refused(404, 'gone'))
            : new Subject<never>()));
        fixture.detectChanges();

        el.querySelector<HTMLButtonElement>('[data-test="server-hit"]')?.click();
        fixture.detectChanges();

        expect(search.hits().map(h => h.ref)).toEqual(['ref-4']);
    });

    describe('opening a hit, through EmailService.openServerMessage', () => {
        const OPEN = '/api/v1/email/mailboxes/mb1/server-messages/ref-3/open';
        /** Renders, presses the first hit, and answers the open the service sends as given. */
        const openWith = (body: Record<string, string>, status = 200): HTMLElement => {
            const el = render();
            const email = TestBed.inject(EmailService);
            const http = TestBed.inject(HttpTestingController);
            search.run('q');
            replies.next(answer('q', [hit(3), hit(4)]));
            fixture.componentRef.setInput('opener', (h: ServerSearchHitDto) => email.openServerMessage('mb1', h));
            fixture.detectChanges();
            el.querySelector<HTMLButtonElement>('[data-test="server-hit"]')?.click();
            const req = http.expectOne(OPEN);
            expect(req.request.method).toBe('POST');
            req.flush(body, { status, statusText: String(status) });
            fixture.detectChanges();
            http.verify();
            return el;
        };

        it('the flag is on', () => {
            expect(SERVER_MESSAGE_OPEN_SERVED).toBeTrue();
        });

        it('200: the stored id opens, and the hit is now held', () => {
            openWith({ id: 'm42', folder: 'Archive' });

            expect(opened).toEqual([jasmine.objectContaining({ id: 'm42', folder: 'Archive', seen: true })]);
            expect(search.hits()[0]).toEqual(jasmine.objectContaining({ ref: 'ref-3', local: true, localId: 'm42' }));
        });

        it('says it is opening before the store answers, with the hit\'s header; a cancel aborts the store and drops its answer', () => {
            const el = render();
            const email = TestBed.inject(EmailService);
            const http = TestBed.inject(HttpTestingController);
            const openings: ServerHitOpening[] = [];
            const failures: ServerHitFailed[] = [];
            fixture.componentInstance.opening.subscribe(o => openings.push(o));
            fixture.componentInstance.openFailed.subscribe(f => failures.push(f));
            search.run('q');
            replies.next(answer('q', [hit(3), hit(4)]));
            fixture.componentRef.setInput('opener', (h: ServerSearchHitDto) => email.openServerMessage('mb1', h));
            fixture.detectChanges();
            el.querySelector<HTMLButtonElement>('[data-test="server-hit"]')?.click();
            const req = http.expectOne(OPEN);

            expect(openings.length).toBe(1);
            expect(openings[0].header).toEqual(jasmine.objectContaining({ subject: hit(3).subject ?? null }));
            openings[0].cancel();
            expect(req.cancelled).withContext('the store is aborted').toBeTrue();
            expect(opened).toEqual([]);
            expect(failures).toEqual([]);
            http.verify();
        });

        it('a store that failed says so to the host, with Try again', () => {
            const failures: ServerHitFailed[] = [];
            const el = render();
            fixture.componentInstance.openFailed.subscribe(f => failures.push(f));
            const email = TestBed.inject(EmailService);
            const http = TestBed.inject(HttpTestingController);
            search.run('q');
            replies.next(answer('q', [hit(3), hit(4)]));
            fixture.componentRef.setInput('opener', (h: ServerSearchHitDto) => email.openServerMessage('mb1', h));
            fixture.detectChanges();
            el.querySelector<HTMLButtonElement>('[data-test="server-hit"]')?.click();
            http.expectOne(OPEN).flush(
                { type: '/errors/email/server-search/unavailable', detail: 'Said by the server.' },
                { status: 503, statusText: '503' },
            );

            expect(failures.map(f => f.text)).withContext('a declared fault: its detail').toEqual(['Said by the server.']);
            failures[0].retry?.();
            expect(http.match(OPEN).length).withContext('Try again stores it again').toBe(1);
        });

        it('404 gone: the row leaves, and the section and the host say it was deleted in the person\'s mailbox', () => {
            const el = openWith({ type: '/errors/email/server-search/gone' }, 404);

            expect(search.hits().map(h => h.ref)).toEqual(['ref-4']);
            expect(text(el, 'server-hit-gone')).toBe('This message was deleted in your mailbox.');
            expect(opened).toEqual([]);

            const failures: ServerHitFailed[] = [];
            fixture.componentInstance.openFailed.subscribe(f => failures.push(f));
            fixture.componentRef.setInput('mailboxWords', 'your Gmail mailbox');
            fixture.detectChanges();
            el.querySelector<HTMLButtonElement>('[data-test="server-hit"]')?.click();
            TestBed.inject(HttpTestingController).expectOne('/api/v1/email/mailboxes/mb1/server-messages/ref-4/open')
                .flush({ type: '/errors/email/server-search/gone' }, { status: 404, statusText: '404' });
            fixture.detectChanges();
            expect(text(el, 'server-hit-gone')).toBe('This message was deleted in your Gmail mailbox.');
            expect(failures).toEqual([{ text: 'This message was deleted in your Gmail mailbox.', retry: null }]);
        });

        it('503 unavailable: said under the row in the server\'s detail', () => {
            const el = openWith({ type: '/errors/email/server-search/unavailable', reason: 'unreachable', detail: 'Said for 503.' }, 503);

            expect(text(el, 'server-hit-notice')).toBe('Said for 503.');
            expect(search.hits().length).toBe(2);
        });

        it('a declared 502 says its detail under the row', () => {
            const el = openWith({ type: '/errors/email/server-search/failed', detail: 'Said for 502.' }, 502);

            expect(text(el, 'server-hit-notice')).toBe('Said for 502.');
        });

        it('an undeclared 502 says the generic sentence under the row, never its text', () => {
            const el = openWith({ type: 'about:blank', detail: 'imap.example.test internals' }, 502);

            expect(text(el, 'server-hit-notice')).toBe('Something went wrong. Try again.');
        });
    });

    it('unsupported on the mailbox: said before any search, with the reason', () => {
        capability.set({ state: 'unsupported', reason: 'BAD [BADCHARSET] (US-ASCII)' });
        const el = render();

        expect(text(el, 'server-search-unsupported')).toContain('This mailbox can\'t be searched for more, so only the mail kept here was searched.');
        expect(text(el, 'server-search-unsupported')).toContain('BAD [BADCHARSET] (US-ASCII)');
        expect(asked).toBe(0);
    });

    it('unavailable on the mailbox: said before any search, with the reason', () => {
        capability.set({ state: 'unavailable', reason: 'auth_refused' });
        const el = render();

        expect(text(el, 'server-search-unavailable')).toContain('This mailbox can\'t be reached now, so it wasn\'t searched for more.');
        expect(text(el, 'server-search-unavailable')).toContain('auth_refused');
    });

    it('unknown: searching says the first search decides', () => {
        capability.set({ state: 'unknown' });
        const el = render();
        search.run('q');
        fixture.detectChanges();

        expect(text(el, 'server-search-unknown'))
            .toBe('It is not known yet whether this mailbox can be searched for more; this first search decides.');
    });

    it('each refusal in its own words', () => {
        const el = render();
        const cases: Array<[HttpErrorResponse, string, string]> = [
            [refused(422, 'query-invalid'), 'server-search-query-invalid', 'This search is empty or too long.'],
            [refused(503, 'unavailable', { reason: 'unreachable' }), 'server-search-unavailable', 'unreachable'],
            [refused(502, 'failed', { server: 'imap.example.test' }), 'server-search-failed', 'More results couldn\'t be loaded. Try again later.'],
            [refused(422, 'unsupported', { reason: 'NO [CANNOT]' }), 'server-search-unsupported', 'NO [CANNOT]'],
            [new HttpErrorResponse({ status: 500 }), 'server-search-error', 'More results couldn\'t be loaded. Try again later.'],
        ];
        for (const [error, test, words] of cases) {
            capability.set({ state: 'supported' });
            search.run('q');
            replies.error(error);
            fixture.detectChanges();
            expect(text(el, test)).withContext(test).toContain(words);
            expect(text(el, test)).withContext(test).not.toMatch(/server|imap\./);
            expect(Array.from(el.querySelectorAll('[data-test="server-search-retry"]')).map(b => b.textContent?.trim()))
                .withContext(`${test}: Try again after a failure only`)
                .toEqual(['server-search-failed', 'server-search-error'].includes(test) ? ['Try again'] : []);
        }
    });

    it('rate-limited: a countdown', () => {
        const el = render();
        search.run('q');
        replies.error(new HttpErrorResponse({
            status: 429,
            error: { type: '/errors/email/server-search/rate-limited' },
            headers: new HttpHeaders({ 'Retry-After': '42' }),
        }));
        fixture.detectChanges();

        expect(text(el, 'server-search-countdown')).toBe('Too many searches. Try again in 42 s.');
        expect(el.querySelector('[data-test="server-search-retry"]')).withContext('none while it counts').toBeNull();
        search.stop();
    });

    describe('as the older mail of a folder', () => {
        const renderOlder = (listed: string[]): HTMLElement => {
            const el = render(listed);
            fixture.componentRef.setInput('heading', 'Older mail');
            fixture.componentRef.setInput('words', OLDER_WORDS);
            fixture.detectChanges();
            return el;
        };

        it('a held row the list shows is skipped; one it does not show opens as stored', () => {
            const el = renderOlder(['m2']);
            search.run('Archive');
            replies.next(answer('Archive', [hit(1, { local: true, localId: 'm2' }), hit(2, { local: true, localId: 'm7', seen: false }), hit(3)], { next: 'c1' }));
            fixture.detectChanges();

            const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-test="server-hit"]'));
            expect(rows.map(r => /Sender (\d)/.exec(r.textContent ?? '')?.[1])).withContext('m2 is in the list above').toEqual(['2', '3']);
            expect(rows[0].textContent).toContain('Kept here');

            rows[0].click();
            expect(opened).toEqual([jasmine.objectContaining({ id: 'm7', folder: 'INBOX', seen: false })]);
        });

        it('says it in its own words: nothing older, the rate limit', () => {
            const el = renderOlder([]);
            search.run('Archive');
            replies.next(answer('Archive', []));
            fixture.detectChanges();
            expect(text(el, 'server-search-empty')).toBe('No older mail.');

            search.run('Spam');
            replies.error(new HttpErrorResponse({
                status: 429, error: { type: '/errors/email/server-search/rate-limited' }, headers: new HttpHeaders({ 'Retry-After': '30' }),
            }));
            fixture.detectChanges();
            expect(text(el, 'server-search-countdown')).toBe('Too many pages asked for. Try again in 30 s.');
            search.stop();

            search.run('Old');
            fixture.detectChanges();
            expect(el.querySelector('[role="status"]')?.textContent?.trim()).toBe('Loading older mail…');
            replies.error(refused(422, 'query-invalid'));
            fixture.detectChanges();
            expect(text(el, 'server-search-query-invalid')).toBe('This folder no longer exists.');

            search.run('Old');
            replies.error(new HttpErrorResponse({ status: 500 }));
            fixture.detectChanges();
            expect(text(el, 'server-search-error')).toContain('Older mail couldn\'t be loaded.');
        });
    });

    it('capped: says to narrow the search, and reads nothing more', () => {
        const el = render();
        search.run('q');
        replies.next(answer('q', [hit(1)], { capped: true, next: null }));
        fixture.detectChanges();

        expect(text(el, 'server-search-capped')).toBe('There are more results than can be shown: add a word to narrow the search.');
        expect(el.querySelector('[data-test="server-search-end"]')).toBeNull();
    });

    describe('its end', () => {
        /** What watches the section's end, in place of the browser's: each watched end comes into view when told to. */
        class FakeObserver {
            static all: FakeObserver[] = [];
            readonly watched: Element[] = [];
            closed = false;
            constructor(private readonly seen: (entries: Array<{ isIntersecting: boolean }>) => void) {
                FakeObserver.all.push(this);
            }
            observe(target: Element): void { this.watched.push(target); }
            unobserve(): void { /* never used */ }
            disconnect(): void { this.closed = true; }
            tell(inView: boolean): void { this.seen([{ isIntersecting: inView }]); }
        }
        const real = window.IntersectionObserver;
        /** The ends watched now. */
        const open = (): FakeObserver[] => FakeObserver.all.filter(o => !o.closed);
        const end = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-test="server-search-end"]');
        /** The end is seen, whichever end is watched now. */
        const reach = (): void => {
            open().forEach(o => o.tell(true));
            fixture.detectChanges();
        };
        const reply = (hits: ServerSearchHitDto[], extra: Partial<ServerSearchAnswerDto> = {}): void => {
            replies.next(answer('q', hits, extra));
            fixture.detectChanges();
        };

        beforeEach(() => {
            FakeObserver.all = [];
            window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
        });
        afterEach(() => {
            window.IntersectionObserver = real;
        });

        it('nothing is asked before the end is in view; in view, the next page, with a row saying it loads', () => {
            const el = render();
            search.run('q');
            reply([hit(1)], { next: 'c1' });
            expect(end(el)).not.toBeNull();
            expect(open().map(o => o.watched)).withContext('the end is watched').toEqual([[end(el)!]]);
            expect(el.querySelector('button[data-test="server-search-more"]')).withContext('no button').toBeNull();

            open().forEach(o => o.tell(false));
            expect(asked).withContext('out of view').toBe(1);

            reach();
            expect(asked).withContext('the next page').toBe(2);
            const row = el.querySelector('[data-test="server-search-loading"]');
            expect(row?.textContent?.trim()).toBe('Loading more results…');
            expect(row?.getAttribute('role')).toBe('status');

            reply([hit(2)]);
            expect(el.querySelectorAll('[data-test="server-hit"]').length).toBe(2);
            expect(el.querySelector('[data-test="server-search-loading"]')).withContext('the row goes').toBeNull();
            expect(end(el)).withContext('nothing more: the list just ends').toBeNull();
            expect(open()).withContext('nothing watched at the end').toEqual([]);
        });

        it('one call for a page, however often its end is seen; the next page\'s end asks for the next', () => {
            render();
            search.run('q');
            reply([hit(1)], { next: 'c1' });
            const first = open();
            first.forEach(o => { o.tell(true); o.tell(true); });
            fixture.detectChanges();
            first.forEach(o => o.tell(true));
            expect(asked).withContext('one call for page 2').toBe(2);

            reply([hit(2)], { next: 'c2' });
            expect(asked).withContext('not before its own end is seen').toBe(2);
            reach();
            expect(asked).withContext('page 3').toBe(3);
        });

        it('an answer dropped, or one that names the page just read, is not asked for again by itself', () => {
            render();
            search.run('q');
            reply([hit(1)], { next: 'c1' });
            reach();
            replies.next(answer('another', []));
            fixture.detectChanges();
            reach();
            expect(asked).withContext('the same cursor is asked for once').toBe(2);

            search.run('q');
            reply([hit(1)], { next: 'c1' });
            reach();
            reply([hit(2)], { next: 'c1' });
            reach();
            expect(asked).withContext('a cursor repeated ends the reading on').toBe(4);
        });

        it('a page not read says so with Try again, and is not asked for again by itself; Try again asks for it', () => {
            const el = render();
            search.run('q');
            reply([hit(1)], { next: 'c1' });
            reach();
            replies.error(new HttpErrorResponse({ status: 500 }));
            fixture.detectChanges();

            expect(text(el, 'server-search-error')).toContain('More results couldn\'t be loaded. Try again later.');
            expect(el.querySelectorAll('[data-test="server-hit"]').length).withContext('the results stay').toBe(1);
            expect(end(el)).withContext('no end to reach').toBeNull();
            reach();
            FakeObserver.all.forEach(o => o.tell(true));
            expect(asked).withContext('no loop').toBe(2);

            el.querySelector<HTMLButtonElement>('[data-test="server-search-retry"]')!.click();
            fixture.detectChanges();
            expect(asked).toBe(3);
            expect(text(el, 'server-search-error')).withContext('the sentence makes way for the row').toBe('');
            expect(text(el, 'server-search-loading')).toBe('Loading more results…');
            reply([hit(2)], { next: 'c2' });
            reach();
            expect(asked).withContext('and it reads on').toBe(4);
        });

        it('a rate limit on a page counts down, then goes on by itself; refused, the query\'s own sentence', fakeAsync(() => {
            const el = render();
            search.run('q');
            reply([hit(1)], { next: 'c1' });
            reach();
            replies.error(new HttpErrorResponse({
                status: 429, error: { type: '/errors/email/server-search/rate-limited' }, headers: new HttpHeaders({ 'Retry-After': '2' }),
            }));
            fixture.detectChanges();
            expect(text(el, 'server-search-countdown')).toBe('Too many searches. Try again in 2 s.');
            expect(end(el)).toBeNull();
            tick(1000);
            fixture.detectChanges();
            expect(text(el, 'server-search-countdown')).toBe('Too many searches. Try again in 1 s.');
            expect(asked).toBe(2);

            tick(1000);
            fixture.detectChanges();
            expect(asked).withContext('asked again once the pause ends').toBe(3);
            expect(text(el, 'server-search-loading')).toBe('Loading more results…');
            expect(text(el, 'server-search-countdown')).toBe('');

            replies.error(refused(422, 'query-invalid'));
            fixture.detectChanges();
            expect(text(el, 'server-search-query-invalid')).toBe('This search is empty or too long.');
            expect(end(el)).toBeNull();
        }));

        it('what is said of a whole answer waits for its last page', () => {
            const el = render(['m1']);
            search.run('q');
            reply([hit(1, { local: true, localId: 'm1' })], { next: 'c1' });
            expect(text(el, 'server-search-all-local')).toBe('');
            reach();
            reply([]);
            expect(text(el, 'server-search-all-local')).toBe('Everything found is in the results above.');
        });

        it('two sections: each one\'s end reads its own next page', () => {
            const askedOf: string[] = [];
            const pages = new Map<string, Subject<ServerSearchAnswerDto>>();
            const section = (id: string): MailServerSearch => new MailServerSearch((_q, cursor) => {
                askedOf.push(`${id} ${cursor ?? 'first'}`);
                const s = new Subject<ServerSearchAnswerDto>();
                pages.set(id, s);
                return s;
            });
            render();
            const [a, b] = [section('a'), section('b')].map((of, i) => {
                const f = TestBed.createComponent(MailServerSearchComponent);
                f.componentRef.setInput('search', of);
                f.detectChanges();
                of.run('q');
                pages.get(i === 0 ? 'a' : 'b')!.next(answer('q', [hit(i)], { next: `c-${i}` }));
                f.detectChanges();
                return { f, watcher: open().at(-1)! };
            });

            b.watcher.tell(true);
            expect(askedOf).withContext('b\'s end').toEqual(['a first', 'b first', 'b c-1']);
            a.watcher.tell(true);
            expect(askedOf).withContext('a\'s end').toEqual(['a first', 'b first', 'b c-1', 'a c-0']);
        });
    });

    it('in a real scrolling list: read on when the end is scrolled into view, not before', async () => {
        const el = render();
        const scroller = document.createElement('div');
        scroller.style.cssText = 'height: 200px; overflow-y: auto; position: fixed; top: 0; left: 0; width: 320px;';
        document.body.appendChild(scroller);
        scroller.appendChild(el);
        try {
            search.run('q');
            replies.next(answer('q', Array.from({ length: 20 }, (_, i) => hit(i)), { next: 'c1' }));
            fixture.detectChanges();
            const frames = async (until: () => boolean): Promise<void> => {
                for (let i = 0; i < 120 && !until(); i++) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));
                }
            };
            expect(scroller.scrollHeight).withContext('the end is below the view').toBeGreaterThan(400);
            let frame = 0;
            await frames(() => ++frame > 10);
            expect(asked).withContext('not yet in view').toBe(1);

            scroller.scrollTop = scroller.scrollHeight;
            await frames(() => asked > 1);
            expect(asked).withContext('scrolled to the end').toBe(2);
        } finally {
            scroller.remove();
        }
    });
});
