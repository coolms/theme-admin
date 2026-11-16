import { HttpErrorResponse } from '@angular/common/http';

/** What a declared problem says when the server gives no sentence for it (an older server). */
export const NOT_AVAILABLE = 'Not available right now';

/** What an undeclared fault or a network failure says: never its own text, which may carry internals. */
export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.';

/** The server's sentence, as given; null for none or a blank one. */
export function sentenceOf(text: unknown): string | null {
    return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** The problem body of an error answer, parsed when it came as text; null when it is not a plain JSON object. */
function problemOf(error: HttpErrorResponse): Record<string, unknown> | null {
    let body: unknown = error.error;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            return null;
        }
    }
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const prototype: unknown = Object.getPrototypeOf(body);
    return prototype === Object.prototype || prototype === null ? body as Record<string, unknown> : null;
}

/** A framework's own type for a server fault (`/errors/500`, `/errors/503`): its detail may be the exception's text. */
const FRAMEWORK_FAULT = /^\/errors\/5\d\d$/;

/**
 * The declared problem of a failure: its body when the type is set, not about:blank and not a framework's own type for
 * a server fault, else null.
 */
function declaredProblemOf(error: unknown): Record<string, unknown> | null {
    if (!(error instanceof HttpErrorResponse)) {
        return null;
    }
    const problem = problemOf(error);
    const type = problem?.['type'];
    return typeof type === 'string' && type.trim() !== '' && type !== 'about:blank' && !FRAMEWORK_FAULT.test(type) ? problem : null;
}

/** Whether a failure is the server's refusal (4xx), as opposed to a fault (5xx), a network failure or anything else. */
export function isRefusal(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status >= 400 && error.status <= 499;
}

/** The first field message of a validation refusal (422 with violations), whatever its type; null for anything else. */
function firstFieldMessageOf(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
        return null;
    }
    const violations = problemOf(error)?.['violations'];
    if (!Array.isArray(violations)) {
        return null;
    }
    for (const one of violations) {
        const message = typeof one === 'object' && one !== null ? sentenceOf((one as { message?: unknown }).message) : null;
        if (message !== null) {
            return message;
        }
    }
    return null;
}

/**
 * What a failed call says, in whose words the components contract sets: a validation refusal (422 with violations) its
 * first field's message, declared or not, never the top-level detail (a form shows each message next to its field
 * instead); a declared problem (a type other than about:blank) its `detail` as the server gives it, whatever the
 * status, or NOT_AVAILABLE when it gives none; an undeclared problem, a network failure or anything else
 * SOMETHING_WENT_WRONG, never its own text. The type is for behaviour only and never turned into words here. The
 * result is plain text.
 */
export function refusalWords(error: unknown): string {
    const field = firstFieldMessageOf(error);
    if (field !== null) {
        return field;
    }
    const problem = declaredProblemOf(error);
    if (problem === null) {
        return SOMETHING_WENT_WRONG;
    }
    return sentenceOf(problem['detail']) ?? NOT_AVAILABLE;
}
