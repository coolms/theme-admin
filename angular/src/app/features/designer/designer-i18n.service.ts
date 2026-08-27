import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Translator } from '@coolms/designer';

/**
 * Supplies the designer with its UI strings from the backend.
 *
 * The designer package ships message keys and an English fallback and owns no
 * catalogue, so this is the half that decides where the strings come from. In
 * the admin they come from the platform catalogue: the Workflow module ships
 * `translations/workflow.en.xlf` as the baseline (generated from the package's
 * own fallbacks, so it cannot drift), and operators author other locales
 * through the Translations admin, which writes VFS overrides on top.
 *
 * Three properties this deliberately has:
 *
 *  - **English costs almost nothing.** The package's fallbacks ARE the
 *    English baseline, so an English session asks which locale it is in and
 *    then stops -- it never fetches a catalogue that could only echo them.
 *  - **Failure is invisible.** A 403 (the catalogue endpoint is admin-gated),
 *    a 404 (locale not supported), or an offline backend all leave the editor
 *    rendering its inline English. A missing translation must never be a
 *    broken screen.
 *  - **One request per session.** The result is cached on the service, which
 *    is root-provided, so opening four editors loads one catalogue.
 *
 * The locale is ASKED FOR, not guessed. `GET /i18n/current-locale` runs the
 * platform's own detector chain -- URL prefix, query, the signed-in user's
 * stored preference, cookie, Accept-Language, default -- and reports what it
 * decided. Reading `navigator.language` here instead would ignore the user's
 * preference and every operator override, and would drift the moment the
 * chain was reordered.
 */
@Injectable({ providedIn: 'root' })
export class DesignerI18nService {
    private readonly http = inject(HttpClient);

    private static readonly DOMAIN = 'workflow';

    /**
     * The language the package's inline fallbacks are written in. A catalogue
     * for this locale could only echo them back, so it is never fetched.
     */
    private static readonly PACKAGE_LOCALE = 'en';

    /** Resolved catalogue, or null when English / not yet loaded / failed. */
    private messages: Readonly<Record<string, string>> | null = null;

    /** De-duplicates concurrent loads when several editors mount at once. */
    private pending: Promise<void> | null = null;

    /**
     * Hand this to `createEditor({ t })`. Stable identity, safe to call
     * before {@link ensureLoaded} -- it simply returns English until the
     * catalogue arrives.
     */
    readonly translate: Translator = (key, fallback, params) => {
        const message = this.messages?.[key];
        return interpolate(
            message === undefined || message === '' ? fallback : message,
            params,
        );
    };

    /**
     * Load the catalogue for the current locale, once. Awaited by the editor
     * pages before they mount, because the toolbar captures its labels at
     * construction -- a catalogue arriving later would leave the chrome in
     * English while the property panel spoke the target language.
     */
    async ensureLoaded(): Promise<void> {
        if (this.messages !== null) return;
        if (this.pending !== null) return this.pending;

        this.pending = this.load().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    private async load(): Promise<void> {
        try {
            const locale = await this.resolveLocale();
            if (locale === DesignerI18nService.PACKAGE_LOCALE) {
                // Fetching a catalogue that would only echo the fallbacks is
                // pure latency.
                this.messages = {};
                return;
            }

            const id = `${DesignerI18nService.DOMAIN}:${locale}`;
            const response = await firstValueFrom(
                this.http.get<CatalogueResponse>(`/api/v1/i18n/catalogues/${id}`, {
                    // Hydra strips map-shaped payloads; ask for plain JSON.
                    headers: new HttpHeaders({ Accept: 'application/json' }),
                }),
            );
            const map: Record<string, string> = {};
            for (const entry of response.entries ?? []) {
                const text = entry.override ?? entry.baseline;
                if (typeof entry.key === 'string' && typeof text === 'string') {
                    map[entry.key] = text;
                }
            }
            this.messages = map;
        } catch {
            // Deliberately silent: see the class docblock. An empty map means
            // "loaded, nothing to override", so we do not retry on every mount.
            this.messages = {};
        }
    }

    /** What the platform's detector chain resolved for this session. */
    private async resolveLocale(): Promise<string> {
        const response = await firstValueFrom(
            this.http.get<CurrentLocaleResponse>('/api/v1/i18n/current-locale', {
                headers: new HttpHeaders({ Accept: 'application/json' }),
            }),
        );
        return response.locale;
    }
}

interface CurrentLocaleResponse {
    readonly locale: string;
    readonly supportedLocales: readonly string[];
    readonly defaultLocale: string;
}

interface CatalogueEntry {
    readonly key: string;
    readonly baseline: string;
    readonly override: string | null;
}

interface CatalogueResponse {
    readonly entries?: readonly CatalogueEntry[] | null;
}

/**
 * `%name%` substitution, matching the package's own resolver.
 *
 * Duplicated rather than imported so this service depends only on the
 * package's TYPE, not its runtime -- the admin can then federate the designer
 * without this service pinning a second copy of it into the host bundle.
 */
function interpolate(
    text: string,
    params?: Readonly<Record<string, string | number>>,
): string {
    if (params === undefined) return text;
    return text.replace(/%([A-Za-z0-9_]+)%/g, (whole, name: string) => {
        const value = params[name];
        return value === undefined ? whole : String(value);
    });
}
