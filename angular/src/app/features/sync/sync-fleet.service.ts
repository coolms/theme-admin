import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
/** One registered edge node, as presented by `GET /sync/fleet`. */
export interface SyncEdgeDto {
    readonly slug: string;
    readonly name: string;
    readonly baseUrl: string;
    /** Secret-store REFERENCE (a name), never the raw push bearer. */
    readonly credentialRef: string | null;
    readonly enabled: boolean;
    /** Identity user UUID the edge authenticates AS inbound; null = unbound (cannot ack). */
    readonly principalRef: string | null;
    /** Selective-sync scope, v2 shape `{tiers?: [...], sections?: [...]}` (AND-composed); null = whole synced set. */
    readonly scope: { tiers?: string[]; sections?: string[] } | null;
    readonly cursor: number;
    readonly status: string;
    readonly lastSeenAt: string | null;
    readonly lastError: string | null;
}

/** Register / re-configure payload (upsert by slug, declared-state-wins). */
export interface RegisterEdgeRequest {
    readonly slug: string;
    readonly name: string;
    readonly url: string;
    readonly credentialRef?: string | null;
    readonly enabled?: boolean;
    /** UUID or email; omit to UNBIND (the edge then cannot ack). */
    readonly principal?: string | null;
    /** Tier names; omit for unrestricted tiers. */
    readonly scopeTiers?: string[] | null;
    /** Site-section slugs (B.3.4): the edge receives only those /content/<slug> subtrees; omit for all sections. */
    readonly scopeSections?: string[] | null;
}

/**
 * Sync fleet API client (ADR-150 B.3.2).
 *
 * Talks to the `sync_fleet`-gated `/api/v1/sync/fleet` surface — the operator
 * counterpart of `coolms:sync:edge:{register,list,remove}`. Feature-local
 * (mirrors BackupService). Register is an UPSERT with declared-state-wins
 * semantics: an omitted principal UNBINDS, an omitted scope clears it — the
 * dialog therefore always submits the full desired state.
 */
@Injectable({ providedIn: 'root' })
export class SyncFleetService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    listEdges(): Observable<SyncEdgeDto[]> {
        return this.http
            .get<{ edges: SyncEdgeDto[] }>(`${this.apiBase}/sync/fleet`)
            .pipe(map(res => res.edges ?? []));
    }

    registerEdge(req: RegisterEdgeRequest): Observable<SyncEdgeDto> {
        return this.http
            .post<{ edge: SyncEdgeDto }>(`${this.apiBase}/sync/fleet`, req)
            .pipe(map(res => res.edge));
    }

    /** Removing an edge releases its cursor from the feed's prune floor — gone, not paused. */
    removeEdge(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/sync/fleet/${encodeURIComponent(slug)}`);
    }

    /** Queue an async nudge of every enabled edge (202; the fan-out runs on a worker). */
    nudgeAll(): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/sync/fleet/nudge`, {});
    }
}
