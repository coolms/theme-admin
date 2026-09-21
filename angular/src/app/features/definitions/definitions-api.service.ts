// Cut from the shell's api/api.service.ts on 2026-09-21: the Definition (/definitions) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type DefinitionCatalogDto,
} from './definitions.types';

@Injectable({ providedIn: 'root' })
export class DefinitionsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
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
}
