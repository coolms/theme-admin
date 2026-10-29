import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';

/** Where a value was set: a page or a folder above it, in one scope; `link` is null for a node one may not open. */
export interface PropertySourceDto {
    readonly label: string;
    readonly scope: string;
    readonly isPage: boolean;
    readonly link: string | null;
}

/** One property as it applies to the node: the values key by key, each key's source, and where inheritance stopped. */
export interface AppliedPropertyDto {
    /** `keyed` | `single` | ... -- `single` holds one value under the key "". */
    readonly merge: string;
    readonly values: Readonly<Record<string, string>>;
    readonly sources: Readonly<Record<string, PropertySourceDto>>;
    readonly stoppedAt: PropertySourceDto | null;
}

/** What the node sets itself for one property in one scope. */
export interface OwnPropertyDto {
    readonly op: string;
    readonly values: Readonly<Record<string, string>>;
}

/** `GET /web/page-properties`: `own` is scope -> property -> set; `version` is named by the next change. */
export interface PagePropertiesDto {
    readonly path: string;
    readonly locale: string;
    readonly properties: Readonly<Record<string, AppliedPropertyDto>>;
    readonly own: Readonly<Record<string, Readonly<Record<string, OwnPropertyDto>>>>;
    readonly version: string;
}

/** A change: `op` is append, override, stop or reset (reset removes the node's set; `values` is not read). */
export interface PagePropertyChange {
    readonly path: string;
    readonly scope: string;
    readonly property: string;
    readonly op: string;
    readonly values: Readonly<Record<string, string>>;
    readonly version: string;
}

/** The scope of the values that apply in every language. */
export const ALL_LANGUAGES = '*';

/** A page's properties (meta, og, twitter, x_default, and whatever the server declares next), read and changed. */
@Injectable({ providedIn: 'root' })
export class PagePropertiesService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get url(): string {
        return `${this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1'}/web/page-properties`;
    }

    read(path: string, locale: string): Observable<PagePropertiesDto> {
        const params = new HttpParams().set('path', path).set('locale', locale);
        return this.http.get<unknown>(this.url, { params }).pipe(map(normalise));
    }

    /** 412 when the properties changed since `version`; 422 with the server's reason when the change is refused. */
    change(change: PagePropertyChange): Observable<PagePropertiesDto> {
        // An empty map is sent as an object, never as a list.
        const body = { ...change, values: { ...change.values } };
        return this.http.post<unknown>(this.url, body).pipe(map(normalise));
    }
}

/** PHP writes an empty map as `[]`: every map in the answer is read as an object. */
function normalise(raw: unknown): PagePropertiesDto {
    const r = (raw ?? {}) as Record<string, unknown>;
    const properties: Record<string, AppliedPropertyDto> = {};
    for (const [name, p] of Object.entries(record(r['properties']))) {
        const applied = record(p);
        properties[name] = {
            merge: String(applied['merge'] ?? 'keyed'),
            values: record(applied['values']) as Record<string, string>,
            sources: record(applied['sources']) as Record<string, PropertySourceDto>,
            stoppedAt: (applied['stoppedAt'] ?? null) as PropertySourceDto | null,
        };
    }
    const own: Record<string, Record<string, OwnPropertyDto>> = {};
    for (const [scope, sets] of Object.entries(record(r['own']))) {
        own[scope] = {};
        for (const [name, set] of Object.entries(record(sets))) {
            const s = record(set);
            own[scope][name] = { op: String(s['op'] ?? ''), values: record(s['values']) as Record<string, string> };
        }
    }
    return {
        path: String(r['path'] ?? ''),
        locale: String(r['locale'] ?? ALL_LANGUAGES),
        properties,
        own,
        version: String(r['version'] ?? ''),
    };
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
