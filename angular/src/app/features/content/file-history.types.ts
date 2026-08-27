/**
 * Wire shapes for the VFS file-history API (ADR-132 W6.3). The backend returns
 * JSON-LD, so each object also carries `@id`/`@type`/`@context` keys we ignore.
 *
 * Note: the serializer OMITS null-valued properties, so `id` on the "current"
 * diff ref and the `oldNumber`/`newNumber` on insert/delete diff lines arrive
 * absent rather than null — every nullable field below is therefore optional.
 */

/** One row of the revision log. */
export interface FileRevisionView {
    readonly id:          string;
    readonly contentHash: string;
    readonly shortHash:   string;
    readonly authorUid?:  string | null;
    readonly authorName?: string | null;
    readonly message?:    string | null;
    readonly createdAt:   string;
    readonly isCurrent:   boolean;
}

/** GET /vfs/files/revisions — newest-first log + the caller's restore gate. */
export interface FileRevisionLog {
    readonly path:      string;
    readonly revisions: FileRevisionView[];
    /** Whether the caller may restore (write permission on the live file). */
    readonly canWrite:  boolean;
}

/** GET /vfs/files/revisions/content — one revision's stored body. */
export interface FileRevisionContent {
    readonly content:     string;
    readonly revisionId?: string | null;
}

/** One side of a diff; `id` is absent for the live "current" side. */
export interface FileRevisionRef {
    readonly id?:         string | null;
    readonly shortHash?:  string | null;
    readonly authorUid?:  string | null;
    readonly authorName?: string | null;
    readonly message?:    string | null;
    readonly createdAt:   string;
    readonly isCurrent:   boolean;
}

/** One line of a diff. `oldNumber`/`newNumber` are absent on the side the line is missing from. */
export interface FileDiffLine {
    readonly op:         'equal' | 'insert' | 'delete';
    readonly oldNumber?: number | null;
    readonly newNumber?: number | null;
    readonly content:    string;
}

/** GET /vfs/files/revisions/diff — line-level diff of two points in history. */
export interface FileRevisionDiff {
    readonly path:    string;
    readonly from:    FileRevisionRef | null;
    readonly to:      FileRevisionRef | null;
    readonly added:   number;
    readonly removed: number;
    readonly lines:   FileDiffLine[];
}

/** One attributed line of the current content. */
export interface FileBlameLine {
    readonly lineNumber:  number;
    readonly content:     string;
    readonly revisionId?: string | null;
    readonly shortHash?:  string | null;
    readonly authorUid?:  string | null;
    readonly authorName?: string | null;
    readonly message?:    string | null;
    readonly createdAt:   string;
}

/** GET /vfs/files/revisions/blame — per-line attribution of the current content. */
export interface FileBlame {
    readonly path:  string;
    readonly lines: FileBlameLine[];
}
