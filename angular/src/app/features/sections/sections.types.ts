// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Section (manifest.sections.*) and Web's sites (/web/sites), managed on the same page endpoints, verbatim.

// --- SiteSection DTOs --------------------------------------------------------

export interface SiteSectionDto {
    '@id':       string;
    id:          string | null;
    slug:        string | null;
    label:       string;
    matchHost?:  string | null;
    matchPathPrefix?: string | null;
    feStack?:    string | null;
    matchPriority?: number | null;
    /** Soft ref to Theme slug -- exposed so the Navi-node picker can scope dtmpl templates. */
    themeSlug?:  string | null;
    isActive:    boolean;
}

export interface CreateSectionDto {
    slug:            string;
    label:           string;
    feStack:         string;
    matchHost?:      string;
    matchPathPrefix?: string;
    matchPriority?:  number;
    /**
     * !! Was missing here while `UpdateSectionDto` had it, so a site created
     * from the admin was born with NO theme binding and had to be edited
     * immediately to get one. `CreateSiteSectionProcessor` has always read
     * `themeSlug` off the resource -- the omission was only on this side.
     */
    themeSlug?:      string | null;
}

export interface UpdateSectionDto {
    label?:          string;
    matchHost?:      string;
    matchPathPrefix?: string;
    feStack?:        string;
    matchPriority?:  number;
    /**
     * THE authoritative theme binding. A section naming a theme resolves
     * to it directly via `ThemeSubscriber`'s fast-path, so this -- not the Themes
     * page's Activate -- decides a site's theme. `null` clears it, falling back to
     * whichever theme is active; `undefined` leaves it unchanged (merge-patch).
     */
    themeSlug?:      string | null;
}

/**
 * Response shape from POST /api/v1/sections/_apply.
 * Mirrors backend `SiteSectionApplyResource`.
 */
export interface SectionApplyResultDto {
    readonly created:       ReadonlyArray<string>;
    readonly updated:       ReadonlyArray<string>;
    readonly unchanged:     ReadonlyArray<string>;
    readonly skipped:       ReadonlyArray<string>;
    /**
     * !! Vhosts DELETED because no section owns them any more. The backend
     * computed this all along and the API resource dropped it, so the admin's
     * Apply could delete a server block and report only what it wrote -- the
     * one outcome an operator cannot infer from the section list.
     */
    readonly removed?:      ReadonlyArray<string>;
    /** Why each skip happened, keyed by slug. "skipped" alone reads as a failure. */
    readonly skippedReasons?: Readonly<Record<string, string>>;
    readonly outputDir:     string;
    readonly reloadCommand: string;
    readonly dryRun:        boolean;
}

// --- Web / Site composition DTOs ( Layer 3a/3b/3c) --------------------
//
// These mirror the backend `SiteResource` + `SiteMemberCollectionResource`
// shapes (see `src/Web/Infrastructure/ApiPlatform/Resource/`). The Site
// Detail page (Layer 3d.1) is the only FE consumer today; the Routing
// Inspector + full Members management page land in Layer 3d.2 / 3d.3.

/** Per-section navi tree reference embedded inline on the Site Detail. */
export interface SiteNaviTreeRefDto {
    readonly treeId: string;
    readonly slug:   string;
    readonly label:  string;
}

/** VFS Node descriptor for the `/content/{slug}` site root. */
export interface SiteContentRootRefDto {
    readonly nodeId:        string;
    readonly path:          string;
    readonly ownerId:       string | null;
    readonly editorGroupId: string | null;
    readonly modeInt:       number;
}

/** Calling user's resolved per-section capability set. */
export interface SiteMembershipDto {
    readonly sectionId:       string;
    readonly sectionSlug:     string;
    readonly userId:          string | null;
    readonly isOwner:         boolean;
    readonly isEditor:        boolean;
    readonly isAdministrator: boolean;
    readonly canRead:         boolean;
    readonly canEdit:         boolean;
    readonly canAdminister:   boolean;
    readonly roles:           ReadonlyArray<string>;
}

/**
 * Composed Site view (Section + per-section NaviTrees + VFS root +
 * current user membership). One row per SiteSection, fetched via
 * `GET /api/v1/web/sites` (list) or `GET /api/v1/web/sites/{slug}`.
 */
export interface SiteDto {
    readonly sectionId:             string | null;
    readonly slug:                  string | null;
    readonly label:                 string | null;
    readonly host:                  string | null;
    readonly pathPrefix:            string | null;
    readonly priority:              number | null;
    readonly themeSlug:             string | null;
    readonly defaultLocale:         string | null;
    readonly feStack:               string | null;
    readonly isActive:              boolean | null;
    readonly naviTrees:             ReadonlyArray<SiteNaviTreeRefDto>;
    readonly contentRoot:           SiteContentRootRefDto | null;
    readonly currentUserMembership: SiteMembershipDto | null;
}

/** Single row in `GET /api/v1/web/sites/{slug}/members`. */
export interface SiteMemberDto {
    readonly userId:   string;
    readonly username: string;
    readonly email:    string | null;
    readonly isOwner:  boolean;
    readonly isEditor: boolean;
}
