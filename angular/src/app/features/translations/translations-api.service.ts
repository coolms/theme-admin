// Cut from the shell's api/api.service.ts on 2026-09-21: the I18n (/i18n/catalogues) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type TranslationCatalogueDto,
    type TranslationCatalogueEntryDto,
} from './translations.types';

@Injectable({ providedIn: 'root' })
export class TranslationsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
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
