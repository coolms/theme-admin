import { HttpErrorResponse } from '@angular/common/http';
import { type TagOption } from '@coolms/ui-angular';
import { type EmailComposeDto, type EmailComposeMode, type EmailComposeRecipientDto } from './email.types';

/** The message actions that open a composer the server prepares, and the mode each asks it for. */
export const PREFILLED_ACTIONS: Readonly<Record<string, EmailComposeMode>> = {
    'reply': 'reply',
    'reply-all': 'reply_all',
    'forward': 'forward',
};

/** Where a prepared composer is: being read, read, or not read and why. */
export type ComposePrefillState =
    | { readonly state: 'loading' }
    | { readonly state: 'ready'; readonly answer: EmailComposeDto }
    | { readonly state: 'failed'; readonly sentence: string; readonly retry: boolean };

/** What the composer says while the server prepares it. */
export function preparingSentence(mode: EmailComposeMode): string {
    return mode === 'forward' ? 'Preparing the forward…' : 'Preparing the reply…';
}

/**
 * Why the composer could not be prepared, in the page's words: a 404 is a message not there to read, a 422 a way of
 * answering the server does not take; anything else may pass, and offers Retry.
 */
export function prefillFailure(err: unknown, mode: EmailComposeMode): { sentence: string; retry: boolean } {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 404) {
        return { sentence: 'This message is not there to answer: it was removed, or you may no longer read it.', retry: false };
    }
    if (status === 422) {
        return { sentence: 'The server does not prepare a message this way, so nothing was filled in.', retry: false };
    }

    return {
        sentence: mode === 'forward' ? 'The forward could not be prepared.' : 'The reply could not be prepared.',
        retry: true,
    };
}

/** The served recipients as the address chips hold them, in the order served. */
export function addressesOf(list: readonly EmailComposeRecipientDto[]): string[] {
    return list.map(r => r.address);
}

/** A chip's label for each served recipient that has a name: "Name <address>"; a bare address shows as itself. */
export function recipientOptionsOf(list: readonly EmailComposeRecipientDto[]): TagOption[] {
    return list
        .filter(r => (r.name ?? '').trim() !== '')
        .map(r => ({ value: r.address, label: `${(r.name ?? '').trim()} <${r.address}>` }));
}

/** The sentence said when the prefill had no quote because the message could not be read. */
export function unreadableSentence(reason: string): string {
    return `The original is not quoted: ${reason}.`;
}

/** The sentence said in place of Send for a reader who may not send from this mailbox. */
export const NO_SEND_SENTENCE = 'You may read this mailbox but not send from it, so this cannot be sent from here.';

/** Said under a forward's quote: the forwarded message is shown, and not sent with the person's own part yet. */
export const FORWARD_UNSENT_SENTENCE = 'The forwarded message is shown here only. It is not sent with yours yet.';
