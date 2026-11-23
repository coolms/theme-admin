import { HttpErrorResponse } from '@angular/common/http';

/** The problem a paged list answers for a page link it can no longer honour: read the list again from its first page. */
export const PAGE_LINK_INVALID = '/errors/page-link-invalid';

/** Whether a refusal is that problem: its type, at 409 only. Any other refusal is a failure. */
export function isPageLinkInvalid(err: unknown): boolean {
    if (!(err instanceof HttpErrorResponse) || 409 !== err.status) return false;
    const type = (err.error as { type?: unknown } | null)?.type;

    return typeof type === 'string' && type.endsWith(PAGE_LINK_INVALID);
}
