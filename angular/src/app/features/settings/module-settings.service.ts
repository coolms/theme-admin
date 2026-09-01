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
 * `effective` is NOT composed here. It arrives composed, from the one reader
 * every module reads its own settings through -- see below.
 */
function toBlock(wire: ModuleSettingsWireDto): ModuleSettingsBlockDto {
    const data = asMap(wire.data);
    const defaults = asMap(wire.defaults);

    // A form renders the configuration IN FORCE, which is the saved value where
    // there is one and the module's shipped value everywhere else. Showing only
    // `data` is why a screen for a module running happily on its defaults came
    // up blank, with a required select reading "-- Select --" for a value the
    // system definitely had.
    //
    // This used to spread `{ ...defaults, ...data }` right here, which made it
    // the SECOND implementation of that rule -- the PHP consumers merged the
    // same two sources with a per-key type guard. The two disagreed for a key
    // saved as `null`: this file called it cleared, the server went on using the
    // shipped value, and the screen confidently described a configuration that
    // was not running. Taken from the server now (ADR-165).
    //
    // A wire without `effective` therefore yields an EMPTY map, deliberately.
    // Recomposing it as a fallback would restore the divergence for exactly the
    // cases where the server is already misbehaving, and a blank form is a
    // problem someone reports; a plausible wrong one is not.
    return {
        ...wire,
        data,
        defaults,
        effective: asMap(wire.effective),
        locked: asStringMap(wire.locked),
        // Both default to the platform-wide reading, which is what every block
        // was before per-site overrides existed and what most of them stay.
        siteScopable: true === wire.siteScopable,
        scope: orNull(wire.scope),
        // ⚠️ **The wire never sends `null` — it sends NOTHING.** API Platform
        // defaults `skip_null_values` to true, so every null property is omitted
        // from the JSON and arrives here as `undefined`, while the DTO promises
        // `string | null`. A reader written to that promise with an explicit
        // `null !== x` test then lets `undefined` straight through.
        //
        // That is not hypothetical: it took the whole settings screen down. The
        // grouping helper guarded `moduleRoute` with `null !==` and called
        // `.replace` on it, which was harmless for as long as every block
        // happened to declare a route — and threw the moment the first block
        // without one existed. Normalised here so the DTO's promise is true for
        // every consumer rather than each one having to remember.
        moduleLabel: orNull(wire.moduleLabel),
        moduleIcon: orNull(wire.moduleIcon),
        moduleRoute: orNull(wire.moduleRoute),
        formId: orNull(wire.formId),
        storedAt: orNull(wire.storedAt),
    };
}

/** A non-empty string, or null — for a field the wire may simply omit. */
function orNull(value: unknown): string | null {
    return 'string' === typeof value && '' !== value ? value : null;
}

/** `locked` is `key -> env var name`; drop anything that is not that shape. */
function asStringMap(value: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, name] of Object.entries(asMap(value))) {
        if ('string' === typeof name && '' !== name) out[key] = name;
    }
    return out;
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

    /**
     * One block's values. 404 when no module declared the key.
     *
     * With a `site`, the per-site view: `data` is what that site overrode and
     * `effective` is what it runs on. 422 when the block is platform-wide.
     */
    get(key: string, site?: string | null): Observable<ModuleSettingsBlockDto> {
        return this.http
            .get<ModuleSettingsWireDto>(this.blockUrl(key, site), { headers: ModuleSettingsService.JSON_HEADERS })
            .pipe(map(toBlock));
    }

    /**
     * Replace one block, for the platform or for one site. The response echoes
     * what was PERSISTED (the store normalises), not what was sent, so the
     * caller should adopt it.
     */
    save(key: string, data: Record<string, unknown>, site?: string | null): Observable<ModuleSettingsBlockDto> {
        return this.http
            .put<ModuleSettingsWireDto>(
                this.blockUrl(key, site),
                { data },
                { headers: ModuleSettingsService.JSON_HEADERS },
            )
            .pipe(map(toBlock));
    }

    /**
     * Drop what is saved so the layer beneath applies again.
     *
     * ⚠️ With a `site` that means the PLATFORM's values, not the module's
     * defaults — a site sits on top of the platform row, and dropping the site's
     * override reveals what was underneath rather than what shipped.
     */
    reset(key: string, site?: string | null): Observable<void> {
        return this.http.delete<void>(this.blockUrl(key, site), { headers: ModuleSettingsService.JSON_HEADERS });
    }

    /**
     * The scope is a PATH segment, not a query parameter: it says which resource
     * is being addressed rather than how to filter one, and the server reads it
     * the same way for a read and a write.
     */
    private blockUrl(key: string, site?: string | null): string {
        const block = `${this.apiBase}/module-settings/${encodeURIComponent(key)}`;

        return site ? `${block}/sites/${encodeURIComponent(site)}` : block;
    }
}
