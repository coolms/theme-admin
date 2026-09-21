// Cut from the shell's api/api.service.ts on 2026-09-21: the Mcp (/mcp/tools) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest } from '@coolms/core-angular';
import {
    type McpToolCatalogDto,
} from './mcp.types';

@Injectable({ providedIn: 'root' })
export class McpApiService {
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
     * MCP tool-governance audit ( `GET /api/mcp/tools`, ROLE_ADMIN) -- the
     * full inventory of tools external AI agents can call + the gate on each.
     * The endpoint is UNVERSIONED (`/api/mcp/...`, like `/api/doc`), so it hangs off
     * the `/api` base, not the `/api/v1` apiBase.
     */
    getMcpTools(): Observable<McpToolCatalogDto> {
        const base = this.manifest.apiBase.replace(/\/v1\/?$/, '');
        return this.http.get<McpToolCatalogDto>(`${base}/mcp/tools`);
    }
}
