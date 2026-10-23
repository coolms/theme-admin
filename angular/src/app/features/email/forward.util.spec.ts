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

    it('forwards an HTML-only message whole, as text, not its 200-character snippet', () => {
        const long = 'The job was not started because recent account payments have failed or your spending limit '
            + 'needs to be increased. Please go to the billing page to update your payment method and settings. '
            + 'This sentence keeps the body well past two hundred characters.';
        const fwd = buildForward(msg({
            bodyText: null,
            snippet: long.slice(0, 200),
            bodyHtml: `<h2>Run failed</h2><p>${long}</p><table><tr><th>Job</th><th>Status</th></tr>`
                + '<tr><td>lint</td><td>failure</td></tr></table><p>Run <b>&lt;42&gt;</b></p>',
        }), dtf);
        expect(fwd.text).toContain('Run failed\n' + long + '\nJob\tStatus');
        expect(fwd.text).toContain('lint\tfailure');
        expect(fwd.text).toContain('This sentence keeps the body well past two hundred characters.');
        expect(fwd.html).toContain('Run &lt;42&gt;');
        expect(fwd.html).not.toContain('<b>');
    });

    it('falls back to the snippet only when the message has neither a plain nor an HTML body', () => {
        expect(buildForward(msg({ bodyText: null, bodyHtml: null }), dtf).text).toContain('\n\nLine one');
    });
});
