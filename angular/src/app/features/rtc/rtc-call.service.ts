import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { EMPTY, Observable, Subscription, distinctUntilChanged, map, switchMap } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { RtcCallRole, RtcMediaController } from './rtc-media-controller';
import { RtcSfuMediaController } from './rtc-sfu-media-controller';
import { RtcLiveEventsService } from './rtc-live-events.service';
import { RtcService } from './rtc.service';
import { RtcCallChannelNudge, RtcCallDto, RtcCallState, RtcIncomingCallNudge, RtcMediaKind } from './rtc.types';

/** The overlay's view of what's happening — a local UI state atop the server {@link RtcCallState}. */
export type RtcUiState = 'ringing-out' | 'ringing-in' | 'connecting' | 'connected' | 'ended';

export interface ActiveCall {
    readonly callId: string;
    readonly conversationId: string;
    readonly role: RtcCallRole;
    readonly peerName: string | null;
    readonly peerUserId: string | null;
    readonly mediaKind: RtcMediaKind;
    readonly ui: RtcUiState;
    readonly endReason: string | null;
    readonly connectedAtMs: number | null;
    /**
     * Which media plane this call uses once connected ( hybrid): `mesh` for
     * 1:1 (the P2P {@link RtcMediaController}), `sfu` for a group of 3+ (the
     * {@link RtcSfuMediaController}); null until media starts. The overlay reads
     * this to render the 1:1 stage vs the group tile grid.
     */
    readonly topology: 'mesh' | 'sfu' | null;
    /**
     * Whether the group call's media room is being recorded ( G8c) — the
     * notify-by-default `● REC` consent indicator. Mirrors the server's
     * `recordingActive`; reconciled from every REST read + refreshed on a
     * while-connected state nudge (a peer toggling it).
     */
    readonly recording: boolean;
}

/**
 * The call-CONTROL orchestrator, Slice 4a) — the single owner of "is
 * there a call, and what's its state". It:
 *
 *  - subscribes to `rtc.user.{myId}` for the whole session so an INCOMING call
 *    raises the ring overlay wherever the user is;
 *  - drives place / answer / decline / hangup through {@link RtcService};
 *  - subscribes to the active call's `rtc.call.{id}` channel to follow lifecycle
 *    `call.state` nudges + forward `call.signal` SDP/ICE to the media plane;
 *  - invokes {@link RtcMediaController} at connect / signal / end (the seam the
 *    Slice-4b WebRTC media plugs into — no `RTCPeerConnection` here yet).
 *
 * Exactly one call at a time in 4a: a second incoming ring while busy is ignored.
 * All realtime is best-effort — a dropped nudge is reconciled by the REST reads.
 */
@Injectable({ providedIn: 'root' })
export class RtcCallService {
    private readonly rtc = inject(RtcService);
    private readonly live = inject(RtcLiveEventsService);
    private readonly media = inject(RtcMediaController);
    private readonly sfu = inject(RtcSfuMediaController);
    private readonly toast = inject(ToastService);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    private readonly _activeCall = signal<ActiveCall | null>(null);
    readonly activeCall: Signal<ActiveCall | null> = this._activeCall.asReadonly();

    /** RxJS subscription to the current call's channel; torn down on clear. */
    private callSub: Subscription | null = null;
    /** Pending auto-dismiss timer for a terminal call. */
    private endTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        // Listen for incoming calls for the whole session; re-subscribe on user change.
        this.store
            .select(AuthState.currentUser)
            .pipe(
                map(user => user?.id ?? null),
                distinctUntilChanged(),
                switchMap(id => (id !== null ? this.live.watchUserRing(id) : EMPTY)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({ next: nudge => this.onIncoming(nudge), error: () => undefined });
    }

    /** Place an outgoing call into a conversation. `peerName` is the callee's label for the overlay. */
    place(conversationId: string, mediaKind: RtcMediaKind, peerName: string | null = null): void {
        if (this._activeCall() !== null) {
            return; // already in / ringing a call
        }
        this.rtc.place(conversationId, mediaKind).subscribe({
            next: call => {
                this.setActive({
                    callId: call.id,
                    conversationId: call.conversationId,
                    role: 'caller',
                    peerName,
                    peerUserId: null,
                    mediaKind: call.mediaKind,
                    ui: this.uiFor('caller', call.state, 'ringing-out'),
                    endReason: call.endReason,
                    connectedAtMs: null,
                    topology: null,
                    recording: call.recordingActive,
                });
                this.watchCall(call.id);
            },
            error: () => this.clear(),
        });
    }

    /** Accept the incoming call. */
    answer(): void {
        const call = this._activeCall();
        if (call === null || call.role !== 'callee') {
            return;
        }
        this.patch({ ui: 'connecting' });
        this.rtc.answer(call.callId).subscribe({
            next: dto => this.reconcile(dto),
            error: () => this.hangup(),
        });
    }

    /** Reject the incoming call. */
    decline(): void {
        const call = this._activeCall();
        if (call === null) {
            return;
        }
        this.rtc.decline(call.callId).subscribe({ next: () => undefined, error: () => undefined });
        this.clear();
    }

    /** Leave / cancel the current call. */
    hangup(): void {
        const call = this._activeCall();
        if (call === null) {
            return;
        }
        this.rtc.hangup(call.callId).subscribe({ next: () => undefined, error: () => undefined });
        this.clear();
    }

    /**
     * Start recording the connected GROUP call's media room ( G8c) — the
     * notify-by-default consent surface's control. Group-only (recording rides the
     * SFU); a no-op unless connected + SFU + not already recording. A recorder that
     * isn't deployed answers 503 -> a toast, so the button degrades cleanly.
     */
    startRecording(): void {
        const call = this._activeCall();
        if (call === null || call.ui !== 'connected' || call.topology !== 'sfu' || call.recording) {
            return;
        }
        this.rtc.startRecording(call.callId).subscribe({
            next: dto => this.patch({ recording: dto.recordingActive }),
            error: () => this.toast.error('Call recording is not available.'),
        });
    }

    /** Stop the call's in-progress recording. */
    stopRecording(): void {
        const call = this._activeCall();
        if (call === null || !call.recording) {
            return;
        }
        this.rtc.stopRecording(call.callId).subscribe({
            next: dto => this.patch({ recording: dto.recordingActive }),
            error: () => this.toast.error('Could not stop the recording.'),
        });
    }

    /**
     * Fetch a FINISHED group-call recording as a Bearer-authorised blob (
     * G8f/G8g). Thin passthrough to {@link RtcService}; the caller (the Messages
     * timeline) triggers the browser save. Surfaced from the `:rec:ready` timeline
     * notice the ingest posts once the artifact lands. Any active call is
     * irrelevant — this reads a past call's recording by id.
     */
    downloadRecording(callId: string): Observable<Blob> {
        return this.rtc.downloadRecording(callId);
    }

    private onIncoming(nudge: RtcIncomingCallNudge): void {
        if (this._activeCall() !== null) {
            return; // busy — 4a ignores a second call
        }
        this.setActive({
            callId: nudge.callId,
            conversationId: nudge.conversationId,
            role: 'callee',
            peerName: null,
            peerUserId: nudge.fromUserId,
            mediaKind: nudge.mediaKind,
            ui: 'ringing-in',
            endReason: null,
            connectedAtMs: null,
            topology: null,
            recording: false,
        });
        this.watchCall(nudge.callId);
    }

    private watchCall(callId: string): void {
        this.callSub?.unsubscribe();
        this.callSub = this.live.watchCall(callId).subscribe({
            next: nudge => this.onCallNudge(nudge),
            error: () => undefined,
        });
    }

    private onCallNudge(nudge: RtcCallChannelNudge): void {
        const call = this._activeCall();
        if (call === null || nudge.callId !== call.callId) {
            return;
        }
        if (nudge.type === 'call.signal') {
            this.media.handleSignal(call.callId, nudge.signal);
            return;
        }
        this.applyState(nudge.state);
    }

    /** Fold a REST call response back into the active-call view (used after answer()). */
    private reconcile(dto: RtcCallDto): void {
        if (this._activeCall()?.callId !== dto.id) {
            return;
        }
        this.patch({ recording: dto.recordingActive });
        this.applyState(dto.state);
    }

    private applyState(state: RtcCallState): void {
        const call = this._activeCall();
        if (call === null) {
            return;
        }
        if (state === 'connected') {
            if (call.ui !== 'connected') {
                this.patch({ ui: 'connected', connectedAtMs: Date.now() });
                this.startMedia(call);
            } else {
                // Already connected — a `call.state` nudge here signals a
                // while-connected change (e.g. a peer toggled recording); refresh the
                // recording flag from REST since the nudge carries only the lifecycle.
                this.refreshRecording(call.callId);
            }
            return;
        }
        if (state === 'ringing') {
            return; // still ringing; nothing to change
        }
        // Terminal: ended / declined / missed / cancelled — show briefly, then dismiss.
        this.patch({ ui: 'ended', endReason: state });
        this.media.stop();
        this.sfu.stop();
        this.scheduleDismiss();
    }

    /**
     * Start the media plane for a now-connected call, choosing the topology
     * ( hybrid): 3+ active participants -> the SFU group controller, else
     * the 1:1 P2P mesh. The roster comes from a fresh `GET /rtc/calls/{id}` read
     * (state nudges carry only the lifecycle, not the count); on error we fall back
     * to the mesh so a two-party call is never blocked by a failed read.
     */
    private startMedia(call: ActiveCall): void {
        this.rtc.get(call.callId).subscribe({
            next: dto => {
                const active = dto.participants.filter(p => p.state === 'invited' || p.state === 'joined');
                if (active.length >= 3) {
                    this.patch({ topology: 'sfu' });
                    void this.sfu.start(call.callId, call.mediaKind);
                } else {
                    this.patch({ topology: 'mesh' });
                    void this.media.start(call.callId, call.role, call.mediaKind);
                }
            },
            error: () => {
                this.patch({ topology: 'mesh' });
                void this.media.start(call.callId, call.role, call.mediaKind);
            },
        });
    }

    /** Refresh the recording flag from a fresh REST read (the state nudge omits it). */
    private refreshRecording(callId: string): void {
        this.rtc.get(callId).subscribe({
            next: dto => {
                if (this._activeCall()?.callId === callId) {
                    this.patch({ recording: dto.recordingActive });
                }
            },
            error: () => undefined,
        });
    }

    private uiFor(role: RtcCallRole, state: RtcCallState, ringing: RtcUiState): RtcUiState {
        if (state === 'connected') {
            return 'connected';
        }
        if (state === 'ringing') {
            return ringing;
        }
        return 'ended';
    }

    private setActive(call: ActiveCall): void {
        this.cancelDismiss();
        this._activeCall.set(call);
    }

    private patch(partial: Partial<ActiveCall>): void {
        const current = this._activeCall();
        if (current !== null) {
            this._activeCall.set({ ...current, ...partial });
        }
    }

    private scheduleDismiss(): void {
        this.cancelDismiss();
        this.endTimer = setTimeout(() => this.clear(), 1400);
    }

    private cancelDismiss(): void {
        if (this.endTimer !== null) {
            clearTimeout(this.endTimer);
            this.endTimer = null;
        }
    }

    private clear(): void {
        this.cancelDismiss();
        this.callSub?.unsubscribe();
        this.callSub = null;
        this.media.stop();
        this.sfu.stop();
        this._activeCall.set(null);
    }
}
