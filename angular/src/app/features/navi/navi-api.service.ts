// Cut from the shell's api/api.service.ts on 2026-09-21: the Navi (manifest.navi.*) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, resolvePattern, type HydraCollection } from '@coolms/core-angular';
import {
    type NaviTreeDto,
    type CreateNaviTreeDto,
    type UpdateNaviTreeDto,
    type NaviNodeDto,
    type CreateNaviNodeDto,
    type UpdateNaviNodeDto,
} from './navi.types';

@Injectable({ providedIn: 'root' })
export class NaviApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Navi Trees ----------------------------------------------------------

    getNaviTrees(params: { filters?: string[]; sort?: string } = {}): Observable<NaviTreeDto[]> {
        let httpParams = new HttpParams();
        if (params.sort) httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<NaviTreeDto>>(this.manifest.navi!.treesList, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    createNaviTree(dto: CreateNaviTreeDto): Observable<NaviTreeDto> {
        return this.http.post<NaviTreeDto>(this.manifest.navi!.treesCreate, dto);
    }

    updateNaviTree(slug: string, dto: UpdateNaviTreeDto): Observable<NaviTreeDto> {
        const url = resolvePattern(this.manifest.navi!.treesItem, { slug });
        return this.http.patch<NaviTreeDto>(url, dto, this.patchHeaders);
    }

    deleteNaviTree(slug: string): Observable<void> {
        const url = resolvePattern(this.manifest.navi!.treesItem, { slug });
        return this.http.delete<void>(url);
    }

    // -- Navi Nodes ----------------------------------------------------------

    /**
     * Tree datagrid Ship B -- NaviNode list endpoint now accepts a `parentId`
     * to drive lazy tree expansion:
     *
     *   - `parentId === 'root'`       -> only nodes with `parent IS NULL`
     *   - `parentId === '{uuid}'`     -> direct children of that node
     *   - `parentId === undefined`    -> legacy flat listing (kept so Newman
     *                                    and any cross-module reader keep
     *                                    behaving the same)
     *
     * Every response carries `hasChildren` and a coarse `nodeType` field
     * (`'group'` / `'leaf'`) the datagrid uses for the chevron + icon.
     */
    getNaviNodes(
        treeSlug: string,
        params: { filters?: string[]; sort?: string; parentId?: string } = {},
    ): Observable<NaviNodeDto[]> {
        const url = resolvePattern(this.manifest.navi!.nodesByTree, { slug: treeSlug });
        let httpParams = new HttpParams();
        if (params.sort)     httpParams = httpParams.set('sort',   params.sort);
        if (params.parentId) httpParams = httpParams.set('parent', params.parentId);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<NaviNodeDto>>(url, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    createNaviNode(dto: CreateNaviNodeDto): Observable<NaviNodeDto> {
        return this.http.post<NaviNodeDto>(this.manifest.navi!.nodesCreate, dto);
    }

    updateNaviNode(id: string, dto: UpdateNaviNodeDto): Observable<NaviNodeDto> {
        const url = resolvePattern(this.manifest.navi!.nodesItem, { id });
        return this.http.patch<NaviNodeDto>(url, dto, this.patchHeaders);
    }

    deleteNaviNode(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.navi!.nodesItem, { id });
        return this.http.delete<void>(url);
    }

    reorderNaviNodes(items: Array<{ id: string; sortOrder: number }>): Observable<void> {
        return this.http.patch<void>(this.manifest.navi!.nodesReorder, { items }, this.patchHeaders);
    }
}
