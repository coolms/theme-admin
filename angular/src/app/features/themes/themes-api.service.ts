// Cut from the shell's api/api.service.ts on 2026-09-21: the Theme (/themes/{slug}/templates) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type ThemeTemplateDto,
} from './themes.types';

@Injectable({ providedIn: 'root' })
export class ThemesApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Theme templates (Navi-node picker, Deliverable 1) ---------

    /**
     * GET /api/v1/themes/{slug}/templates -- flat listing of `.dtmpl` files
     * available under the theme's `templates/` directory. Empty when the
     * theme has no templates yet. Throws on 404 (theme slug not installed).
     *
     * Not registered in the API manifest because consumers are scoped to
     * the Navi-node form; URL is built from `manifest.apiBase`.
     */
    getThemeTemplates(themeSlug: string): Observable<ThemeTemplateDto[]> {
        const url = `${this.manifest.apiBase}/themes/${encodeURIComponent(themeSlug)}/templates`;
        return this.http
            .get<HydraCollection<ThemeTemplateDto>>(url, {
                headers: this.collectionHeaders.headers,
            })
            .pipe(map(r => r['member']));
    }
}
