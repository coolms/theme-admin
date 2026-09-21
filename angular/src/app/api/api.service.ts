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
