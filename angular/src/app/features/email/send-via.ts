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
 * Why a send or a reply failed (a 502 whose type names the cause), in the page's words, never the server's detail;
 * naming the server where the problem does (its `server`: the SMTP host, or the API, e.g. Gmail API).
 */
export function sendFailureText(error: unknown): string {
    const problem = error instanceof HttpErrorResponse ? (error.error as { type?: unknown; server?: unknown } | null) : null;
    const type = problem?.type;
    const cause = typeof type === 'string' && type.includes('/errors/mailbox-send/') ? type.slice(type.lastIndexOf('/') + 1) : null;
    const named = typeof problem?.server === 'string' && problem.server.trim() !== '' ? problem.server : null;
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
