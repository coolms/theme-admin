/** What a refusal says when the server gives no sentence for it (an older server). */
export const NOT_AVAILABLE = 'Not available right now';

/** What a server fault or a network failure says: never the fault's own text, which may carry internals. */
export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.';

/** The server's sentence, as given; null for none or a blank one. */
export function sentenceOf(text: unknown): string | null {
    return typeof text === 'string' && text.trim() !== '' ? text : null;
}
