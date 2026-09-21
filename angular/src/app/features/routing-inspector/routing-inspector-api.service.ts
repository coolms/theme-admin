// Cut from the shell's api/api.service.ts on 2026-09-21: the Web (/web/routing/inspect) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest } from '@coolms/core-angular';
import {
    type RoutingTraceDto,
} from './routing-inspector.types';

@Injectable({ providedIn: 'root' })
export class RoutingInspectorApiService {
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
     * GET /api/v1/web/routing/inspect?host=&path= -- Routing Inspector
     * ( Layer 3b backend, 3d.2 FE). Admin-only; surfaces the
     * SSR pipeline trace for an arbitrary (host, path) pair so admins
     * can debug "why did /foo render template X" without booting a
     * browser session against that host.
     *
     * The endpoint returns a JSON-LD framed RoutingTrace; the framing
     * fields (`@id`, `@type`, `@context`) are ignored here.
     */
    inspectRouting(host: string, path: string): Observable<RoutingTraceDto> {
        const url    = `${this.manifest.apiBase}/web/routing/inspect`;
        const params = new HttpParams()
            .set('host', host)
            .set('path', path);
        return this.http.get<RoutingTraceDto>(url, { params });
    }
}
