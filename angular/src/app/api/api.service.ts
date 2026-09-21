import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
