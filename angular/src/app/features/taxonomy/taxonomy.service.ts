import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/**
 * One taxonomy node as serialized by the backend `TaxonomyNodeResource`
 * (`/api/v1/taxonomy/nodes`). `lft`/`rgt`/`level` are the nested-set columns —
 * the server orders the collection by `lft`, so the flat list is already in
 * depth-first order and the tree can be rebuilt from `parentId`.
 */
export interface TaxonomyNodeDto {
    readonly id:       string;
    readonly label:    string;
    readonly slug:     string;
    readonly treeId:   string | null;
    readonly parentId: string | null;
    readonly level:    number;
    readonly lft:      number;
    readonly rgt:      number;
    readonly type:     string;
}

/** A taxonomy tree (`/api/v1/taxonomy/trees`) — the container categories live in. */
export interface TaxonomyTreeDto {
    readonly id:    string;
    readonly label: string;
    readonly code:  string;
}

/** POST body for {@link TaxonomyService.createNode}. */
export interface CreateTaxonomyNodeInput {
    readonly label:     string;
    readonly slug:      string;
    readonly treeId:    string;
    readonly parentId?: string | null;
}

/**
 * PUT body for {@link TaxonomyService.updateNode}. Always send the full triple:
 * the backend processor re-parents whenever `parentId` differs from the node's
 * current parent, so a rename must echo the current `parentId` (else the node
 * would be silently moved to root) and a move must echo the current label/slug.
 */
export interface UpdateTaxonomyNodeInput {
    readonly label:    string;
    readonly slug:     string;
    readonly parentId: string | null;
}

/**
 * Feature-local API client for the Taxonomy REST surface — small and
 * self-contained (not on the shared ApiService), mirroring {@link LeadsService}.
 * Talks to `/taxonomy/{trees,nodes}` off the generic `manifest.apiBase`.
 */
@Injectable({ providedIn: 'root' })
export class TaxonomyService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** All nodes in a tree (by code), nested-set ordered by the server. */
    listNodes(treeCode: string): Observable<TaxonomyNodeDto[]> {
        return this.http
            .get<HydraCollection<TaxonomyNodeDto>>(`${this.apiBase}/taxonomy/nodes`, {
                params: new HttpParams().set('tree', treeCode),
            })
            .pipe(map(res => res.member ?? []));
    }

    /** Resolve a tree by its machine code — its id is needed to create root nodes. */
    findTreeByCode(code: string): Observable<TaxonomyTreeDto | null> {
        return this.http
            .get<HydraCollection<TaxonomyTreeDto>>(`${this.apiBase}/taxonomy/trees`)
            .pipe(map(res => (res.member ?? []).find(t => t.code === code) ?? null));
    }

    createNode(input: CreateTaxonomyNodeInput): Observable<TaxonomyNodeDto> {
        return this.http.post<TaxonomyNodeDto>(`${this.apiBase}/taxonomy/nodes`, input);
    }

    updateNode(id: string, input: UpdateTaxonomyNodeInput): Observable<TaxonomyNodeDto> {
        return this.http.put<TaxonomyNodeDto>(
            `${this.apiBase}/taxonomy/nodes/${encodeURIComponent(id)}`,
            input,
        );
    }

    deleteNode(id: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/taxonomy/nodes/${encodeURIComponent(id)}`);
    }
}
