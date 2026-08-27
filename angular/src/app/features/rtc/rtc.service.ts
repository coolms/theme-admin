import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { RtcCallDto, RtcIceServersDto, RtcMediaKind, RtcMediaTokenDto, RtcSignal } from './rtc.types';

/**
 * Thin REST client over the `App\Rtc` calling API (Slice 3, `/api/v1/rtc/*`).
 * Standalone per-feature service like {@link MessagesService}. Auth headers are
 * attached by the global interceptor; body-less action ops send `{}`.
 */
@Injectable({ providedIn: 'root' })
export class RtcService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    private get jsonHeaders(): HttpHeaders {
        return new HttpHeaders({ Accept: 'application/json' });
    }

    /** POST /rtc/calls — place a call into a conversation; the backend seeds + rings the roster. */
    place(conversationId: string, mediaKind: RtcMediaKind): Observable<RtcCallDto> {
        return this.http.post<RtcCallDto>(`${this.apiBase}/rtc/calls`, { conversationId, mediaKind }, { headers: this.jsonHeaders });
    }

    /** GET /rtc/calls/{id} — read a call the current user participates in. */
    get(callId: string): Observable<RtcCallDto> {
        return this.http.get<RtcCallDto>(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}`, { headers: this.jsonHeaders });
    }

    answer(callId: string): Observable<RtcCallDto> {
        return this.action(callId, 'answer');
    }

    decline(callId: string): Observable<RtcCallDto> {
        return this.action(callId, 'decline');
    }

    hangup(callId: string): Observable<RtcCallDto> {
        return this.action(callId, 'hangup');
    }

    /** POST /rtc/calls/{id}/recording/start — begin recording the group call's media room (ADR-145). 503s when no recorder is deployed. */
    startRecording(callId: string): Observable<RtcCallDto> {
        return this.recording(callId, 'start');
    }

    /** POST /rtc/calls/{id}/recording/stop — stop the in-progress recording. */
    stopRecording(callId: string): Observable<RtcCallDto> {
        return this.recording(callId, 'stop');
    }

    /** POST /rtc/calls/{id}/signal — relay an SDP/ICE envelope to the call's peers (204). */
    sendSignal(callId: string, signal: RtcSignal): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}/signal`, signal, { headers: this.jsonHeaders });
    }

    /** GET /rtc/ice-servers — the STUN/TURN configuration for the peer connection (Slice 4c). */
    getIceServers(): Observable<RtcIceServersDto> {
        return this.http.get<RtcIceServersDto>(`${this.apiBase}/rtc/ice-servers`, { headers: this.jsonHeaders });
    }

    /**
     * GET /rtc/calls/{id}/media-token — the SFU join credentials for a GROUP call
     * (ADR-144 Slice G2); 503s when no SFU is deployed. Only an active participant
     * of the call may fetch it.
     */
    getMediaToken(callId: string): Observable<RtcMediaTokenDto> {
        return this.http.get<RtcMediaTokenDto>(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}/media-token`, { headers: this.jsonHeaders });
    }

    /**
     * GET /rtc/calls/{id}/recording — stream the finished group-call recording as a
     * Bearer-authorised blob (ADR-145 G8f; the interceptor attaches the token, a plain
     * `<a href>` can't). Only a PARTICIPANT of the call may fetch it; a missing /
     * non-participant / not-recorded call all → the same opaque 404. The caller triggers
     * the browser download from the blob.
     */
    downloadRecording(callId: string): Observable<Blob> {
        return this.http.get(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}/recording`, { responseType: 'blob' });
    }

    private action(callId: string, action: 'answer' | 'decline' | 'hangup'): Observable<RtcCallDto> {
        return this.http.post<RtcCallDto>(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}/${action}`, {}, { headers: this.jsonHeaders });
    }

    private recording(callId: string, action: 'start' | 'stop'): Observable<RtcCallDto> {
        return this.http.post<RtcCallDto>(`${this.apiBase}/rtc/calls/${encodeURIComponent(callId)}/recording/${action}`, {}, { headers: this.jsonHeaders });
    }
}
