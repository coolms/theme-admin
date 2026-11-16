import { HttpErrorResponse } from '@angular/common/http';
import { type TagOption } from '@coolms/ui-angular';
import {
    type EmailComposeDto, type EmailComposeMode, type EmailComposePartDto, type EmailComposeRecipientDto, type EmailMessagePartRef,
    type OutgoingEmailRequest,
} from './email.types';
import { isRefusal, refusalWords, sentenceOf } from './server-words';

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
 * Why the composer could not be prepared, in the words `refusalWords` gives; a refusal (4xx) offers no Retry, anything
 * else may pass and offers Retry.
 */
export function prefillFailure(err: unknown, _mode: EmailComposeMode): { sentence: string; retry: boolean } {
    return { sentence: refusalWords(err), retry: !isRefusal(err) };
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

/** Said when the prefill had no quote because the original could not be read: with the server's sentence, as given. */
export function unreadableSentence(sentence: string | null | undefined): string {
    const said = sentenceOf(sentence);
    return said === null ? 'The original is not quoted.' : `The original is not quoted: ${said}`;
}

/** Said when a send was refused because the message to quote could no longer be read: nothing went. */
export const QUOTE_REFUSED_SENTENCE = 'The original could no longer be read, so the message was not sent. You can send it without the quote.';

/** Whether a send's refusal says the message to quote or forward could no longer be read. */
export function quotedMessageUnavailable(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
        return false;
    }
    const type = (error.error as { type?: unknown } | null)?.type;

    return typeof type === 'string' && type.endsWith('/errors/email/quoted-message-unavailable');
}

/** A forward's own files: the parts of the original that are not drawn inside the quote. */
export function forwardFiles(parts: readonly EmailComposePartDto[]): EmailComposePartDto[] {
    return parts.filter(p => !p.inline);
}

/**
 * What an answer or a forward adds to the request, besides the person's own text and recipients: the quote choice,
 * always stated (the server appends the original only on a reply's `quote: true`, and leaves a forward's out only on
 * `quote: false`), and for a forward the message it forwards and the files kept from it. With no quote served (the
 * original could not be read) there is nothing to quote. A new message adds nothing.
 */
export function quoteFields(
    mode: 'compose' | EmailComposeMode,
    messageId: string | null,
    quoteServed: boolean,
    quoteKept: boolean,
    files: readonly EmailMessagePartRef[],
): Pick<OutgoingEmailRequest, 'quote' | 'forwardOf' | 'messageParts'> {
    if (mode === 'compose' || messageId === null) {
        return {};
    }
    const quote = quoteServed && quoteKept;
    if (mode !== 'forward') {
        return { quote };
    }
    const fields: Pick<OutgoingEmailRequest, 'quote' | 'forwardOf' | 'messageParts'> = { forwardOf: messageId, quote };
    if (files.length > 0) {
        fields.messageParts = files.map(f => ({ messageId: f.messageId, part: f.part }));
    }

    return fields;
}

/** The sentence said in place of Send for a reader who may not send from this mailbox. */
export const NO_SEND_SENTENCE = 'You may read this mailbox but not send from it, so this cannot be sent from here.';
