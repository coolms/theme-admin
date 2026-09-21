import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, IdentityApiClient, RealtimeTokenClient, type TokenResponse, type UserDto, type HydraCollection, type HydraView, type CentrifugoConnectionTokenDto, type CentrifugoSubscriptionTokenDto } from '@coolms/core-angular';
// Re-exported so the feature files importing these from here keep working;
// they are DECLARED in core, which owns the session, the collection envelope
// every list response arrives in, and the realtime tokens.
export type {
    TokenResponse, UserDto,
    HydraCollection, HydraView,
    CentrifugoConnectionTokenDto, CentrifugoSubscriptionTokenDto,
};

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

// --- DocumentGeneration DTOs -------------------------------------------------

/**
 * `GET /document/generations/preview-audience` -- who an RQL filter selects.
 *
 * `count` is authoritative: it comes from the same `FilterAudienceMaterializer`
 * the submit runs, so it is the number that lands in `BatchJob.totalCount`.
 * `sample` is up to 10 rows so the operator can check "yes, these are the
 * right people" before committing.
 */
export interface AudiencePreviewDto {
    readonly count:  number;
    readonly sample: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Payload accepted by POST /api/v1/document/generations. Flat shape
 * matching the backend resource (`outputBasePath` and `filenamePattern`
 * are top-level; the recipient filter is embedded in
 * `audienceCriteria` as a mode-specific map).
 */
export interface CreateDocumentGenerationPayload {
    templateId:       string;
    /**
     * The template's own output format -- `docx`, `pdf`, `xlsx`, ... Widened from
     * a `'docx' | 'pdf'` union in : the union was accurate only while Word
     * was the sole format module, and it forced the wizard to coerce a
     * spreadsheet template's `xlsx` into `docx`.
     */
    outputFormat:     string;
    mode:             'single' | 'filter';
    audienceCriteria: Record<string, unknown>;
    plainVariables:   Record<string, unknown>;
    outputBasePath:   string;
    filenamePattern:  string;
}

/**
 * Response shape from the same endpoint -- mirrors the read-only
 * fields on `DocumentGenerationResource`. The status endpoint
 * (`GET /document/generations/{id}/status`) returns the same shape
 * with `failedInstanceIds` populated when `failedCount > 0`.
 */
export interface DocumentGenerationDto {
    id:                 string;
    templateId:         string;
    outputFormat:       string;
    mode:               string;
    status:             string;
    totalCount:         number;
    completedCount:     number;
    failedCount:        number;
    errorMessage:       string | null;
    createdAt:          string;
    completedAt:        string | null;
    audienceCriteria:   Record<string, unknown>;
    plainVariables:     Record<string, unknown>;
    outputBasePath:     string;
    filenamePattern:    string;
    failedInstanceIds:  string[];
}

// The two Centrifugo token DTOs are DECLARED in core beside the client that
// fetches them, and re-exported at the top of this file so callers naming them
// from here keep working.

/**
 * Per-instance row returned by `GET /document/instances` when filtered
 * by `generationId`. Field set matches `DocumentInstanceResource`.
 */
export interface DocumentInstanceDto {
    id:              string;
    templateId:      string | null;
    sourceType:      string | null;
    outputFormat:    string;
    status:          string;
    generatedFileId: string | null;
    errorMessage:    string | null;
    generatedAt:     string | null;
    name?:           string;
    vfsPath?:        string | null;
    size?:           number | null;
    mimeType?:       string | null;
    createdByName?:  string | null;
}

/**
 * Options for `listDocumentInstances` -- all filters are optional and
 * combine as AND. Sort defaults to `-generatedAt` server-side.
 */
export interface ListDocumentInstancesOptions {
    generationId?: string;
    templateId?:   string;
    status?:       string;
    outputFormat?: string;
    search?:       string;
    sortKey?:      'generatedAt' | 'outputFormat' | 'status' | 'name';
    sortDir?:      'asc' | 'desc';
    page?:         number;
    limit?:        number;
}

/**
 * Unified Definitions catalog DTO -- mirrors the backend
 * {@link DefinitionCatalogResource} shape returned by
 * `GET /api/v1/definitions`. Cross-module read surface fed by
 * Workflow + Decision (today; future Form) providers via the
 * tagged catalog registry.
 *
 * `id` is the synthetic composite `'{module}:{definitionId}'`
 * minted server-side for Hydra IRI uniqueness; the FE list page
 * does NOT use it for drill-down -- instead, the `module` + the raw
 * `definitionKey` route to the per-module Designer
 * (`/admin/designer/bpmn/{key}` for Workflow,
 * `/admin/designer/dmn/{key}` for Decision).
 */
export interface DefinitionCatalogDto {
    readonly id?:                   string;
    readonly module?:               string;
    readonly definitionId?:         string;
    readonly definitionKey?:        string;
    readonly displayName?:          string;
    readonly latestVersion?:        number | null;
    readonly latestVersionSource?:  'vfs' | 'contributor' | null;
    readonly moduleLock?:           boolean | null;
    readonly hasDraft?:             boolean;
    readonly deployedAt?:           string | null;
    readonly deployedById?:         string | null;
    /** Set once the definition is retired (archived); `null` = active. */
    readonly retiredAt?:            string | null;
}

// --- Translation catalogues (admin editor) ------------------
// Mirror backend `TranslationCatalogueResource`.
// `id` is the composite `{domain}:{locale}` slug used in URI paths.

/** One row on /admin/i18n/translations (collection summary). */
export interface TranslationCatalogueDto {
    readonly id:            string;
    readonly domain:        string;
    readonly locale:        string;
    readonly hasOverride:   boolean;
    readonly entryCount:    number;
    readonly overrideCount: number;
    /** Populated only on item GET (drill-down); null on the list. */
    readonly entries?:      ReadonlyArray<TranslationCatalogueEntryDto> | null;
}

/** One translation row inside a catalogue's editor. */
export interface TranslationCatalogueEntryDto {
    readonly key:      string;
    readonly baseline: string;
    /** null = no override (renders baseline); string = override text. */
    readonly override: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
    /**
     * Collection GET requests must ask for JSON-LD so API Platform returns
     * member / totalItems.  Single-item and mutation requests work fine with
     * plain JSON (the server negotiates via content-type).
     */
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };

    private readonly identity = inject(IdentityApiClient);
    private readonly realtime = inject(RealtimeTokenClient);

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Auth ----------------------------------------------------------------

    // -- Identity: implemented in core, kept here as the app's one API surface --
    // Core owns the session, so these live in `IdentityApiClient`. Delegating
    // rather than re-pointing every caller keeps `api.login(...)` meaning what
    // it always meant.

    login(identifier: string, password: string): Observable<TokenResponse> {
        return this.identity.login(identifier, password);
    }

    refresh(refreshToken: string): Observable<TokenResponse> {
        return this.identity.refresh(refreshToken);
    }

    logout(): Observable<void> {
        return this.identity.logout();
    }

    me(): Observable<UserDto> {
        return this.identity.me();
    }

    /**
     * Preview the audience an RQL filter selects -- count plus a sample.
     *
     * Replaces `countUsers()`, which asked `GET /auth/users` for
     * `totalItems`. That endpoint returns a BARE ARRAY, so the read was
     * `undefined` on every call, for every filter, since the wizard shipped.
     * The recipients step's `canProceed` is `count > 0`, and `undefined > 0`
     * is false -- so typing ANY filter killed the Next button and Filter mode
     * could only ever be completed with an empty filter, i.e. "send to
     * everyone". Counting the returned rows instead would have been worse: the
     * endpoint pages at 20.
     *
     * `/document/generations/preview-audience` is the right call and already
     * existed. It runs the SAME `FilterAudienceMaterializer` the submit runs,
     * so the number the operator approves is the number that gets documents --
     * and it returns a `sample` so they can see WHO, not just how many.
     *
     * @param rqlBody raw query string from `CmsFilterBuilder`
     *                (`filter=expr1 and expr2`), or '' for "everyone"
     */
    previewDocumentAudience(entityType: string, rqlBody: string): Observable<AudiencePreviewDto> {
        return this.http.get<AudiencePreviewDto>(
            `${this.manifest.apiBase}/document/generations/preview-audience`,
            { params: new HttpParams().set('entityType', entityType).set('rql', rqlBody) },
        );
    }

    // -- VFS -----------------------------------------------------------------

    statNode(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.get<NodeDto>(url, { params: { path } });
    }

    listDirectory(path: string): Observable<NodeDto[]> {
        const url = this.manifest.apiBase + '/vfs/directories/list';
        return this.http
            .get<HydraCollection<NodeDto>>(url, {
                params: { path },
                headers: { Accept: 'application/ld+json' },
            })
            .pipe(map(r => r['member']));
    }

    chmodNode(dto: ChmodDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/permissions';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    chownNode(dto: ChownDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/owner';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    deleteNode(path: string, recursive = false): Observable<void> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.delete<void>(url, { params: { path, recursive: String(recursive) } });
    }

    mkdir(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path });
    }

    /**
     * Create a directory UNDER `parentPath`, named by the platform slug
     * of `title` and carrying `title` as its display name.
     *
     * Slugging server-side is the point: the platform slugger applies
     * national transliteration rule sets (`Счета` -> `scheta`, `Größe` ->
     * `groesse`), which no client-side ASCII fold can do -- it can only
     * drop the characters and report failure.
     */
    mkdirTitled(parentPath: string, title: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path: parentPath, title });
    }

    /**
     * Write a binary file into a VFS directory (multipart). Mirrors the
     * image editor's `writeVfsFile`; `overwrite=0` makes a name clash a
     * 409 rather than a silent replacement.
     *
     * `folderPath` is the PARENT -- the endpoint's `path` field is the
     * full destination file path, so passing a directory there makes it
     * try to write over the directory itself (a 409 that reads like a
     * duplicate-name error and is not one).
     */
    uploadBinary(file: File, folderPath: string, overwrite = false): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/binary';
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('path', `${folderPath.replace(/\/+$/, '')}/${file.name}`);
        form.append('overwrite', overwrite ? '1' : '0');

        return this.http.post<NodeDto>(url, form);
    }

    // -- DocumentGeneration --------------------------------------------------

    createDocumentGeneration(
        payload: CreateDocumentGenerationPayload,
    ): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + '/document/generations';
        return this.http.post<DocumentGenerationDto>(url, payload);
    }

    /**
     * Server-paginated list of generations for the admin list page.
     * Sort defaults to `-createdAt` server-side; pass `'createdAt'`
     * (asc) explicitly when the caller needs oldest-first.
     */
    listDocumentGenerations(
        params: { page?: number; limit?: number; sort?: string } = {},
    ): Observable<{ items: DocumentGenerationDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/generations';
        let httpParams = new HttpParams();
        if (params.page !== undefined) {
            httpParams = httpParams.set('page', String(params.page));
        }
        if (params.limit !== undefined) {
            httpParams = httpParams.set('limit', String(params.limit));
        }
        if (params.sort) {
            httpParams = httpParams.set('sort', params.sort);
        }
        return this.http
            .get<HydraCollection<DocumentGenerationDto>>(url, {
                headers: this.collectionHeaders.headers,
                params: httpParams,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Polling endpoint for the detail page. Returns the full generation
     * shape including counters, audience criteria, plain variables, and
     * (when `failedCount > 0`) the list of failed instance ids.
     */
    getDocumentGeneration(id: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(id)}/status`;
        return this.http.get<DocumentGenerationDto>(url);
    }

    /**
     * sub-phase 2b -- exchange the user's auth session for a
     * short-lived Centrifugo connection token signed with the
     * backend's HMAC secret. Returned shape carries `token` (the JWT
     * to hand to centrifuge-js), `expiresAt` (Unix seconds) for
     * refresh scheduling, `ttl` for convenience, and `wsUrl` so the
     * caller has everything needed to connect in one response.
     */
    getCentrifugoConnectionToken(): Observable<CentrifugoConnectionTokenDto> {
        return this.realtime.connectionToken();
    }

    /**
     * Sub-phase O -- fetch a per-channel subscription token for a
     * `private`-namespace channel. The centrifuge SDK invokes this
     * through its `getToken` callback at subscribe time and again
     * before expiry. The backend validates channel ownership against
     * the current user before signing.
     */
    getCentrifugoSubscriptionToken(channel: string): Observable<CentrifugoSubscriptionTokenDto> {
        return this.realtime.subscriptionToken(channel);
    }

    /**
     * Re-dispatch every child instance in `failed` state for the given
     * generation. Returns the updated generation shape (`status` flipped
     * back to `running`, `failedCount` reset).
     */
    retryFailedInstances(generationId: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(generationId)}/retry-failed`;
        return this.http.post<DocumentGenerationDto>(url, {});
    }

    /**
     * Server-paginated instance list for the detail page's per-instance
     * grid (filter by `generationId`) or the template-detail panel
     * (filter by `templateId`). At least one of the two ids must be set
     * -- otherwise the backend falls through to the unfiltered legacy
     * branch and pagination is lost.
     */
    listDocumentInstances(
        options: ListDocumentInstancesOptions,
    ): Observable<{ items: DocumentInstanceDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/instances';
        let params = new HttpParams();
        if (options.generationId) {
            params = params.append('filter', `generationId eq "${options.generationId}"`);
        }
        if (options.templateId) {
            params = params.append('filter', `templateId eq "${options.templateId}"`);
        }
        if (options.status) {
            params = params.append('filter', `status eq "${options.status}"`);
        }
        if (options.outputFormat) {
            params = params.append('filter', `outputFormat eq "${options.outputFormat}"`);
        }
        if (options.search) {
            params = params.append('filter', `name cn "${options.search}"`);
        }
        if (options.sortKey) {
            const prefix = options.sortDir === 'asc' ? '' : '-';
            params = params.set('sort', `${prefix}${options.sortKey}`);
        }
        if (options.page !== undefined) {
            params = params.set('page', String(options.page));
        }
        if (options.limit !== undefined) {
            params = params.set('limit', String(options.limit));
        }
        return this.http
            .get<HydraCollection<DocumentInstanceDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Unified Definitions catalog -- fetches the cross-module list of
     * deployed + draft definitions for the `/admin/definitions` page.
     * Reads `GET /api/v1/definitions`; query params optionally narrow
     * by `module`, `source`, `moduleLock`, free-text `q`, and paginate
     * via `page`/`itemsPerPage`. Returns Hydra-paginated envelope.
     */
    listDefinitions(opts: {
        module?:       string;
        source?:       'vfs' | 'contributor';
        moduleLock?:   boolean;
        q?:            string;
        page?:         number;
        itemsPerPage?: number;
        /**
         * Retirement visibility. Omit for active-only (the backend
         * default), `'all'` to include the archive, `'true'` for the
         * archive alone.
         */
        retired?:      'true' | 'all';
        /** Multi-select siblings of `module` / `source` (OR within each). */
        modules?:      readonly string[];
        sources?:      readonly string[];
        /**
         * Per-column substring filters. Distinct from `q`, which spans
         * key AND display name -- the grid filters those two columns
         * independently, so folding them together would make a Key
         * filter match on the display name.
         */
        definitionKey?: string;
        displayName?:   string;
        /** Sort column; a leading `-` means descending (e.g. `-deployedAt`). */
        sort?:         string;
    } = {}): Observable<{ items: DefinitionCatalogDto[]; totalItems: number }> {
        const url = `${this.manifest.apiBase}/definitions`;
        let params = new HttpParams();
        if (opts.module)               params = params.set('module',     opts.module);
        if (opts.source)               params = params.set('source',     opts.source);
        if (opts.moduleLock !== undefined) params = params.set('moduleLock', String(opts.moduleLock));
        if (opts.q)                    params = params.set('q',          opts.q);
        if (opts.retired)              params = params.set('retired',    opts.retired);
        if (opts.page !== undefined)   params = params.set('page',       String(opts.page));
        if (opts.itemsPerPage !== undefined) params = params.set('itemsPerPage', String(opts.itemsPerPage));
        if (opts.modules?.length)      params = params.set('modules',    opts.modules.join(','));
        if (opts.sources?.length)      params = params.set('sources',    opts.sources.join(','));
        if (opts.definitionKey)        params = params.set('definitionKey', opts.definitionKey);
        if (opts.displayName)          params = params.set('displayName',   opts.displayName);
        if (opts.sort)                 params = params.set('sort',       opts.sort);
        return this.http
            .get<HydraCollection<DefinitionCatalogDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Definition lifecycle -- `POST /definitions/{module}/{key}/retire`.
     * Archives the definition: it drops out of the default catalog and
     * blocks new starts, while deployed history and any live instances
     * stay untouched. Idempotent.
     *
     * Refusals arrive as 409 with `{reason, error}`; `reason` is the
     * machine-readable discriminator (`module_shipped`,
     * `has_deployed_history`, `has_running_instances`).
     */
    retireDefinition(module: string, key: string): Observable<void> {
        return this.http.post<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}/retire`,
            {},
        );
    }

    /** Definition lifecycle -- restore a retired definition. */
    unretireDefinition(module: string, key: string): Observable<void> {
        return this.http.post<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}/unretire`,
            {},
        );
    }

    /**
     * Definition lifecycle -- permanent delete. Only ever succeeds for a
     * NEVER-DEPLOYED definition; anything with history, live instances,
     * or a module owner is refused with 409 naming the blocker.
     */
    deleteDefinition(module: string, key: string): Observable<void> {
        return this.http.delete<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}`,
        );
    }

    // --- Translation catalogues admin ----------------------
    //
    // The four endpoints are NOT paginated -- the platform has a
    // small fixed set of (domain x locale) pairs (today: one entry,
    // realistic ceiling ~40). Returning everything at once lets the
    // list view filter client-side without round-trips.

    /**
     * GET /api/v1/i18n/catalogues -- all (domain, locale) catalogues
     * known to the platform (on-disk baseline + VFS overrides
     * unioned). Rows carry summary stats only; entries are fetched
     * on drill-down via {@link getTranslationCatalogue}.
     */
    listTranslationCatalogues(): Observable<TranslationCatalogueDto[]> {
        const url = `${this.manifest.apiBase}/i18n/catalogues`;
        return this.http
            .get<HydraCollection<TranslationCatalogueDto>>(url, { headers: this.collectionHeaders.headers })
            .pipe(map(r => r['member']));
    }

    /**
     * GET /api/v1/i18n/catalogues/{domain}:{locale} -- merged
     * entries (`baseline` + optional `override`) for one catalogue.
     */
    getTranslationCatalogue(id: string): Observable<TranslationCatalogueDto> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.get<TranslationCatalogueDto>(url, { headers: { Accept: 'application/ld+json' } });
    }

    /**
     * PUT /api/v1/i18n/catalogues/{domain}:{locale} -- save override
     * XLIFF. Entries with `override === null` are stripped before
     * serialising (no point storing baseline-only rows). Returns the
     * freshly-reloaded catalogue so the FE can hydrate without a
     * follow-up GET.
     */
    saveTranslationCatalogue(
        id: string,
        entries: ReadonlyArray<TranslationCatalogueEntryDto>,
    ): Observable<TranslationCatalogueDto> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.put<TranslationCatalogueDto>(url, { entries }, { headers: { Accept: 'application/ld+json' } });
    }

    /**
     * DELETE /api/v1/i18n/catalogues/{domain}:{locale} -- remove the
     * VFS override file (reverts to baseline). Idempotent server-side
     * so the Revert button is safe to click twice.
     */
    deleteTranslationCatalogue(id: string): Observable<void> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.delete<void>(url, { headers: { Accept: 'application/ld+json' } });
    }

}
