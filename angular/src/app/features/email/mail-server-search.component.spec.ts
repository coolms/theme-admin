import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { type WritableSignal, signal } from '@angular/core';
import { Subject, throwError } from 'rxjs';
import { DateTimeFormatService } from '@coolms/ui-angular';

import { EmailService, SERVER_MESSAGE_OPEN_SERVED } from './email.service';
import type { ServerSearchAnswerDto, ServerSearchCapability, ServerSearchHitDto } from './email.types';
import { MailServerSearchComponent, OLDER_WORDS, type ServerHitOpened } from './mail-server-search.component';
import { MailServerSearch } from './mail-server-search';

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
 * The "More on the server" section as drawn: hit rows with their headers; a hit the local results show is not drawn
 * twice; a held hit opens as stored and any other says opening is coming; each refusal in its own words; the cap.
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
                { provide: DateTimeFormatService, useValue: { auto: (iso: string | null | undefined) => iso ?? '' } },
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
        expect(opened).toEqual([{ id: 'm9', folder: 'INBOX', seen: false }]);
    });

    it('every hit already in the results above: says so instead of an empty list', () => {
        const el = render(['m1']);
        search.run('q');
        replies.next(answer('q', [hit(1, { local: true, localId: 'm1' })]));
        fixture.detectChanges();

        expect(el.querySelectorAll('[data-test="server-hit"]').length).toBe(0);
        expect(text(el, 'server-search-all-local')).toContain('in the results above');
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

            expect(opened).toEqual([{ id: 'm42', folder: 'Archive', seen: true }]);
            expect(search.hits()[0]).toEqual(jasmine.objectContaining({ ref: 'ref-3', local: true, localId: 'm42' }));
        });

        it('404 gone: the row leaves, and the section says so', () => {
            const el = openWith({ type: '/errors/email/server-search/gone' }, 404);

            expect(search.hits().map(h => h.ref)).toEqual(['ref-4']);
            expect(text(el, 'server-hit-gone')).toBe('No longer on the server.');
            expect(opened).toEqual([]);
        });

        it('503 unavailable: said under the row, with the reason', () => {
            const el = openWith({ type: '/errors/email/server-search/unavailable', reason: 'unreachable' }, 503);

            expect(text(el, 'server-hit-notice')).toBe('Can\'t reach the mail server right now: unreachable.');
            expect(search.hits().length).toBe(2);
        });

        it('502 failed: said under the row, naming the server', () => {
            const el = openWith({ type: '/errors/email/server-search/failed', server: 'imap.example.test' }, 502);

            expect(text(el, 'server-hit-notice')).toBe('imap.example.test couldn\'t open this message.');
        });
    });

    it('unsupported on the mailbox: said before any search, with the reason', () => {
        capability.set({ state: 'unsupported', reason: 'BAD [BADCHARSET] (US-ASCII)' });
        const el = render();

        expect(text(el, 'server-search-unsupported')).toContain('This mail server can\'t search older mail.');
        expect(text(el, 'server-search-unsupported')).toContain('BAD [BADCHARSET] (US-ASCII)');
        expect(asked).toBe(0);
    });

    it('unavailable on the mailbox: said before any search, with the reason', () => {
        capability.set({ state: 'unavailable', reason: 'auth_refused' });
        const el = render();

        expect(text(el, 'server-search-unavailable')).toContain('Can\'t reach the mail server right now.');
        expect(text(el, 'server-search-unavailable')).toContain('auth_refused');
    });

    it('unknown: searching says the first search decides', () => {
        capability.set({ state: 'unknown' });
        const el = render();
        search.run('q');
        fixture.detectChanges();

        expect(text(el, 'server-search-unknown')).toContain('this first search decides');
    });

    it('each refusal in its own words', () => {
        const el = render();
        const cases: Array<[HttpErrorResponse, string, string]> = [
            [refused(422, 'query-invalid'), 'server-search-query-invalid', '1 to 200 characters'],
            [refused(503, 'unavailable', { reason: 'unreachable' }), 'server-search-unavailable', 'unreachable'],
            [refused(502, 'failed', { server: 'imap.example.test' }), 'server-search-failed', 'imap.example.test answered the search with an error'],
            [refused(422, 'unsupported', { reason: 'NO [CANNOT]' }), 'server-search-unsupported', 'NO [CANNOT]'],
            [new HttpErrorResponse({ status: 500 }), 'server-search-error', 'Couldn\'t search the mail server.'],
        ];
        for (const [error, test, words] of cases) {
            capability.set({ state: 'supported' });
            search.run('q');
            replies.error(error);
            fixture.detectChanges();
            expect(text(el, test)).withContext(test).toContain(words);
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

        expect(text(el, 'server-search-rate-limited')).toContain('Too many server searches in a minute.');
        expect(text(el, 'server-search-countdown')).toBe('Searching again in 42 s.');
        search.stop();
    });

    describe('as the older mail of a folder', () => {
        const renderOlder = (listed: string[]): HTMLElement => {
            const el = render(listed);
            fixture.componentRef.setInput('heading', 'On the server');
            fixture.componentRef.setInput('words', OLDER_WORDS);
            fixture.detectChanges();
            return el;
        };

        it('a held row the list shows is skipped; one it does not show opens as stored; more reads older', () => {
            const el = renderOlder(['m2']);
            search.run('Archive');
            replies.next(answer('Archive', [hit(1, { local: true, localId: 'm2' }), hit(2, { local: true, localId: 'm7', seen: false }), hit(3)], { next: 'c1' }));
            fixture.detectChanges();

            const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-test="server-hit"]'));
            expect(rows.map(r => /Sender (\d)/.exec(r.textContent ?? '')?.[1])).withContext('m2 is in the list above').toEqual(['2', '3']);
            expect(rows[0].textContent).toContain('Kept here');
            expect(text(el, 'server-search-more')).toBe('Load older from the server');

            rows[0].click();
            expect(opened).toEqual([{ id: 'm7', folder: 'INBOX', seen: false }]);
        });

        it('says it in its own words: nothing older, the rate limit', () => {
            const el = renderOlder([]);
            search.run('Archive');
            replies.next(answer('Archive', []));
            fixture.detectChanges();
            expect(text(el, 'server-search-empty')).toBe('No older mail on the server.');

            search.run('Spam');
            replies.error(new HttpErrorResponse({
                status: 429, error: { type: '/errors/email/server-search/rate-limited' }, headers: new HttpHeaders({ 'Retry-After': '30' }),
            }));
            fixture.detectChanges();
            expect(text(el, 'server-search-rate-limited')).toContain('Too many pages asked of the mail server in a minute.');
            expect(text(el, 'server-search-countdown')).toBe('Loading again in 30 s.');
            search.stop();
        });
    });

    it('capped: "Showing the first 500."', () => {
        const el = render();
        search.run('q');
        replies.next(answer('q', [hit(1)], { capped: true, next: null }));
        fixture.detectChanges();

        expect(text(el, 'server-search-capped')).toBe('Showing the first 500.');
        expect(el.querySelector('[data-test="server-search-more"]')).toBeNull();
    });

    it('load more while a next page is named', () => {
        const el = render();
        search.run('q');
        replies.next(answer('q', [hit(1)], { next: 'c1' }));
        fixture.detectChanges();

        el.querySelector<HTMLButtonElement>('[data-test="server-search-more"]')?.click();
        expect(asked).toBe(2);
        replies.next(answer('q', [hit(2)]));
        fixture.detectChanges();

        expect(el.querySelectorAll('[data-test="server-hit"]').length).toBe(2);
        expect(el.querySelector('[data-test="server-search-more"]')).toBeNull();
    });
});
