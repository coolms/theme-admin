/**
 * Phase A.1a — pure helpers shared by the instances browser. The
 * file zone displays per-instance Location and Filename derived from
 * the entity's `vfsPath`; both transforms live here so the UI never
 * does string-mangling inline.
 */

/**
 * Parent folder of a VFS path, with the personal-zone prefix
 * (`/home/{userId}`) collapsed to `~`. Always trailing-slashed for
 * visual clarity in the Location column.
 *
 *   /docs/contract.pdf                 → /docs/
 *   /docs/contracts/2026/Q1/nda.docx   → /docs/contracts/2026/Q1/
 *   /home/abc-123/docs/inbox/inv.pdf   → ~/docs/inbox/
 *   /file.pdf                          → /
 *   ''                                 → /
 */
export function formatLocation(vfsPath: string | null | undefined): string {
    if (!vfsPath) {
        return '/';
    }
    const segments = vfsPath.split('/');
    segments.pop();
    let path = segments.join('/');
    if ('' === path) {
        path = '/';
    }
    path = path.replace(/^\/home\/[^/]+/, '~');

    return path.endsWith('/') ? path : path + '/';
}

/**
 * Filename portion of a VFS path. Falls back to the supplied default
 * when the path is missing — pending instances may not have a path
 * pinned yet, in which case the caller passes a stable id-derived
 * label.
 */
export function filenameOf(vfsPath: string | null | undefined, fallback: string): string {
    if (!vfsPath) {
        return fallback;
    }
    const last = vfsPath.split('/').pop();
    return last && '' !== last ? last : fallback;
}

/**
 * Phase A.1b — human-readable byte size for the instance properties
 * panel. Returns `'—'` for null/undefined/0 (the entity doesn't expose
 * size today; pending rows have nothing to measure either). Decimal
 * formatting matches Media's status-bar convention (1 KB = 1024 B).
 */
export function formatSize(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || bytes === 0) {
        return '—';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
