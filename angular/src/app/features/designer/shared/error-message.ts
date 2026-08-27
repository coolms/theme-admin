/**
 * UI-polish B2 — one best-effort error-message extractor for the designer
 * wrappers. Previously each of the four editor pages (BPMN / DMN-table /
 * DMN-DRD / state-machine) carried its own near-identical copy that drifted
 * in coverage: the narrowest only read `error.error`, while the DRD copy had
 * grown the full ladder. This is that superset, shared by all four.
 *
 * Resolution ladder (first non-empty wins):
 *   1. API-Platform problem+json `error.detail`
 *   2. The decision/deploy controllers' 422 shape `error.error` (a string)
 *   3. A plain-text `error` body
 *   4. `HttpErrorResponse.message`
 *   5. `HTTP <status>` when nothing else is present
 *   6. a native `Error.message`, else `String(err)`
 */
export function errorMessage(err: unknown): string {
    if (err !== null && typeof err === 'object') {
        const body = (err as { error?: unknown }).error;
        // API Platform problem+json `detail`.
        if (body !== null && typeof body === 'object' && 'detail' in body) {
            const detail = (body as { detail?: unknown }).detail;
            if (typeof detail === 'string' && detail !== '') return detail;
        }
        // The decision deploy controller's 422 shape: `{ error: "<message>" }`.
        if (body !== null && typeof body === 'object' && 'error' in body) {
            const inner = (body as { error?: unknown }).error;
            if (typeof inner === 'string' && inner !== '') return inner;
        }
        // Plain text error body.
        if (typeof body === 'string' && body !== '') return body;
        // HttpErrorResponse — surface its `.message` / status rather than [object Object].
        const message = (err as { message?: unknown }).message;
        if (typeof message === 'string' && message !== '') return message;
        const status = (err as { status?: unknown }).status;
        if (typeof status === 'number') return `HTTP ${status}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
}
