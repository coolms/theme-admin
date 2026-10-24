import { HttpErrorResponse } from '@angular/common/http';
import { type SendApi, type SendVia } from './email.types';

/** A read that carries no sendApi says nothing about it: not known, as `available: null`. */
const UNKNOWN: SendApi = { available: null, name: null, reason: null };
const known = (api: SendApi | null | undefined): SendApi => api ?? UNKNOWN;

/** The API's name in a sentence: the server's, or a plain one where it names none. */
const apiName = (api: SendApi): string => api.name ?? 'the provider\'s API';

/** Why the API cannot be used for this mailbox, in words, with what can be done about it; null when it can. */
export function sendApiWhyNot(read?: SendApi | null): string | null {
    const api = known(read);
    if (api.available !== false) return null;
    switch (api.reason) {
        case 'not_enabled':
            // Switched off on the installation's own OAuth app, outside CoolMS: nothing here to link to.
            return `Your administrator has not enabled sending through ${apiName(api)} for this installation.`;
        case 'no_consent':
            return `Reconnect this mailbox to allow sending through ${apiName(api)}.`;
        default:
            return 'This mail server has no sending API; mail goes by SMTP.';
    }
}

/** The choices, as the select shows them: API only where it may be chosen (or is already the choice). */
export function sendViaChoices(read: SendApi | null | undefined, current: SendVia): { value: SendVia; label: string; disabled: boolean }[] {
    const api = known(read);
    return [
        { value: 'auto', label: 'Auto', disabled: false },
        { value: 'api', label: api.name === null ? 'API' : `API (${api.name})`, disabled: api.available === false && current !== 'api' },
        { value: 'smtp', label: 'SMTP', disabled: false },
    ];
}

/** What the chosen way does for this mailbox, in a sentence. Not learned yet is said, never taken for yes. */
export function sendViaHint(via: SendVia, read?: SendApi | null): string {
    const api = known(read);
    const name = apiName(api);
    switch (via) {
        case 'smtp':
            return 'Mail goes by SMTP only.';
        case 'api':
            return api.available === false
                ? `Mail goes through ${name} only, which cannot be used now: ${sendApiWhyNot(api)}`
                : `Mail goes through ${name} only. A send it does not take fails; it never goes by SMTP instead.`;
        case 'auto':
            if (api.available === false) return `Mail goes by SMTP. ${sendApiWhyNot(api)}`;
            if (api.available === null) return `Mail goes through ${name} if it can be used -- not checked yet; the first send finds out -- else by SMTP.`;
            return `Mail goes through ${name}, or by SMTP if ${name} cannot be used for this mailbox. A message refused one way is never sent the other.`;
    }
}

/**
 * Why a send or a reply failed (a 502 whose type names the cause), naming the server where the problem does (its
 * `server`: the SMTP host, or the API, e.g. Gmail API). Where the provider gave its own reason (`provider`: an API's
 * code and message), that is shown as the provider's words, with a plain hint for the codes that need one (decided
 * 2026-10-25); otherwise the cause in the page's words. The server's `detail` is never shown.
 */
export function sendFailureText(error: unknown): string {
    const problem = error instanceof HttpErrorResponse
        ? (error.error as { type?: unknown; server?: unknown; provider?: unknown } | null)
        : null;
    const type = problem?.type;
    const cause = typeof type === 'string' && type.includes('/errors/mailbox-send/') ? type.slice(type.lastIndexOf('/') + 1) : null;
    const named = typeof problem?.server === 'string' && problem.server.trim() !== '' ? problem.server : null;
    const reason = providerReason(problem);
    if (reason === null) {
        return causeText(cause, named);
    }
    // The provider's own reason, as its words: "Microsoft refused the message: <code> -- <message>".
    const who = (named !== null ? PROVIDER[named] ?? named : null) ?? 'The provider';
    const said = [reason.code, reason.message].filter((part): part is string => part !== null).join(' — ');
    const hint = reason.code !== null ? PROVIDER_HINTS[reason.code] : undefined;
    const outcome = cause === 'unknown' || cause === null
        ? 'Whether the message went out is not known. Check the Sent folder before sending again.'
        : 'The message was not sent.';
    return [sentence(`${who} refused the message: ${said}`), hint, outcome].filter(part => part !== undefined).join(' ');
}

/** Who speaks for an API, in a sentence: the company, not the API's name. */
const PROVIDER: Readonly<Record<string, string>> = { 'Microsoft Graph': 'Microsoft', 'Gmail API': 'Google' };

/** A plain hint beside a provider's code that is known to puzzle people; the provider's own words are still shown. */
const PROVIDER_HINTS: Readonly<Record<string, string>> = {
    // Decided 2026-10-25: a new Outlook account cannot send through Graph until it is verified on the web.
    ErrorMessageSubmissionBlocked: 'The Outlook account must be verified in Outlook on the web before it can send.',
    // Measured on the test mailbox: sending to the account's own Microsoft sign-in name ends here too.
    ErrorNonExistentMailbox: 'The address has no mailbox at Microsoft; sending to the account\'s own Microsoft sign-in name ends here too.',
    dailyLimitExceeded: 'This Gmail account has reached its daily sending limit. Try again tomorrow.',
};

/** Ends a sentence that does not end itself (a provider's message may or may not). */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

/** The provider's own reason (an API's code and message), as the problem carries it; null where it gave none. */
function providerReason(problem: { provider?: unknown } | null): { code: string | null; message: string | null } | null {
    const p = problem?.provider as { code?: unknown; message?: unknown } | null | undefined;
    const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const code = text(p?.code);
    const message = text(p?.message);
    return code === null && message === null ? null : { code, message };
}

/** The cause alone, where the provider said nothing of its own (SMTP, the network). */
function causeText(cause: string | null, named: string | null): string {
    const server = named ?? 'The server';
    switch (cause) {
        case 'unreachable':
            // Never handed over: the server reads silence after the message was handed over as `unknown`.
            return `${server} could not be reached. The message was not sent.`;
        case 'auth-refused':
            return `${server} refused the sign-in. The message was not sent.`;
        case 'reauth-required':
            return 'Connect this mailbox again to send. The message was not sent.';
        case 'recipient-rejected':
            return `${server} refused a recipient. The message was not sent.`;
        case 'rejected':
            return `${server} refused the message. It was not sent.`;
        case 'api-unavailable':
            return `${named ?? 'The sending API'} cannot be used for this mailbox. The message was not sent.`;
        default:
            // Unknown: whether it went out is not known either.
            return 'The send failed' + (named === null ? '' : ' at ' + named)
                + ', and whether the message went out is not known. Check the Sent folder before sending again.';
    }
}
