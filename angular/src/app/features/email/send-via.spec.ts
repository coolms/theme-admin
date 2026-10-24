import { HttpErrorResponse } from '@angular/common/http';
import { sendApiWhyNot, sendFailureText, sendViaChoices, sendViaHint } from './send-via';

const gmail = (available: boolean | null, reason: 'not_enabled' | 'no_consent' | null = null) =>
    ({ available, name: 'Gmail API', reason });

describe('Sending: Auto, API or SMTP', () => {
    it('says why the API cannot be used, with what can be done, and nothing when it can or is not known', () => {
        expect(sendApiWhyNot(gmail(false, 'not_enabled'))).toBe('Your administrator has not enabled sending through Gmail API for this installation.');
        expect(sendApiWhyNot(gmail(false, 'no_consent'))).toBe('Reconnect this mailbox to allow sending through Gmail API.');
        expect(sendApiWhyNot({ available: false, name: null, reason: 'not_supported' })).toBe('This mail server has no sending API; mail goes by SMTP.');
        expect(sendApiWhyNot(gmail(true))).toBeNull();
        expect(sendApiWhyNot(gmail(null))).toBeNull();
    });

    it('a read with no sendApi at all says nothing about it: not known, never "no API" or "yes"', () => {
        for (const missing of [null, undefined]) {
            expect(sendApiWhyNot(missing)).toBeNull();
            expect(sendViaHint('auto', missing)).toContain('not checked yet');
            expect(sendViaChoices(missing, 'auto').find(c => c.value === 'api')!.disabled).toBeFalse();
        }
    });

    it('offers API only where it may be chosen, or where it already is', () => {
        const disabled = (api: ReturnType<typeof gmail>, current: 'auto' | 'api') => sendViaChoices(api, current).find(c => c.value === 'api')!.disabled;
        expect(disabled(gmail(true), 'auto')).toBeFalse();
        expect(disabled(gmail(null), 'auto')).toBeFalse();
        expect(disabled(gmail(false, 'no_consent'), 'auto')).toBeTrue();
        expect(disabled(gmail(false, 'no_consent'), 'api')).toBeFalse();
        expect(sendViaChoices(gmail(true), 'auto').map(c => c.label)).toEqual(['Auto', 'API (Gmail API)', 'SMTP']);
    });

    it('Auto: says "not checked yet" until a send has found out, never takes it for yes', () => {
        expect(sendViaHint('auto', gmail(null))).toContain('not checked yet');
        expect(sendViaHint('auto', gmail(true))).not.toContain('not checked yet');
        expect(sendViaHint('auto', gmail(false, 'not_enabled'))).toBe('Mail goes by SMTP. Your administrator has not enabled sending through Gmail API for this installation.');
        expect(sendViaHint('api', gmail(true))).toContain('never goes by SMTP');
        expect(sendViaHint('smtp', gmail(true))).toBe('Mail goes by SMTP only.');
    });

    it("a failed send in the page's words by its type; an unknown cause does not claim the message was not sent", () => {
        const failed = (cause: string) => new HttpErrorResponse({ status: 502, error: { type: `/errors/mailbox-send/${cause}`, detail: 'smtp.example.test said something' } });
        const causes = ['unreachable', 'auth-refused', 'reauth-required', 'recipient-rejected', 'rejected', 'api-unavailable'];
        const texts = causes.map(c => sendFailureText(failed(c)));
        expect(new Set(texts).size).toBe(causes.length);
        texts.forEach(t => expect(t).not.toContain('smtp.example.test'));
        expect(sendFailureText(failed('unknown'))).toContain('not known');
        expect(sendFailureText(new HttpErrorResponse({ status: 500 }))).toContain('not known');
    });
});
