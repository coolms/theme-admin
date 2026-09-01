/**
 * Page DTOs after Content Ship 3b -- the Page + PageVariant entities are
 * gone. The frontend now talks directly to the VFS node endpoints; these
 * types model the shape the page UI consumes after lifting from a VFS Node.
 *
 *  - `PageDto`           -- derived from a Container Node (mime
 *                          `application/vnd.coolms.page`).
 *  - `PageVariantDto`    -- derived from a `text/x-dtmpl` child Node of
 *                          such a Container.
 *  - `PageVariantSummary` -- thin summary used by the pages list grid.
 */
/**
 * A page kind offered by `GET /content/page-types` ( step (b), ).
 *
 * `key` is what gets stored as the Package's `contentType`; `template` is the
 * theme file it renders with, derived server-side by the same convention the
 * SSR resolver applies — shown so the choice has a visible consequence rather
 * than being an opaque label.
 */
export interface PageTypeDto {
    key: string;
    label: string;
    template: string;
}

/**
 * A surface a page can be placed on (`GET /content/pages/surfaces`, ).
 */
export interface PageSurfaceDto {
    key: string;
    label: string;
    relativePath: string;
}

/**
 * One place a page currently appears ( step (c), ).
 *
 * DERIVED from the symlink that exists — there is no stored "published to"
 * flag — so this list is always what the VFS actually holds.
 *
 * Distinct from a variant's `status`: *placed* is WHERE the page appears,
 * *published* is WHICH locale is live. A page can be one without the other.
 */
export interface PagePlacementDto {
    siteSlug: string;
    surfaceKey: string;
    linkPath: string;
}

export interface PageVariantSummaryDto {
    locale: string;
    status: 'draft' | 'in_review' | 'changes_requested' | 'published' | 'archived';
    /** Per-locale `Node.title`; absent when the variant has none. */
    title?: string | null;
    /**
     * Per-locale share image. SEO is per-VARIANT on this model, so
     * this is the honest home for it; `PageDto.ogImage` is only the derived
     * "which one does the tile show" answer.
     */
    ogImage?: string | null;
    /**
     * Whether the SITE currently publishes this locale.
     *
     * False means the translation exists and is not being served -- and the row
     * is still listed on purpose. Hiding it is what makes an editor believe
     * hundreds of translations were deleted, which is the fear the reversible
     * design exists to remove.
     *
     * Optional because a response from before the field existed, or from an
     * install without I18nBundle, simply omits it; absent reads as served,
     * which is the honest answer when nothing has an opinion.
     */
    served?: boolean;
}

export interface PageDto {
    /** Container Node UUID. */
    id: string;
    /** Container `extras.slug` (or filename basename when unset). */
    slug: string;
    /** Container Node materialized path (e.g. `/about.html`). */
    vfsPath: string | null;
    /** Container `extras.sectionSlug`. */
    sectionSlug: string | null;
    variants: PageVariantSummaryDto[];
    createdAt: string;
    /**
     * Tree-mode fields populated by the backend Pages provider.
     *  - `parentId`     -- null when the row is a root of the Pages tree.
     *  - `nodeType`     -- 'directory' (expandable) or 'package' (leaf-like).
     *  - `hasChildren`  -- optimistic chevron driver (true for directories).
     *  - `ancestorIds`  -- ancestor Node UUIDs; populated when the request
     *                     carried an RQL filter OR a `?q=` typeahead search.
     *                     Used by the grid to expand-to-match (auto-expand the
     *                     ancestor chain and surface each match nested in place).
     */
    parentId?: string | null;
    nodeType?: 'directory' | 'package';
    hasChildren?: boolean;
    ancestorIds?: string[];
    /**
     * Whether the enclosing content collection requires editorial review
     * (W6.c). Populated by the backend only on single-page reads (`?id=` /
     * `?path=`); drives whether the editor shows "Submit for review".
     * `undefined`/`false` -> publish directly (no review flow).
     */
    requiresReview?: boolean;
    /**
     * The page's own content-type discriminator — the Container's
     * `extras.contentType` (e.g. `'landing'`), the same node extra the block
     * editor and SSR template-resolver key on. Populated by the backend on
     * every Pages projection (a cheap extras read). Lets the editor decide the
     * landing-vs-prose canvas *synchronously* at open, so a landing page mounts
     * the block canvas directly instead of briefly mounting then tearing down
     * the prose `<coolms-editor>`. `undefined`/`null` -> a plain prose page.
     */
    contentType?: string | null;
    /**
     * True once the slug is FROZEN — the page/article has been published (a
     * variant went live, or the article was linked into a surface), so the
     * backend set its `extras.slugLocked` ([]). The editor uses it to warn
     * before a rename (renaming a frozen slug changes the live URL and needs the
     * `force` flag). `undefined`/`false` -> not yet published, slug freely
     * renameable. Populated on the single-page reads (`?id=`/`?path=`).
     */
    slugLocked?: boolean;
    /**
     * Share image for the explorer tile — DERIVED by the backend from
     * the variants (published wins, else the first that has one), not a field
     * of its own on the Package.
     *
     * Null/absent means no variant sets one; the tile draws a placeholder
     * rather than a broken image.
     */
    ogImage?: string | null;
    /**
     * Surfaces this page is currently placed on. Empty/absent means
     * the page is reachable only at its own URL.
     */
    placements?: PagePlacementDto[];
}

export interface PageVariantDto {
    /** Variant Node UUID. */
    id: string;
    /** Parent Container Node UUID (Page identity). */
    pageId: string;
    /** Filename basename of the variant Node (e.g. `en` for `en.dtmpl`). */
    locale: string;
    status: 'draft' | 'in_review' | 'changes_requested' | 'published' | 'archived';
    title?: string;
    metaTitle?: string;
    metaDesc?: string;
    ogImage?: string;
    template?: string;
    createdAt?: string;
    updatedAt?: string;
    /**
     * Editorial review audit (W6.a/W6.c), read from the variant Node's extras.
     * `reviewNote` is the reviewer's feedback shown to the author when the
     * variant is bounced back (`status === 'changes_requested'`); `reviewedAt`
     * timestamps it. (`reviewedBy` is a user UUID today — name resolution is a
     * separate follow-up.)
     */
    reviewNote?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    /**
     * Scheduled publish/unpublish times (W6.d), read from the variant Node's
     * extras. ISO-8601 strings (or absent when nothing is scheduled). Set via
     * `PageService.scheduleVariant`; the Scheduler clears the matching marker
     * once it fires.
     */
    publishAt?: string;
    unpublishAt?: string;
    /**
     * The variant Node's raw `extras` map. Surfaced so the page editor can read
     * arbitrary declared SEO-group field values per locale (W1.d.2 dynamic-SEO
     * consolidation), instead of only the flattened metaTitle/metaDesc. The
     * dedicated metaTitle/metaDesc/ogImage fields above remain for existing
     * readers; this is the generic source for the declaration-driven Meta panel.
     */
    extras?: Record<string, unknown>;

}
