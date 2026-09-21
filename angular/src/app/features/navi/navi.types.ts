// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Navi (manifest.navi.*) endpoints, verbatim.

// --- NaviTree / NaviNode DTOs ------------------------------------------------

export interface NaviTreeDto {
    '@id':     string;
    id:        string;
    slug:      string;
    label:     string;
    isActive:  boolean;
    /**
     * Owning SiteSection's UUID for `navi.public.*` trees.
     * NULL for admin / toolbar / context trees.
     */
    siteSectionId?:    string | null;
    /** Section's slug (e.g. `default`); NULL when `siteSectionId` is NULL. */
    siteSectionSlug?:  string | null;
    /** Section's human label (e.g. `Main Site`); NULL when `siteSectionId` is NULL. */
    siteSectionLabel?: string | null;
}

export interface CreateNaviTreeDto {
    /**
     * Required unless `siteSectionId` is provided; the processor then
     * auto-derives `navi.public.{section.slug}` from the section.
     */
    slug?: string;
    label: string;
    /**
     * Optional. When provided, the new tree is anchored to that SiteSection
     * via NaviTree::$siteSectionId (Layer 1). Backend
     * validates the section exists -- 422 if not.
     */
    siteSectionId?: string;
}

export interface UpdateNaviTreeDto {
    label?: string;
}

export interface NaviNodeDto {
    '@id':      string;
    id:         string;
    slug:       string;
    path:       string;
    title:      string;
    sortOrder:  number;
    isVisible:  boolean;
    isActive:   boolean;
    parentId?:  string | null;
    treeSlug:   string;
    template?: string | null;
    /**
     * Tree datagrid Ship B -- true when this node has at least one direct
     * child; drives the datagrid chevron under the `computed` strategy.
     */
    hasChildren?: boolean;
    /**
     * Tree datagrid Ship B -- `'group'` (has children, expandable) or
     * `'leaf'`. Mirrors the backend `NaviNodeResource::$nodeType`.
     */
    nodeType?:    'group' | 'leaf';
}

export interface CreateNaviNodeDto {
    treeSlug:          string;
    slug:              string;
    title:             string;
    path:              string;   // full path, e.g. "/about" — required by CreateNaviNodeProcessor
    parentId?:         string | null;
    template?: string | null;
    isVisible?:        boolean;
    sortOrder?:        number;
}

export interface UpdateNaviNodeDto {
    title?:            string;
    template?: string | null;
    isVisible?:        boolean;
    sortOrder?:        number;
}
