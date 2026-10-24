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
        // The server reads silence after the message was handed over as `unknown`: unreachable never went out.
        expect(sendFailureText(failed('unreachable'))).toBe('The server could not be reached. The message was not sent.');
        expect(sendFailureText(failed('unknown'))).toContain('not known');
        expect(sendFailureText(new HttpErrorResponse({ status: 500 }))).toContain('not known');
    });

    it("shows the provider's own reason as its words, with a hint for a known code, and what became of the message", () => {
        const refused = (server: string, provider: unknown, cause = 'rejected') =>
            new HttpErrorResponse({ status: 502, error: { type: `/errors/mailbox-send/${cause}`, server, provider, detail: 'internal detail' } });
        expect(sendFailureText(refused('Microsoft Graph', { code: 'ErrorMessageSubmissionBlocked', message: 'Message submission is blocked.' })))
            .toBe('Microsoft refused the message: ErrorMessageSubmissionBlocked — Message submission is blocked. '
                + 'The Outlook account must be verified in Outlook on the web before it can send. The message was not sent.');
        expect(sendFailureText(refused('Gmail API', { code: 'invalidArgument', message: 'Invalid To header' })))
            .toBe('Google refused the message: invalidArgument — Invalid To header. The message was not sent.');
        expect(sendFailureText(refused('Microsoft Graph', { code: 'ErrorNonExistentMailbox', message: null })))
            .toContain('has no mailbox at Microsoft');
        // A 5xx (unknown) keeps the provider's words and says the outcome is not known; a 401 refused the sign-in.
        expect(sendFailureText(refused('Gmail API', { code: 'backendError', message: 'Backend Error' }, 'unknown')))
            .toBe('Google could not take the message: backendError — Backend Error. Whether the message went out is not known. '
                + 'Check the Sent folder before sending again.');
        expect(sendFailureText(refused('Microsoft Graph', { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' }, 'auth-refused')))
            .toBe('Microsoft refused the sign-in: InvalidAuthenticationToken — Access token has expired. The message was not sent.');
        // A 502 from before the provider member existed carries no key at all: read as no reason.
        expect(sendFailureText(new HttpErrorResponse({ status: 502, error: { type: '/errors/mailbox-send/rejected', server: 'Gmail API' } })))
            .toBe('Gmail API refused the message. It was not sent.');
        // No reason from the provider (SMTP, the network): the cause in our words, as before.
        expect(sendFailureText(refused('smtp.example.test', null, 'rejected'))).toBe('smtp.example.test refused the message. It was not sent.');
        expect(sendFailureText(refused('Gmail API', { code: ' ', message: '' }))).toBe('Gmail API refused the message. It was not sent.');
        expect(sendFailureText(refused('Microsoft Graph', { code: 'X', message: 'Y' }))).not.toContain('internal detail');
    });

    it('names the server where the problem does, and says "the server" where it does not', () => {
        const failed = (cause: string, server: string | null) => new HttpErrorResponse({ status: 502, error: { type: `/errors/mailbox-send/${cause}`, server } });
        expect(sendFailureText(failed('unreachable', 'smtp.office365.com'))).toBe('smtp.office365.com could not be reached. The message was not sent.');
        expect(sendFailureText(failed('rejected', 'Gmail API'))).toBe('Gmail API refused the message. It was not sent.');
        expect(sendFailureText(failed('api-unavailable', 'Microsoft Graph'))).toBe('Microsoft Graph cannot be used for this mailbox. The message was not sent.');
        expect(sendFailureText(failed('unknown', 'smtp.example.test'))).toContain('The send failed at smtp.example.test, and whether');
        expect(sendFailureText(failed('auth-refused', null))).toBe('The server refused the sign-in. The message was not sent.');
        expect(sendFailureText(failed('auth-refused', '  '))).toBe('The server refused the sign-in. The message was not sent.');
    });
});
