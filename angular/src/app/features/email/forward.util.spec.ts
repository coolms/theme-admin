import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { type EmailMessageDetailDto } from './email.types';
import { buildForward } from './forward.util';

/**
 * Forward: the subject gains "Fwd:" once,
 * the original's header block sits above its text, and the text goes in escaped -- a forward never carries the
 * original's markup into the composer.
 */
describe('forward', () => {
    const msg = (over: Partial<EmailMessageDetailDto> = {}): EmailMessageDetailDto => ({
        id: 'm1',
        subject: 'Run failed: CI',
        fromName: 'CI Notifications',
        fromAddress: 'notifications@example.test',
        toAddresses: ['shots@example.test'],
        bodyText: 'Line one\nLine <two>',
        snippet: 'Line one',
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
                    tz:           () => 'UTC',
                    dateFormat:   () => 'yyyy-MM-dd',
                    timeFormat:   () => '24h',
                },
            }],
        });
        dtf = TestBed.inject(DateTimeFormatService);
    });

    it('prefixes the subject with Fwd: once', () => {
        expect(buildForward(msg(), dtf).subject).toBe('Fwd: Run failed: CI');
        expect(buildForward(msg({ subject: 'Fwd: Run failed: CI' }), dtf).subject).toBe('Fwd: Run failed: CI');
        expect(buildForward(msg({ subject: '' }), dtf).subject).toBe('Fwd:');
    });

    it('puts the original\'s header block above its text', () => {
        const fwd = buildForward(msg(), dtf);
        expect(fwd.text).toContain('---------- Forwarded message ----------\n'
            + 'From: CI Notifications <notifications@example.test>\nDate: 2026-09-15 01:30\nSubject: Run failed: CI\n'
            + 'To: shots@example.test\n\nLine one\nLine <two>');
    });

    it('escapes the original\'s text in the HTML body', () => {
        const fwd = buildForward(msg(), dtf);
        expect(fwd.html).toContain('Line &lt;two&gt;');
        expect(fwd.html).not.toContain('<two>');
    });

    it('falls back to the snippet when there is no plain body', () => {
        expect(buildForward(msg({ bodyText: null }), dtf).text).toContain('\n\nLine one');
    });
});
