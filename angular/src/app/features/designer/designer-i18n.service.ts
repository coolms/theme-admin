import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { createCatalogTranslator, type Messages, type Translator } from '@coolms/designer';

/**
 * Supplies the designer with its UI strings.
 *
 * The designer's code holds message keys only, and the package bundles its
 * base catalogue -- every key it uses, in its source language -- as the last
 * fallback of every lookup. This service puts the platform's catalogues in
 * front of it, most specific first (2026-10-14):
 *
 *  1. the person's locale, as the platform resolved it;
 *  2. its parent (`uk-UA` -> `uk`);
 *  3. the platform's default locale, as the server reports it;
 *  4. the package's base catalogue (`createCatalogTranslator` appends it).
 *
 * Each of 1-3 is `GET /api/v1/i18n/catalogues/workflow:<locale>`: the
 * Workflow module ships the baseline and operators override it from the
 * Translations admin. Nothing here names a language -- every locale is the
 * server's answer.
 *
 * Three properties this deliberately has:
 *
 *  - **Failure is invisible.** A catalogue that cannot be read -- a server
 *    error, an unsupported locale, an offline backend -- is skipped, and the
 *    lookup goes on to the next, ending at the base catalogue. A missing
 *    translation must never be a broken screen.
 *  - **One load per session.** The result is kept on the service, which is
 *    root-provided, so opening four editors loads the catalogues once; editors
 *    mounting together share one load.
 *  - **The locale is ASKED FOR, not guessed.** `GET /i18n/current-locale` runs
 *    the platform's own detector chain -- URL prefix, query, the signed-in
 *    user's stored preference, cookie, Accept-Language, default -- and reports
 *    what it decided and the platform default. Reading `navigator.language`
 *    instead would ignore the user's preference and every operator override.
 */
@Injectable({ providedIn: 'root' })
export class DesignerI18nService {
    private readonly http = inject(HttpClient);

    private static readonly DOMAIN = 'workflow';

    private static readonly JSON = new HttpHeaders({ Accept: 'application/json' });

    /** The lookup as loaded; the base catalogue alone until then. */
    private current: Translator = createCatalogTranslator();

    private loaded = false;

    /** De-duplicates concurrent loads when several editors mount at once. */
    private pending: Promise<void> | null = null;

    /**
     * Hand this to `createEditor({ t })`. Stable identity, safe to call
     * before {@link ensureLoaded} -- it reads the base catalogue until the
     * platform's arrive.
     */
    readonly translate: Translator = (key, params) => this.current(key, params);

    /**
     * Load the catalogues for the current locale, once. Awaited by the editor
     * pages before they mount, because the toolbar captures its labels at
     * construction -- catalogues arriving later would leave the chrome in the
     * base language while the property panel spoke the person's.
     */
    async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        if (this.pending !== null) return this.pending;

        this.pending = this.load().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    private async load(): Promise<void> {
        let order: readonly string[] = [];
        try {
            const answer = await firstValueFrom(
                this.http.get<CurrentLocaleResponse>('/api/v1/i18n/current-locale', {
                    headers: DesignerI18nService.JSON,
                }),
            );
            order = lookupOrder(answer.locale, answer.defaultLocale);
        } catch {
            // Not knowing the locale must not mean guessing one: the base
            // catalogue alone.
        }
        const catalogues = await Promise.all(order.map((locale) => this.catalogue(locale)));
        this.current = createCatalogTranslator(...catalogues.filter((c): c is Messages => c !== null));
        this.loaded = true;
    }

    /** One locale's catalogue as a flat map, or null when it cannot be read. */
    private async catalogue(locale: string): Promise<Messages | null> {
        try {
            const response = await firstValueFrom(
                this.http.get<CatalogueResponse>(`/api/v1/i18n/catalogues/${DesignerI18nService.DOMAIN}:${locale}`, {
                    // Hydra strips map-shaped payloads; ask for plain JSON.
                    headers: DesignerI18nService.JSON,
                }),
            );
            const map: Record<string, string> = {};
            for (const entry of response.entries ?? []) {
                const text = entry.override ?? entry.baseline;
                if (typeof entry.key === 'string' && typeof text === 'string') {
                    map[entry.key] = text;
                }
            }
            return map;
        } catch {
            return null;
        }
    }
}

/**
 * The locales to read, most specific first: the person's locale, its parent
 * (`uk-UA` -> `uk`), the platform default -- each once.
 */
export function lookupOrder(locale: string, defaultLocale: string): readonly string[] {
    const order: string[] = [];
    const add = (l: string | undefined): void => {
        if (l !== undefined && l !== '' && !order.includes(l)) order.push(l);
    };
    add(locale);
    const cut = locale.search(/[-_]/);
    if (cut > 0) add(locale.slice(0, cut));
    add(defaultLocale);
    return order;
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
