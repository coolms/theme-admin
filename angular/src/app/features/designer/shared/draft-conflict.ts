import { HttpErrorResponse } from '@angular/common/http';

/**
 * How a draft moved on since a page read it: saved by someone else (the save naming the version read answered 412),
 * or deleted (404). Anything else is not a conflict, and the page reports it as a failed save.
 */
export type DraftConflict = 'changed' | 'deleted';

export function draftConflictOf(err: unknown): DraftConflict | null {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 412) return 'changed';
    if (status === 404) return 'deleted';
    return null;
}
