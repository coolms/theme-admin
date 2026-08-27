import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { ModuleSettingsBlockDto, ModuleSettingsWireDto } from './module-settings.types';

/**
 * Make `data` an object even when the server sent a list.
 *
 * PHP has one array type, so an EMPTY settings map JSON-encodes as `[]`, not
 * `{}` — a block nobody has edited arrives typed as a list. Every reader here
 * happens to survive that (Object.keys of an empty array is empty either way),
 * which is exactly the problem: the DTO promises a map, and the first consumer
 * to do something array-shaped with it — spread it, hand it to a form — would be
 * right by the type and wrong at runtime. Normalised once, on the way in.
 *
 * The same function also composes `effective`, so no caller has to remember
 * which of `data` and `defaults` wins.
 */
function toBlock(wire: ModuleSettingsWireDto): ModuleSettingsBlockDto {
    const data = asMap(wire.data);
    const defaults = asMap(wire.defaults);

    // A form renders the configuration IN FORCE, which is the saved value where
    // there is one and the module's shipped value everywhere else. Showing only
    // `data` is why a screen for a module running happily on its defaults came
    // up blank, with a required select reading "-- Select --" for a value the
    // system definitely had.
    return { ...wire, data, defaults, effective: { ...defaults, ...data } };
}

/** PHP has one array type, so an empty map arrives as `[]`. Normalise once. */
function asMap(value: unknown): Record<string, unknown> {
    return null !== value && 'object' === typeof value && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Module-settings admin API client (`/api/v1/module-settings`, ROLE_ADMIN).
 *
 * Feature-local rather than on the shared ApiService, mirroring BackupService /
 * NewsletterService.
 *
 * ## Why every call pins `Accept: application/json`
 *
 * A block's `data` is a keyed MAP. Left to negotiate, API Platform answers
 * `application/ld+json` and renders a map as a Hydra Collection — the values all
 * arrive and **the keys are gone**:
 *
 *     {"@type":"Collection","totalItems":2,"member":[["BY","PL"],"either"]}
 *
 * The response is a 200 that looks right, so `data['countries']` reads
 * `undefined` off it and the settings form loads empty over values that ARE
 * saved. This has already cost the platform once, on `PATCH /auth/me/settings`,
 * where it stayed invisible for as long as the endpoint existed because every
 * caller merged the result into a cache and nothing read a named field back.
 *
 * The spec asserts the REQUEST HEADER, not the parsed body: HttpTestingController
 * returns whatever shape the test feeds it, so a body-only assertion passes
 * against the broken version.
 */
@Injectable({ providedIn: 'root' })
export class ModuleSettingsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    /** Forced on every call — see the class note. */
    private static readonly JSON_HEADERS = { Accept: 'application/json' };

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Every settings block any installed module declared, ordered by key. */
    list(): Observable<ModuleSettingsBlockDto[]> {
        return this.http
            .get<ModuleSettingsWireDto[]>(`${this.apiBase}/module-settings`, {
                headers: ModuleSettingsService.JSON_HEADERS,
            })
            .pipe(map(blocks => blocks.map(toBlock)));
    }

    /**
     * The blocks one module owns.
     *
     * Derived from the collection rather than a filtered endpoint on purpose:
     * the registry is the single place that knows which modules have settings,
     * so a module page asking "do I have a settings screen?" cannot drift from
     * what the API will actually accept.
     */
    forModule(module: string): Observable<ModuleSettingsBlockDto[]> {
        return this.list().pipe(map(blocks => blocks.filter(b => b.module === module)));
    }

    /** One block's saved values. 404 when no module declared the key. */
    get(key: string): Observable<ModuleSettingsBlockDto> {
        return this.http
            .get<ModuleSettingsWireDto>(
                `${this.apiBase}/module-settings/${encodeURIComponent(key)}`,
                { headers: ModuleSettingsService.JSON_HEADERS },
            )
            .pipe(map(toBlock));
    }

    /**
     * Replace one block. The response echoes what was PERSISTED (the store
     * normalises), not what was sent, so the caller should adopt it.
     */
    save(key: string, data: Record<string, unknown>): Observable<ModuleSettingsBlockDto> {
        return this.http
            .put<ModuleSettingsWireDto>(
                `${this.apiBase}/module-settings/${encodeURIComponent(key)}`,
                { data },
                { headers: ModuleSettingsService.JSON_HEADERS },
            )
            .pipe(map(toBlock));
    }

    /** Drop the saved block so the module's shipped defaults apply again. */
    reset(key: string): Observable<void> {
        return this.http.delete<void>(
            `${this.apiBase}/module-settings/${encodeURIComponent(key)}`,
            { headers: ModuleSettingsService.JSON_HEADERS },
        );
    }
}
