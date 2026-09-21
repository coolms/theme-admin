// Cut from the shell's api/api.service.ts on 2026-09-21: the Rtc (/rtc/ice-servers) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest } from '@coolms/core-angular';
import {
    type CallIceServersDto,
} from './rtc-api.types';

@Injectable({ providedIn: 'root' })
export class RtcApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    /** ICE servers for the softphone peer connection (shared Coturn, reused). */
    getCallIceServers(): Observable<CallIceServersDto> {
        const url = `${this.manifest.apiBase}/rtc/ice-servers`;
        return this.http.get<CallIceServersDto>(url);
    }
}
