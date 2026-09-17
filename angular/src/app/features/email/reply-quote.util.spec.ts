import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { type EmailMessageDetailDto } from './email.types';
import { buildReplyQuote } from './reply-quote.util';

/**
 * The quoted-original attribution names an instant, and the instant has to be
 * the PERSON's: their timezone, their date format, their 12h/24h choice. The
 * page used to hand it to `toLocaleString()` with no options at all.
 *
 * The clock case also asserts the browser's own rendering DIFFERS -- without
 * that it is vacuous on a machine already in the profile's zone, satisfied by
 * the very behaviour it exists to reject.
 */
describe('reply quote', () => {
    /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
    const PROFILE_TZ = 'Asia/Tokyo';

    const msg = (over: Partial<EmailMessageDetailDto> = {}): EmailMessageDetailDto => ({
        id: 'm1',
        fromName: 'Ada Lovelace',
        fromAddress: 'ada@example.test',
        snippet: 'First line\nSecond line',
        sentAt: '2026-09-15T01:30:00.000Z',
        ...over,
    });

    let dtf: DateTimeFormatService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [{
                provide:  UserCalendarPreferencesService,
                useValue: {
                    ensureLoaded: () => undefined,
                    tz:           () => PROFILE_TZ,
                    dateFormat:   () => 'yyyy-MM-dd',
                    timeFormat:   () => '24h',
                },
            }],
        });
        dtf = TestBed.inject(DateTimeFormatService);
    });

    it('dates the quote the PROFILE\'s way, not the browser locale and not the browser zone', () => {
        // 01:30 UTC is 10:30 in Tokyo. A 24h profile in Tokyo must say 2026-09-15 10:30.
        const iso = '2026-09-15T01:30:00.000Z';

        // What the page did before: browser locale, browser zone, seconds and all.
        const browserWould = new Date(iso).toLocaleString();
        expect(browserWould)
            .withContext('this spec is vacuous unless the browser renders it differently')
            .not.toContain('10:30');

        const quote = buildReplyQuote(msg({ sentAt: iso }), dtf);

        expect(quote.text).toContain('On 2026-09-15 10:30, Ada Lovelace <ada@example.test> wrote:');
        expect(quote.text).not.toContain(browserWould);
        expect(quote.text).not.toMatch(/AM|PM/);
        expect(quote.html).toContain('<p>On 2026-09-15 10:30, Ada Lovelace &lt;ada@example.test&gt; wrote:</p>');
    });

    it('drops the date clause when there is no instant to name', () => {
        expect(buildReplyQuote(msg({ sentAt: null }), dtf).text).toContain('\n\nAda Lovelace <ada@example.test> wrote:\n');
        expect(buildReplyQuote(msg({ sentAt: 'not a date' }), dtf).text).not.toContain('On ');
    });

    it('quotes the snippet line by line, escaped for the HTML half', () => {
        const quote = buildReplyQuote(msg({ fromName: null, snippet: 'a < b\n& c' }), dtf);

        expect(quote.text).toContain('ada@example.test wrote:\n> a < b\n> & c');
        expect(quote.html).toContain('<blockquote>a &lt; b<br>&amp; c</blockquote>');
    });
});
