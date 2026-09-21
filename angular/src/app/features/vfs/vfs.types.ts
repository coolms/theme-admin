// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the VFS (/vfs/*) endpoints, verbatim.

// --- VFS Node DTOs -----------------------------------------------------------

export interface NodeDto {
    '@id':         string;
    id:            string;
    name:          string;
    type:          string;   // 'file' | 'directory' | 'resource' | 'package'
    path:          string;
    mode:          string;   // e.g. '0644'
    modeString:    string;   // e.g. 'rw-r--r--'
    size:          number;
    humanSize:     string;
    mimeType:      string | null;
    extension:     string | null;
    uid:           string;
    gid:           string;
    createdAt:     string;
    updatedAt:     string;
    /** Display title (real Node column; admin-facing). Distinct from `pageTitle` which is SSR <title> override. */
    title?:        string | null;
    /** Free-text description (real Node column). */
    description?:  string | null;
    /** Module-owned per-node metadata bag (e.g., Content writes `status`, `metaTitle`, `metaDesc`, `ogImage`). */
    extras?:       Record<string, unknown>;
    template?: string | null;
    pageTitle?:    string | null;
    /** For resource nodes: { route, routeParams? } */
    pageMeta?:     Record<string, unknown>;
    isRendered?:   boolean;
}

export interface ChmodDto {
    path: string;
    mode: string;  // octal string, e.g. '0644'
}

export interface ChownDto {
    path: string;
    uid:  string;
    gid:  string;
}
