import { HttpErrorResponse } from '@angular/common/http';

/**
 * Detect the typed `ContributorSourceHasNoDraftException` response: HTTP
 * 409 with the `X-CoolMS-Workflow-Source: contributor` response header.
 * Other 409s (e.g. NotForkable, NotRevertible) come back without that
 * header. The header is the canonical signal because the message string
 * is locale + audience-dependent and shouldn't be string-matched.
 *
 * Shared by the BPMN designer page + its modal-dialog twin so both render
 * the same "shipped by module" banner (instead of one dumping the raw
 * error into a generic alert behind a mounted editor).
 */
export function isContributorSource409(err: unknown): boolean {
    if (!(err instanceof HttpErrorResponse) || err.status !== 409) {
        return false;
    }
    // Header lookup is case-insensitive per HttpHeaders contract.
    return err.headers.get('X-CoolMS-Workflow-Source') === 'contributor';
}

/**
 * The deployed version number carried alongside a contributor-source
 * 409, or `null` when the definition has none deployed.
 *
 * Lets the Designer offer a READ-ONLY VIEW of a module-shipped body
 * instead of making "Fork to VFS or nothing" the only path — the
 * deployed body is already served by
 * `GET /workflows/{key}/versions/{n}` (whose loader router handles
 * contributor-source), so viewing never requires taking local
 * ownership. Read from the header for the same reason the source flag
 * is: the message text is not a contract.
 */
export function contributorSourceVersion(err: unknown): number | null {
    if (!isContributorSource409(err)) {
        return null;
    }
    const raw = (err as HttpErrorResponse).headers.get('X-CoolMS-Workflow-Version');
    if (raw === null) {
        return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
