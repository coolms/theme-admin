import { HttpErrorResponse } from '@angular/common/http';

/** What a refusal says when the server gives no sentence for it (an older server). */
export const NOT_AVAILABLE = 'Not available right now';

/** What a server fault or a network failure says: never the fault's own text, which may carry internals. */
export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.';

/** The server's sentence, as given; null for none or a blank one. */
export function sentenceOf(text: unknown): string | null {
    return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** The problem body of an error answer, parsed when it came as text; null when it is not an object. */
function problemOf(error: HttpErrorResponse): Record<string, unknown> | null {
    let body: unknown = error.error;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            return null;
        }
    }
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
}

/** Whether a failure is the server's refusal (4xx), as opposed to a fault (5xx), a network failure or anything else. */
export function isRefusal(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status >= 400 && error.status <= 499;
}

/**
 * What a failed call says, in whose words the components contract sets: a refusal (4xx) its `detail` as the server
 * gives it, or NOT_AVAILABLE when it gives none; a validation refusal without a detail its first field's message; a
 * server fault (5xx), a network failure or anything else SOMETHING_WENT_WRONG, never the fault's own text. The
 * problem's type is for behaviour only and never turned into words here.
 */
export function refusalWords(error: unknown): string {
    if (!isRefusal(error)) {
        return SOMETHING_WENT_WRONG;
    }
    const problem = problemOf(error as HttpErrorResponse);
    const detail = sentenceOf(problem?.['detail']);
    if (detail !== null) {
        return detail;
    }
    const violations = problem?.['violations'];
    if (Array.isArray(violations)) {
        for (const one of violations) {
            const message = typeof one === 'object' && one !== null ? sentenceOf((one as { message?: unknown }).message) : null;
            if (message !== null) {
                return message;
            }
        }
    }
    return NOT_AVAILABLE;
}
