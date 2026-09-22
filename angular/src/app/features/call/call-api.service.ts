// Cut from the shell's api/api.service.ts on 2026-09-21: the Call (/call/*) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type CallRecordDto,
    type CallOriginateRequest,
    type CallOriginateDto,
    type WebPhoneConfigDto,
} from './call.types';

@Injectable({ providedIn: 'root' })
export class CallApiService {
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
     * Page the read-only call history (`GET /call/records`).
     * A verbatim shape-copy of {@link listSchedulesPage}: server-side paginated +
     * RQL-filterable, `?limit=N` (the RQL parser ignores `pageSize`), JSON-LD.
     */
    listCallRecordsPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: CallRecordDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/call/records`;
        let params = new HttpParams();
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;
        params = params.set('page', String(page));
        params = params.set('limit', String(pageSize)); // RQL parser reads ?limit=N
        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }
        return this.http
            .get<HydraCollection<CallRecordDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    /**
     * Fetch one tracked call by id (`GET /call/records/{id}`).
     * Plain JSON (like {@link getSchedule}); the item op returns the
     * CallRecordResource projection.
     */
    getCallRecord(id: string): Observable<CallRecordDto> {
        const url = `${this.manifest.apiBase}/call/records/${encodeURIComponent(id)}`;
        return this.http.get<CallRecordDto>(url);
    }

    /**
     * Stream a call's `.wav` recording (`GET
     * /call/records/{id}/recording`). The admin is a Bearer SPA, so a plain
     * `<audio src>` can't carry the token -- this goes through HttpClient
     * (the auth interceptor attaches the Bearer) as a Blob the caller turns
     * into an object URL (mirrors {@link exportCalendarIcs}).
     */
    downloadCallRecording(id: string): Observable<Blob> {
        const url = `${this.manifest.apiBase}/call/records/${encodeURIComponent(id)}/recording`;
        return this.http.get(url, { responseType: 'blob' as const });
    }

    /**
     * Click-to-dial (`POST /call/originate`). Rings the caller's
     * own device (`endpoint`, e.g. `PJSIP/1001`), then bridges it out to the
     * dialled `extension`; the backend fills the dialplan context. Returns the
     * created channel id (the same call soon pops on the incoming-call overlay).
     */
    originateCall(body: CallOriginateRequest): Observable<CallOriginateDto> {
        const url = `${this.manifest.apiBase}/call/originate`;
        return this.http.post<CallOriginateDto>(url, body);
    }

    /**
     * The browser softphone's connection descriptor (WSS URI + SIP
     * identity + owner-only password). `enabled` is false where no WebRTC PBX is
     * configured or the user has no device, in which case the softphone stays dormant.
     */
    getWebPhoneConfig(): Observable<WebPhoneConfigDto> {
        const url = `${this.manifest.apiBase}/call/webphone/config`;
        return this.http.get<WebPhoneConfigDto>(url);
    }
}
