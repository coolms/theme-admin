// Cut from the shell's api/api.service.ts on 2026-09-21: the Realtime/Centrifugo (connection and subscription tokens, through core-angular's RealtimeTokenClient) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, RealtimeTokenClient, type CentrifugoConnectionTokenDto, type CentrifugoSubscriptionTokenDto } from '@coolms/core-angular';

@Injectable({ providedIn: 'root' })
export class CentrifugoApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly realtime = inject(RealtimeTokenClient);
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    /**
     * sub-phase 2b -- exchange the user's auth session for a
     * short-lived Centrifugo connection token signed with the
     * backend's HMAC secret. Returned shape carries `token` (the JWT
     * to hand to centrifuge-js), `expiresAt` (Unix seconds) for
     * refresh scheduling, `ttl` for convenience, and `wsUrl` so the
     * caller has everything needed to connect in one response.
     */
    getCentrifugoConnectionToken(): Observable<CentrifugoConnectionTokenDto> {
        return this.realtime.connectionToken();
    }

    /**
     * Sub-phase O -- fetch a per-channel subscription token for a
     * `private`-namespace channel. The centrifuge SDK invokes this
     * through its `getToken` callback at subscribe time and again
     * before expiry. The backend validates channel ownership against
     * the current user before signing.
     */
    getCentrifugoSubscriptionToken(channel: string): Observable<CentrifugoSubscriptionTokenDto> {
        return this.realtime.subscriptionToken(channel);
    }
}
