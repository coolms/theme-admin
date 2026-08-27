import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable, of, switchMap, throwError } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, resolvePattern } from '@coolms/core-angular';
import { ApiService, HydraCollection, NodeDto } from '../../api/api.service';
import { SpaceDto } from '@coolms/ui-angular';
import { PageDto, PageSurfaceDto, PageTypeDto, PageVariantDto, PageVariantSummaryDto } from './page.types';

/**
 * Page editor data layer after Content Ship 3b.
 *
 *  - Page list                 -> Content-owned `GET /api/v1/content/pages`
 *                                 collection (Container Nodes projected to
 *                                 `PageDto`).
 *  - Page get / delete         -> Content list + generic VFS delete by path.
 *  - Page create               -> Content-owned `POST /api/v1/content/pages`
 *                                 (mints Package Container + chowns to real
 *                                 user / `content` group; see
 *                                 `CreatePageProcessor`).
 *  - Variant list              -> children of the Container Node via VFS.
 *  - Variant create            -> `POST /api/v1/vfs/files` (empty body)
 *                                 + optional follow-up PATCH for title /
 *                                 extras.
 *  - Variant update (metadata) -> `PATCH /api/v1/vfs/files` with merge-extras
 *                                 semantics; archive collapses to this with
 *                                 `extras.status='archived'`.
 *  - Variant body              -> VFS file-content endpoint
 *                                 `/api/v1/vfs/files/content?path=...`.
 *  - Publish                   -> Content-owned business endpoint
 *                                 `POST /api/v1/content/variants/{id}/publish`
 *                                 (a real state-machine step; not extras PATCH).
 */
const VARIANT_MIME = 'text/x-dtmpl';

interface VfsNodeWithExtras extends NodeDto {
    readonly extras?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class PageService {
    private readonly http  = inject(HttpClient);
    private readonly api   = inject(ApiService);
    private readonly store = inject(Store);

    private get manifest() {
        return this.store.selectSnapshot(AppConfigState.manifest);
    }

    private get apiBase(): string {
        return this.manifest?.apiBase ?? '/api/v1';
    }

    // -- Pages: Content-owned collection + VFS file/dir ops for items -------

    /**
     * Pages collection. With no args returns root rows (Package + Directory
     * Nodes carrying or leading to Page Containers). With `{ parentId }`
     * returns the direct children of that parent (tree-mode lazy expand).
     * With `{ search }` runs a bounded full-tree typeahead (name/path match,
     * Packages only) — for pickers that want to find a page by name rather
     * than drilling the tree. `search` takes precedence over `parentId`.
     */
    listPages(opts?: { parentId?: string | null; search?: string; space?: string | null }): Observable<PageDto[]> {
        const url = `${this.apiBase}/content/pages`;
        let params = new HttpParams();
        const search = opts?.search?.trim() ?? '';
        if (search !== '') {
            params = params.set('q', search);
        } else if (opts?.parentId !== undefined && opts.parentId !== null && opts.parentId !== '') {
            params = params.set('parent', opts.parentId);
        }
        // #1693 — space scope. Sent alongside `parent` too, not just on the
        // root listing: the backend confines the parent to the space, so
        // dropping it here would let a stale parent id walk out of the space
        // the user has selected.
        const space = opts?.space ?? '';
        if ('' !== space) {
            params = params.set('space', space);
        }
        return this.http.get<HydraCollection<PageDto>>(url, { params }).pipe(
            map(r => r.member),
        );
    }

    /**
     * The page kinds this installation offers (ADR-153 step (b), #1696).
     *
     * Read from the manifest rather than a literal path, and NOT hardcoded on
     * the client: which kinds exist is deployment config (`content.page_types`),
     * and a client-side list would drift from the allow-list the create
     * endpoint validates against — offering an option the server then 422s.
     *
     * Empty list on a missing manifest entry, so an older backend degrades to
     * "no explicit kinds" instead of throwing inside a dialog.
     */
    listPageTypes(): Observable<PageTypeDto[]> {
        const url = this.manifest?.content?.pageTypesUrl;
        if (!url) {
            return of([]);
        }

        return this.http.get<HydraCollection<PageTypeDto>>(url).pipe(
            map(r => r.member),
        );
    }

    /**
     * The page spaces this user can see (#1698).
     *
     * The explorer's accordion loads these through `SpaceSelectionStore`; this
     * is the same endpoint for callers that need the list WITHOUT the store's
     * selection semantics — the placement dialog wants the site slugs, not an
     * active space.
     */
    listPageSpaces(): Observable<SpaceDto[]> {
        const url = this.manifest?.content?.pageSpacesUrl;
        if (!url) {
            return of([]);
        }

        return this.http.get<HydraCollection<SpaceDto>>(url).pipe(
            map(r => r.member),
        );
    }

    /**
     * The surfaces a page can be placed on (#1698).
     *
     * Deliberately the `/content/pages/surfaces` route rather than the article
     * one: same catalogue, but the Pages UI must not depend on an endpoint
     * ADR-153 (d) is going to retire.
     */
    listSurfaces(): Observable<PageSurfaceDto[]> {
        const url = `${this.apiBase}/content/pages/surfaces`;

        return this.http.get<HydraCollection<PageSurfaceDto>>(url).pipe(
            map(r => r.member),
        );
    }

    /**
     * Link a page into a surface, or remove that link (#1698).
     *
     * `place` is the DISTRIBUTION verb — where else the page appears. It is not
     * `publishVariant`, which is the LIFECYCLE verb deciding which locale is
     * live. Naming them apart here is the whole point of ADR-153's split.
     */
    placePage(vfsPath: string, siteSlug: string, surface: string): Observable<unknown> {
        return this.http.post(`${this.apiBase}/content/pages/place`, { vfsPath, siteSlug, surface });
    }

    unplacePage(vfsPath: string, siteSlug: string, surface: string): Observable<unknown> {
        return this.http.post(`${this.apiBase}/content/pages/unplace`, { vfsPath, siteSlug, surface });
    }

    /**
     * Change an existing page's kind (#1697).
     *
     * `contentType: ''` CLEARS the stamp — the backend unsets the extra rather
     * than storing an empty string, returning the page to "no explicit kind"
     * (inherit from the collection, else the SSR fallback).
     *
     * Addressed by `vfsPath` like the sibling rename op: both are collection
     * -level actions with no item to read first.
     */
    setPageType(vfsPath: string, contentType: string): Observable<PageDto> {
        const url = `${this.apiBase}/content/pages/type`;

        return this.http.post<PageDto>(url, { vfsPath, contentType });
    }

    /**
     * Single-page read by Node UUID. Backed by `GET /api/v1/content/pages?id=<id>`
     * which returns a single-element collection (Package Container Node with
     * the Page mime) or empty. Symmetric with `getPageByVfsPath`.
     *
     * Used by editor flows that hold only the page id (e.g. resolveVariantPath
     * for content GET/PUT, deletePage). Replaces the previous listPages().find()
     * approach which only matched root candidates — nested pages under sites
     * (post-H1) were unreachable.
     */
    getPage(id: string): Observable<PageDto> {
        const url = `${this.apiBase}/content/pages`;
        const params = new HttpParams().set('id', id);
        return this.http.get<HydraCollection<PageDto>>(url, { params }).pipe(
            switchMap(r => r.member[0]
                ? [r.member[0]]
                : throwError(() => new Error(`Page "${id}" not found.`)),
            ),
        );
    }

    /**
     * Creates a new Page atomically: mints a Package Container Node at the
     * resolved VFS path (mime `application/vnd.coolms.page`, mode `0o775`)
     * plus an initial empty default-locale variant child Node. Returns the
     * `PageDto` projection so the dialog can open the editor on the new
     * page immediately.
     */
    createPage(data: {
        slug: string;
        /**
         * Human page title. When `slug` is empty the backend DERIVES the slug
         * (= the Package filename, = the URL segment) from this via the Core
         * i18n slugger ([#1611]); an explicit `slug` still wins. Also stamped
         * onto the initial variant's `Node.title` (the value the grid + SSR
         * show). Either `title` or `slug` must yield a non-empty slug (422).
         */
        title?: string;
        /**
         * Authoring space key to create IN (#1699) — `personal`,
         * `site:default`. Roots the derived path at that space instead of at a
         * SiteSection, which is the only way the personal space is reachable
         * without the caller knowing its own user UUID. An explicit `vfsPath`
         * still wins.
         */
        space?: string;
        vfsPath?: string;
        sectionSlug?: string;
        /**
         * Optional initial-variant locale. When omitted, the backend uses the
         * resolved SiteSection's `defaultLocale` (then bare `'en'`). When set,
         * MUST be in `coolms_i18n.supported_locales` -- backend returns 422
         * for unknown codes. The "+ New Page" dialog picks this from the
         * manifest dropdown.
         */
        locale?: string;
        /**
         * Optional page-level content type (W5.f). `'landing'` mints the page
         * with `extras.contentType=landing` so the block editor lights up
         * immediately; omitted/empty creates a plain page. Backend restricts
         * this to a known allow-list (422 otherwise).
         */
        contentType?: string;
        /**
         * Optional Markdown to seed the new page's initial-variant body
         * (Track B #1 — "New page from Markdown"). The backend converts it to
         * safe HTML via the same hardened converter the editor's paste path
         * uses (raw HTML + unsafe links stripped, since bodies render
         * unsanitised), capped at 256 KB (422 over-limit). Omitted/empty keeps
         * the existing empty-body behaviour.
         */
        markdown?: string;
    }): Observable<PageDto> {
        const url = `${this.apiBase}/content/pages`;
        return this.http.post<PageDto>(url, data, {
            headers: { 'Content-Type': 'application/ld+json' },
        });
    }

    /**
     * Renames a page's/article's slug ([#1618]) — changes the Package directory
     * name AND its `extras.slug` in one atomic backend op. `vfsPath` names the
     * current Package; `slug` is the new URL segment; `force` bypasses the
     * publish freeze (`slugLocked`) — a rename of a published page is refused
     * (409) unless `force` is set, because it changes the live URL. Returns the
     * re-pathed `PageDto` (the caller reloads / reopens at the new path).
     */
    renamePage(vfsPath: string, slug: string, force = false): Observable<PageDto> {
        const url = `${this.apiBase}/content/pages/rename`;
        return this.http.post<PageDto>(url, { vfsPath, slug, force }, {
            headers: { 'Content-Type': 'application/ld+json' },
        });
    }

    deletePage(id: string): Observable<void> {
        return this.getPage(id).pipe(
            switchMap(page => {
                if (!page.vfsPath) {
                    return throwError(() => new Error(`Page "${id}" has no vfsPath; cannot delete.`));
                }
                return this.api.deleteNode(page.vfsPath, true);
            }),
        );
    }

    getPageByVfsPath(vfsPath: string): Observable<PageDto | null> {
        // Backed by `GET /api/v1/content/pages?path=<vfsPath>` which returns
        // a single-element collection (Package Container Node at that path
        // with the Page mime) or an empty collection when no Page exists
        // there. We unwrap to the lone element, or null on empty.
        const url = `${this.apiBase}/content/pages`;
        const params = new HttpParams().set('path', vfsPath);
        return this.http.get<HydraCollection<PageDto>>(url, { params }).pipe(
            map(r => r.member[0] ?? null),
        );
    }

    // -- Variants: children of the Container directory listed via VFS -------

    /**
     * Accepts a `pageId` string (resolves via getPage) OR a pre-loaded
     * `PageDto` (skips the lookup). Callers that already hold the page
     * should pass it to avoid a redundant `/content/pages` round-trip.
     */
    listVariants(pageOrId: string | PageDto): Observable<PageVariantDto[]> {
        const page$ = typeof pageOrId === 'string'
            ? this.getPage(pageOrId)
            : of(pageOrId);
        return page$.pipe(
            switchMap(page => {
                if (!page.vfsPath) {
                    return throwError(() => new Error(`Page "${page.id}" has no vfsPath; cannot list variants.`));
                }
                return this.api.listDirectory(page.vfsPath).pipe(
                    map(nodes => nodes
                        .filter(n => n.mimeType === VARIANT_MIME)
                        .map(n => this.toVariantDto(n as VfsNodeWithExtras, page.id)),
                    ),
                );
            }),
        );
    }

    /**
     * Creates a new locale variant Node under an existing Package directory.
     * Accepts a `pageId` string (resolves via getPage) OR a pre-loaded
     * `PageDto` (skips the lookup), mirroring `listVariants`.
     *
     * The VFS create payload only accepts path + content + render-config
     * fields; `title` and `extras` ride on a follow-up PATCH via
     * `updateVariant`. Variants start with empty body; the mime registry
     * stamps `text/x-dtmpl` from the `.dtmpl` extension.
     */
    createVariant(
        pageOrId: string | PageDto,
        data: { locale: string; extras?: Record<string, unknown>; title?: string },
    ): Observable<PageVariantDto> {
        const page$ = typeof pageOrId === 'string'
            ? this.getPage(pageOrId)
            : of(pageOrId);
        return page$.pipe(
            switchMap(page => {
                if (!page.vfsPath) {
                    return throwError(() => new Error(`Page "${page.id}" has no vfsPath; cannot create variant.`));
                }
                const variantPath = `${page.vfsPath}/${data.locale}.dtmpl`;
                const url = `${this.apiBase}/vfs/files`;
                return this.http.post<VfsNodeWithExtras>(url, {
                    path: variantPath,
                    content: '',
                }).pipe(
                    switchMap(node => {
                        const hasMeta = data.title !== undefined
                            || (data.extras !== undefined && Object.keys(data.extras).length > 0);
                        // Without title/extras the create response already
                        // matches the final variant state; map and return.
                        if (!hasMeta) {
                            return of(this.toVariantDto(node, page.id));
                        }
                        // Follow-up PATCH carries title/extras the create
                        // endpoint does not accept inline; updateVariant
                        // returns the post-PATCH PageVariantDto directly.
                        return this.updateVariant(page.id, data.locale, {
                            title: data.title,
                            extras: data.extras,
                        });
                    }),
                );
            }),
        );
    }

    /**
     * Variant metadata PATCH. `title` and `description` map to real Node
     * columns (post Ship 1 promotion); `extras` is a partial bag patch
     * merged onto the existing variant Node's extras (omitted keys
     * preserved; null values remove a key).
     */
    updateVariant(
        pageId: string,
        locale: string,
        patch: { title?: string | null; description?: string | null; extras?: Record<string, unknown> },
    ): Observable<PageVariantDto> {
        return this.resolveVariantPath(pageId, locale).pipe(
            switchMap(path => {
                const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(path)}`;
                const body: Record<string, unknown> = { path };
                if (patch.title !== undefined)       body['title']       = patch.title;
                if (patch.description !== undefined) body['description'] = patch.description;
                if (patch.extras !== undefined)      body['extras']      = patch.extras;
                return this.http.patch<VfsNodeWithExtras>(url, body, {
                    headers: { 'Content-Type': 'application/merge-patch+json' },
                });
            }),
            map(node => this.toVariantDto(node, pageId)),
        );
    }

    /**
     * Publishes a variant Node. New canonical signature is
     * `publishVariant(variantNodeId)`. Legacy `(pageId, locale)` callers
     * resolve the variant Node UUID via the children listing, then post.
     */
    publishVariant(pageIdOrNodeId: string, locale?: string): Observable<{ id: string; status: string }> {
        const pattern = this.manifest?.content?.variantPublishUrl;
        if (!pattern) {
            return throwError(() => new Error('ContentApiManifest.variantPublishUrl missing.'));
        }
        if (locale === undefined) {
            const url = resolvePattern(pattern, { id: pageIdOrNodeId });
            return this.http.post<{ id: string; status: string }>(url, {});
        }
        return this.resolveVariantNodeId(pageIdOrNodeId, locale).pipe(
            switchMap(nodeId => {
                const url = resolvePattern(pattern, { id: nodeId });
                return this.http.post<{ id: string; status: string }>(url, {});
            }),
        );
    }

    /**
     * Editorial review actions (W6.a) on a variant Node, keyed by its UUID:
     * `submit-for-review` (author), `approve` / `request-changes` (reviewer).
     * The endpoints sit alongside `/publish` under the same
     * `content/variants/{id}/…` namespace, so we derive them from the
     * manifest's `variantPublishUrl` pattern rather than adding three more
     * manifest keys. Each returns the variant's new `{ id, status, note }`.
     */
    submitForReview(variantNodeId: string): Observable<{ id: string; status: string; note?: string }> {
        return this.postReviewAction(variantNodeId, 'submit-for-review');
    }

    approveVariant(variantNodeId: string): Observable<{ id: string; status: string; note?: string }> {
        return this.postReviewAction(variantNodeId, 'approve');
    }

    requestChanges(variantNodeId: string, note: string): Observable<{ id: string; status: string; note?: string }> {
        return this.postReviewAction(variantNodeId, 'request-changes', { note });
    }

    /**
     * Sets (or clears) the scheduled publish/unpublish for a variant Node
     * (W6.d), keyed by its UUID. `publishAt` / `unpublishAt` are full ISO-8601
     * strings (with offset) or `null` to cancel that action. The endpoint sits
     * alongside `/publish`, so we derive it from `variantPublishUrl`. Returns
     * the persisted schedule snapshot.
     */
    scheduleVariant(
        variantNodeId: string,
        publishAt: string | null,
        unpublishAt: string | null,
    ): Observable<{ id: string; publishAt: string | null; unpublishAt: string | null }> {
        const pattern = this.manifest?.content?.variantPublishUrl;
        if (!pattern) {
            return throwError(() => new Error('ContentApiManifest.variantPublishUrl missing.'));
        }
        const url = resolvePattern(pattern, { id: variantNodeId }).replace(/\/publish$/, '/schedule');
        return this.http.post<{ id: string; publishAt: string | null; unpublishAt: string | null }>(url, {
            publishAt,
            unpublishAt,
        });
    }

    private postReviewAction(
        variantNodeId: string,
        action: 'submit-for-review' | 'approve' | 'request-changes',
        body: Record<string, unknown> = {},
    ): Observable<{ id: string; status: string; note?: string }> {
        const pattern = this.manifest?.content?.variantPublishUrl;
        if (!pattern) {
            return throwError(() => new Error('ContentApiManifest.variantPublishUrl missing.'));
        }
        const url = resolvePattern(pattern, { id: variantNodeId }).replace(/\/publish$/, `/${action}`);
        return this.http.post<{ id: string; status: string; note?: string }>(url, body);
    }

    /**
     * Archives a variant by setting `extras.status = 'archived'` via the
     * generic VFS PATCH. Mirrors `publishVariant`'s positional signature but
     * the node-ID-only path is not supported yet -- there is no backend
     * `/content/variants/{id}/archive` endpoint (archive is collapsed to a
     * generic extras PATCH, no business state-machine step), and the VFS
     * file PATCH endpoint is path-based.
     *
     * Pass `(pageId, locale)`; the call delegates to `updateVariant` with
     * a single-key extras merge so other extras keys stay intact.
     */
    archiveVariant(pageIdOrNodeId: string, locale?: string): Observable<void> {
        if (locale === undefined) {
            return throwError(() => new Error(
                'archiveVariant: node-id-only signature not supported; pass (pageId, locale).',
            ));
        }
        return this.updateVariant(pageIdOrNodeId, locale, {
            extras: { status: 'archived' },
        }).pipe(map(() => void 0));
    }

    // -- Content: variant body via the VFS file-content endpoint ------------

    /**
     * Reads variant body. Legacy callers pass `(pageId, locale)`; the
     * service derives the variant Node path via `{page.vfsPath}/{locale}.dtmpl`
     * and reads through `/api/v1/vfs/files/content?path=...`.
     */
    getContent(pageId: string, locale: string): Observable<{ content: string }> {
        return this.resolveVariantPath(pageId, locale).pipe(
            switchMap(path => this.fetchContentByPath(path)),
        );
    }

    saveContent(pageId: string, locale: string, content: string): Observable<{ contentHash: string }> {
        return this.resolveVariantPath(pageId, locale).pipe(
            switchMap(path => this.putContentByPath(path, content)),
        );
    }

    // -- internals ----------------------------------------------------------

    private resolveVariantNodeId(pageId: string, locale: string): Observable<string> {
        return this.listVariants(pageId).pipe(
            switchMap(variants => {
                const match = variants.find(v => v.locale === locale);
                if (!match) {
                    return throwError(() => new Error(`Variant Node for locale "${locale}" not found.`));
                }
                return [match.id];
            }),
        );
    }

    private resolveVariantPath(pageId: string, locale: string): Observable<string> {
        return this.getPage(pageId).pipe(
            map(p => `${p.vfsPath ?? ''}/${locale}.dtmpl`),
        );
    }

    private fetchContentByPath(path: string): Observable<{ content: string }> {
        const fileUrl = this.manifest?.vfs?.fileContentUrl;
        if (!fileUrl) {
            return throwError(() => new Error('VfsApiManifest.fileContentUrl missing.'));
        }
        const url = resolvePattern(fileUrl, { path });
        // Server returns a JSON-LD `FileContent` envelope; unwrap the `content`
        // field for the editor. The envelope also carries `@id`/`@type`/`@context`
        // which the editor does not need.
        return this.http.get<{ content?: string }>(url).pipe(
            map(response => ({ content: response.content ?? '' })),
        );
    }

    private putContentByPath(path: string, content: string): Observable<{ contentHash: string }> {
        const fileUrl = this.manifest?.vfs?.fileContentUrl;
        if (!fileUrl) {
            return throwError(() => new Error('VfsApiManifest.fileContentUrl missing.'));
        }
        const url = resolvePattern(fileUrl, { path });
        // Backend `FileContentResource` expects a JSON-LD `{ "content": "..." }`
        // body and returns `{ "contentHash": "..." }`. Angular's HttpClient
        // serializes the object body as JSON and sets Content-Type for us.
        return this.http.put<{ contentHash: string }>(url, { content });
    }

    private toPageDto(node: VfsNodeWithExtras, variants: PageVariantSummaryDto[]): PageDto {
        const extras = node.extras ?? {};
        return {
            id:          node.id,
            slug:        (extras['slug'] as string) ?? this.basenameNoExt(node.name) ?? '',
            vfsPath:     node.path,
            sectionSlug: (extras['sectionSlug'] as string | undefined) ?? null,
            // Carry the landing/page-type discriminator so a future consumer that
            // opens the editor from a toPageDto()-built DTO seeds landing mode
            // correctly (omitting it silently reopens a landing page in prose mode).
            contentType: extras['contentType'] as string | undefined,
            variants,
            createdAt:   node.createdAt,
        };
    }

    private toVariantDto(node: VfsNodeWithExtras, pageId: string): PageVariantDto {
        const extras = node.extras ?? {};
        const status = (extras['status'] as PageVariantDto['status']) ?? 'draft';
        // `title` and `description` are real Node columns post Ship 1 promotion;
        // extras fallback covers any unmigrated legacy rows. Meta + ogImage stay
        // in extras (per-variant SEO, not promoted to columns).
        return {
            id:        node.id,
            pageId,
            locale:    this.basenameNoExt(node.name) ?? '',
            status,
            // The full raw extras map, so the page editor's declaration-driven
            // Meta panel can read arbitrary SEO-group field values per locale.
            extras,
            title:     node.title ?? (extras['title'] as string | undefined),
            metaTitle: extras['metaTitle'] as string | undefined,
            metaDesc:  extras['metaDesc']  as string | undefined,
            ogImage:   extras['ogImage']   as string | undefined,
            template:  node.template ?? (extras['template'] as string | undefined),
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            // W6.c: review audit, surfaced to the author on changes_requested.
            reviewNote: extras['reviewNote'] as string | undefined,
            reviewedBy: extras['reviewedBy'] as string | undefined,
            reviewedAt: extras['reviewedAt'] as string | undefined,
            // W6.d: pending scheduled publish/unpublish times.
            publishAt:   extras['publishAt']   as string | undefined,
            unpublishAt: extras['unpublishAt'] as string | undefined,
        };
    }

    private basenameNoExt(name: string): string | null {
        const dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.slice(0, dot);
    }
}
