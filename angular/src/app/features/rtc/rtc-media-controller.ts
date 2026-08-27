import { Injectable, Signal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { RtcService } from './rtc.service';
import { RtcMediaKind, RtcSignal } from './rtc.types';

/** Which side of the negotiation this peer is — drives the polite/impolite roles. */
export type RtcCallRole = 'caller' | 'callee';

/**
 * Fallback ICE servers if `GET /rtc/ice-servers` (Slice 4c) can't be reached — a
 * public STUN, enough for same-network / dev (host + server-reflexive
 * candidates). Normal operation fetches the server's configuration, which adds
 * the authenticated Coturn TURN relay (ephemeral creds from the F1 secret store)
 * for cross-NAT when it is deployed; this keeps calls working if that fetch fails.
 */
const RTC_FALLBACK_ICE_SERVERS: readonly RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * The MEDIA plane (Track B, Slice 4b audio · Slice 4d video) — the real WebRTC
 * behind the seam {@link RtcCallService} drives. On connect it acquires local
 * capture (mic always; a camera track too when the call's `mediaKind` is
 * `video`), builds a 1:1 {@link RTCPeerConnection}, and negotiates via the
 * **perfect-negotiation** pattern (glare-safe): both peers add their tracks, and
 * role decides who yields on a collision (the CALLER is impolite and wins, the
 * CALLEE is polite and rolls back). SDP + ICE ride the same
 * `POST /rtc/calls/{id}/signal` relay that {@link RtcService.sendSignal} already
 * exposes; inbound envelopes arrive via {@link handleSignal}.
 *
 * Remote AUDIO always plays through a detached `<audio>` element this controller
 * owns, so playback is independent of the overlay's render lifecycle — for BOTH
 * audio and video calls. Remote/local VIDEO is surfaced via the `remoteStream` /
 * `localStream` signals, which the overlay binds to `<video>` elements (both
 * muted, so the audio never doubles with the `<audio>` sink). The control-plane
 * contract (start / handleSignal / toggleMute / stop + `remoteStream` /
 * `micMuted`) never changed; Slice 4d ADDED `localStream` / `cameraOff` /
 * `toggleCamera`, and Slice 4g ADDED `toggleScreenShare` / `screenSharing` (screen
 * capture swapped onto the outgoing video via `replaceTrack`) — so
 * {@link RtcCallService} still needs no edit.
 */
@Injectable({ providedIn: 'root' })
export class RtcMediaController {
    private readonly rtc = inject(RtcService);
    private readonly toast = inject(ToastService);

    private pc: RTCPeerConnection | null = null;
    private localCapture: MediaStream | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private callId: string | null = null;

    // Screen-share (Slice 4g): the getDisplayMedia stream + the sender it flows
    // through + the camera track it displaced (null on an audio call, where the
    // screen track is ADDED rather than swapped in).
    private screenStream: MediaStream | null = null;
    private screenSender: RTCRtpSender | null = null;
    private cameraTrack: MediaStreamTrack | null = null;

    // Perfect-negotiation state (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example).
    private polite = false;
    private makingOffer = false;
    private ignoreOffer = false;
    /** SDP/ICE that arrived before the peer connection existed; drained on start. */
    private readonly pending: RtcSignal[] = [];

    private readonly _remoteStream = signal<MediaStream | null>(null);
    private readonly _localStream = signal<MediaStream | null>(null);
    private readonly _micMuted = signal<boolean>(false);
    private readonly _cameraOff = signal<boolean>(false);
    private readonly _screenSharing = signal<boolean>(false);
    readonly remoteStream: Signal<MediaStream | null> = this._remoteStream.asReadonly();
    /**
     * The local self-view stream the overlay binds to a muted `<video>` — the camera
     * capture on a video call, or the SCREEN while {@link screenSharing} is on.
     */
    readonly localStream: Signal<MediaStream | null> = this._localStream.asReadonly();
    readonly micMuted: Signal<boolean> = this._micMuted.asReadonly();
    readonly cameraOff: Signal<boolean> = this._cameraOff.asReadonly();
    /** True while this peer is sharing its screen (drives the overlay stage + button state). */
    readonly screenSharing: Signal<boolean> = this._screenSharing.asReadonly();

    /** Begin the media session for a now-connected call: capture → peer connection → negotiate. */
    async start(callId: string, role: RtcCallRole, mediaKind: RtcMediaKind): Promise<void> {
        if (this.pc !== null) {
            return; // already running
        }
        this.callId = callId;
        this.polite = role === 'callee';
        const wantsVideo = mediaKind === 'video';

        try {
            // Audio always; a camera track only for a video call.
            this.localCapture = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo });
            this._localStream.set(this.localCapture);
        } catch {
            this.toast.error(wantsVideo
                ? 'Camera and microphone access are required for video calls.'
                : 'Microphone access is required for calls.');
        }
        if (this.callId !== callId) {
            // The call ended while we were awaiting the mic; abandon.
            this.localCapture?.getTracks().forEach(t => t.stop());
            this.localCapture = null;
            this._localStream.set(null);
            return;
        }

        // Fetch the server's ICE configuration (STUN + TURN when deployed); the
        // ephemeral TURN credential is minted per call, so this is done here, not
        // once at construction.
        const iceServers = await this.resolveIceServers();
        if (this.callId !== callId) {
            // The call ended while we were fetching ICE config; abandon.
            this.localCapture?.getTracks().forEach(t => t.stop());
            this.localCapture = null;
            this._localStream.set(null);
            return;
        }

        const pc = new RTCPeerConnection({ iceServers });
        this.pc = pc;

        pc.onicecandidate = ({ candidate }): void => {
            if (candidate !== null) {
                this.send({ type: 'candidate', payload: candidate.toJSON() });
            }
        };
        pc.ontrack = ({ streams }): void => this.attachRemote(streams[0] ?? null);
        pc.onnegotiationneeded = async (): Promise<void> => {
            try {
                this.makingOffer = true;
                await pc.setLocalDescription();
                if (pc.localDescription !== null) {
                    this.send({ type: 'offer', payload: pc.localDescription });
                }
            } catch (err) {
                console.error('[rtc] negotiation failed', err);
            } finally {
                this.makingOffer = false;
            }
        };

        for (const track of this.localCapture?.getTracks() ?? []) {
            pc.addTrack(track, this.localCapture!);
        }

        // Apply any signalling that raced ahead of the peer connection.
        const queued = this.pending.splice(0);
        for (const signal of queued) {
            await this.applySignal(pc, signal);
        }
    }

    /** Apply an inbound SDP/ICE envelope from the peer (queued if we're not ready yet). */
    handleSignal(callId: string, signal: RtcSignal): void {
        if (this.callId !== callId) {
            return;
        }
        if (this.pc === null) {
            this.pending.push(signal);
            return;
        }
        void this.applySignal(this.pc, signal);
    }

    /** Toggle the local microphone (mutes the outbound audio track). */
    toggleMute(): void {
        const track = this.localCapture?.getAudioTracks()[0];
        if (track !== undefined) {
            track.enabled = !track.enabled;
            this._micMuted.set(!track.enabled);
        } else {
            this._micMuted.update(m => !m);
        }
    }

    /** Toggle the local camera on a video call (disables the outbound video track). */
    toggleCamera(): void {
        const track = this.localCapture?.getVideoTracks()[0];
        if (track !== undefined) {
            track.enabled = !track.enabled;
            this._cameraOff.set(!track.enabled);
        } else {
            this._cameraOff.update(off => !off);
        }
    }

    /** Start or stop sharing the local screen with the peer. */
    async toggleScreenShare(): Promise<void> {
        if (this._screenSharing()) {
            await this.stopScreenShare();
        } else {
            await this.startScreenShare();
        }
    }

    /**
     * Share the screen: capture it via `getDisplayMedia`, then send it to the peer
     * by REPLACING the outgoing camera track (video call — no renegotiation) or, if
     * there is no video track yet (audio call), ADDING it (perfect-negotiation
     * handles the resulting offer). The local self-view switches to the screen, and
     * the browser's own "Stop sharing" affordance (the track's `ended` event) tears
     * it back down. A no-op if the picker is cancelled or the call ended meanwhile.
     */
    private async startScreenShare(): Promise<void> {
        if (this.pc === null) {
            return;
        }

        // Snapshot the call we're sharing into; if it changes across the (async)
        // picker, the call ended meanwhile and we abandon (checking `callId` rather
        // than `this.pc`, which the type system still treats as non-null here).
        const callId = this.callId;
        let display: MediaStream;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } catch {
            return; // cancelled the picker, or denied — a normal no-op, no toast
        }

        const tracks = display.getVideoTracks();
        if (this.callId !== callId || tracks.length === 0) {
            // The call ended while the picker was open (or no video track) — abandon.
            display.getTracks().forEach(t => t.stop());
            return;
        }
        const screenTrack = tracks[0];

        const videoSender = this.pc.getSenders().find(s => s.track !== null && s.track.kind === 'video');
        if (videoSender !== undefined) {
            this.cameraTrack = videoSender.track; // stash the camera to restore on stop
            await videoSender.replaceTrack(screenTrack);
            this.screenSender = videoSender;
        } else {
            this.cameraTrack = null; // audio call — nothing to restore to
            this.screenSender = this.pc.addTrack(screenTrack, display);
        }

        this.screenStream = display;
        screenTrack.onended = (): void => void this.stopScreenShare();
        this._localStream.set(display); // self-view shows what we're sharing
        this._screenSharing.set(true);
    }

    /** Stop screen-sharing: restore the camera (or stop sending video) + release the capture. */
    private async stopScreenShare(): Promise<void> {
        if (!this._screenSharing()) {
            return;
        }

        // Restore the camera on a video call, else just stop sending video.
        await this.screenSender?.replaceTrack(this.cameraTrack);
        this.screenStream?.getTracks().forEach(t => t.stop());
        this.screenStream = null;
        this.screenSender = null;
        this.cameraTrack = null;
        this._localStream.set(this.localCapture);
        this._screenSharing.set(false);
    }

    /** Tear down the peer connection, release capture, and stop remote playback. */
    stop(): void {
        this.pc?.close();
        this.pc = null;
        this.localCapture?.getTracks().forEach(t => t.stop());
        this.localCapture = null;
        this.screenStream?.getTracks().forEach(t => t.stop());
        this.screenStream = null;
        this.screenSender = null;
        this.cameraTrack = null;
        this.detachRemote();
        this.callId = null;
        this.polite = false;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.pending.length = 0;
        this._localStream.set(null);
        this._micMuted.set(false);
        this._cameraOff.set(false);
        this._screenSharing.set(false);
    }

    /**
     * Fetch the server's ICE configuration (STUN + a TURN relay with an ephemeral
     * credential when configured); fall back to the static public STUN if the
     * endpoint can't be reached, so a call still connects on the same network.
     */
    private async resolveIceServers(): Promise<RTCIceServer[]> {
        try {
            const config = await firstValueFrom(this.rtc.getIceServers());
            if (config.iceServers.length > 0) {
                return config.iceServers;
            }
        } catch {
            // Endpoint unreachable / errored — degrade to the static STUN fallback.
        }

        return [...RTC_FALLBACK_ICE_SERVERS];
    }

    private async applySignal(pc: RTCPeerConnection, signal: RtcSignal): Promise<void> {
        try {
            if (signal.type === 'candidate') {
                try {
                    await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
                } catch (err) {
                    if (!this.ignoreOffer) {
                        console.error('[rtc] addIceCandidate failed', err);
                    }
                }
                return;
            }

            // offer / answer — perfect-negotiation collision handling.
            const description = signal.payload as RTCSessionDescriptionInit;
            const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
            this.ignoreOffer = !this.polite && collision;
            if (this.ignoreOffer) {
                return; // the impolite peer keeps its own offer
            }

            await pc.setRemoteDescription(description); // implicit rollback if we had a local offer
            if (description.type === 'offer') {
                await pc.setLocalDescription();
                if (pc.localDescription !== null) {
                    this.send({ type: 'answer', payload: pc.localDescription });
                }
            }
        } catch (err) {
            console.error('[rtc] applySignal failed', err);
        }
    }

    private send(signal: RtcSignal): void {
        const callId = this.callId;
        if (callId === null) {
            return;
        }
        this.rtc.sendSignal(callId, signal).subscribe({ error: () => undefined });
    }

    private attachRemote(stream: MediaStream | null): void {
        this._remoteStream.set(stream);
        if (stream === null) {
            return;
        }
        if (this.audioEl === null) {
            this.audioEl = document.createElement('audio');
            this.audioEl.autoplay = true;
            this.audioEl.style.display = 'none';
            document.body.appendChild(this.audioEl);
        }
        this.audioEl.srcObject = stream;
        void this.audioEl.play().catch(() => undefined);
    }

    private detachRemote(): void {
        if (this.audioEl !== null) {
            this.audioEl.srcObject = null;
            this.audioEl.remove();
            this.audioEl = null;
        }
        this._remoteStream.set(null);
    }
}
