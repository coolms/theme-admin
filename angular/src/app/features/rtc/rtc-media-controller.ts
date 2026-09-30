import { Injectable, Signal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { RtcService } from './rtc.service';
import { RtcMediaKind, RtcSignal } from './rtc.types';

/**
 * Which side of the call this peer is (placed it, or was rung) -- for the overlay.
 * It does NOT decide the negotiation role: the server names the polite peer
 * (`politeUserId`) and {@link RtcMediaController.start} is handed the answer.
 */
export type RtcCallRole = 'caller' | 'callee';

/**
 * Fallback ICE servers if `GET /rtc/ice-servers` (Slice 4c) can't be reached -- a
 * public STUN, enough for same-network / dev (host + server-reflexive
 * candidates). Normal operation fetches the server's configuration, which adds
 * the authenticated Coturn TURN relay (ephemeral creds from the F1 secret store)
 * for cross-NAT when it is deployed; this keeps calls working if that fetch fails.
 */
const RTC_FALLBACK_ICE_SERVERS: readonly RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** The ICE username fragments a description was generated with -- one per media section, usually one. */
function iceUfrags(sdp: string | undefined): string[] {
    return [...(sdp ?? '').matchAll(/^a=ice-ufrag:(\S+)/gm)].map(m => m[1]);
}

/** The ICE username fragment a remote candidate belongs to: its own field, else the candidate line's `ufrag`. */
function candidateUfrag(candidate: RTCIceCandidateInit): string | null {
    const own = candidate.usernameFragment ?? '';
    const named = own !== '' ? own : / ufrag (\S+)/.exec(candidate.candidate ?? '')?.[1] ?? '';
    return named !== '' ? named : null;
}

/**
 * The MEDIA plane, Slice 4b audio - Slice 4d video) -- the real WebRTC
 * behind the seam {@link RtcCallService} drives. On connect it acquires local
 * capture (mic always; a camera track too when the call's `mediaKind` is
 * `video`), builds a 1:1 {@link RTCPeerConnection}, and negotiates via the
 * **perfect-negotiation** pattern (glare-safe): both peers add their tracks, and
 * the polite peer yields on a collision (rolls back and answers) while the
 * impolite one keeps its offer. WHICH peer is polite is the server's to say
 * (`politeUserId`: the callee) and the orchestrator hands it in -- this controller
 * never derives it, because two clients each applying a rule can disagree and
 * end up both polite or both impolite. SDP + ICE ride the same
 * `POST /rtc/calls/{id}/signal` relay that {@link RtcService.sendSignal} already
 * exposes; inbound envelopes arrive via {@link handleSignal}.
 *
 * Remote AUDIO always plays through a detached `<audio>` element this controller
 * owns, so playback is independent of the overlay's render lifecycle -- for BOTH
 * audio and video calls. Remote/local VIDEO is surfaced via the `remoteStream` /
 * `localStream` signals, which the overlay binds to `<video>` elements (both
 * muted, so the audio never doubles with the `<audio>` sink). The control-plane
 * contract (start / handleSignal / toggleMute / stop + `remoteStream` /
 * `micMuted`) never changed; Slice 4d ADDED `localStream` / `cameraOff` /
 * `toggleCamera`, and Slice 4g ADDED `toggleScreenShare` / `screenSharing` (screen
 * capture swapped onto the outgoing video via `replaceTrack`) -- so
 * {@link RtcCallService} still needs no edit.
 */
@Injectable({ providedIn: 'root' })
export class RtcMediaController {
    /** Early signals kept per controller at most: a call's offer, answer and candidates are a few dozen. */
    private static readonly MAX_PENDING = 200;

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
    /**
     * Signals that arrived before this call's media was ready -- before {@link start} was even
     * called (the orchestrator reads the call first, and the peer's offer can land during that
     * read) or while start awaited the microphone and the ICE configuration. Each is kept with
     * its call, and start applies that call's, in order, once the peer connection holds the
     * local tracks. They used to be dropped when start had not been called yet: the peer's
     * OFFER was lost, the impolite side never offers again, and the call never connected --
     * the same defect as the ICE candidates (#50), one step earlier.
     */
    private readonly pending: { callId: string; signal: RtcSignal }[] = [];
    /**
     * True while start applies the held signals. A signal that arrives meanwhile is queued behind
     * them rather than applied at once: an SDP applied beside the drain would race the held one.
     */
    private draining = false;
    /** Whether this call has already been told, once, that the pending queue was full. */
    private warnedFull = false;
    /** Remote ICE candidates that arrived before the remote description; applied right after it. */
    private readonly remoteCandidates: RTCIceCandidateInit[] = [];
    /** The ICE username fragments of the offers this side ignored in a collision: their candidates are dropped. */
    private readonly ignoredUfrags = new Set<string>();

    private readonly _remoteStream = signal<MediaStream | null>(null);
    private readonly _localStream = signal<MediaStream | null>(null);
    private readonly _micMuted = signal<boolean>(false);
    private readonly _cameraOff = signal<boolean>(false);
    private readonly _screenSharing = signal<boolean>(false);
    readonly remoteStream: Signal<MediaStream | null> = this._remoteStream.asReadonly();
    /**
     * The local self-view stream the overlay binds to a muted `<video>` -- the camera
     * capture on a video call, or the SCREEN while {@link screenSharing} is on.
     */
    readonly localStream: Signal<MediaStream | null> = this._localStream.asReadonly();
    readonly micMuted: Signal<boolean> = this._micMuted.asReadonly();
    readonly cameraOff: Signal<boolean> = this._cameraOff.asReadonly();
    /** True while this peer is sharing its screen (drives the overlay stage + button state). */
    readonly screenSharing: Signal<boolean> = this._screenSharing.asReadonly();

    /**
     * Begin the media session for a now-connected call: capture -> peer connection ->
     * negotiate. `polite` is whether the server named THIS user the polite peer.
     */
    async start(callId: string, polite: boolean, mediaKind: RtcMediaKind): Promise<void> {
        if (this.pc !== null) {
            return; // already running
        }
        this.callId = callId;
        this.polite = polite;
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

        // Fetch the server's ICE configuration (STUN + TURN when deployed) for THIS call: the
        // ephemeral TURN credential is issued per call, to its participants only, so this is
        // done here, not once at construction.
        const iceServers = await this.resolveIceServers(callId);
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

        // Apply this call's signalling that raced ahead of its media, in the order it came, one
        // at a time; what arrives meanwhile joins the end of the queue, so the order holds to the
        // last. Another call's is dropped here -- defensive: the orchestrator's stop() has
        // already emptied the queue before a new call starts. Ends at once if the call does.
        this.draining = true;
        try {
            while (this.pc === pc) {
                const held = this.pending.shift();
                if (held === undefined) {
                    break;
                }
                if (held.callId === callId) {
                    await this.applySignal(pc, held.signal);
                }
            }
        } finally {
            if (this.pc === pc) {
                this.draining = false;
            }
        }
    }

    /** Apply an inbound SDP/ICE envelope from the peer -- kept for later if this call's media is not ready. */
    handleSignal(callId: string, signal: RtcSignal): void {
        if (this.pc !== null && this.callId !== callId) {
            return; // another call's, while this one runs
        }
        if (this.pc !== null && !this.draining) {
            void this.applySignal(this.pc, signal);
            return;
        }
        // Not started, still starting, or still applying what was held: queue it for start(),
        // behind the rest. Bounded, so a call whose media never starts cannot hold signals
        // without end -- and said once, so a runaway is visible.
        if (this.pending.length < RtcMediaController.MAX_PENDING) {
            this.pending.push({ callId, signal });
        } else if (!this.warnedFull) {
            this.warnedFull = true;
            console.warn('[rtc] ' + RtcMediaController.MAX_PENDING + ' signals are already held for a call whose media '
                + 'has not started; this ' + signal.type + ' and any after it are dropped');
        }
    }

    /**
     * The server's word on who is polite, refreshed from a later read of the call (every
     * `call.state` carries it). Fixed for a call by the server; this only keeps the
     * controller on what the server last said.
     */
    setPolite(callId: string, polite: boolean): void {
        if (this.callId === callId) {
            this.polite = polite;
        }
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
     * by REPLACING the outgoing camera track (video call -- no renegotiation) or, if
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
            // The call ended while the picker was open (or no video track) -- abandon.
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
        this.draining = false;
        this.warnedFull = false;
        this.remoteCandidates.length = 0;
        this.ignoredUfrags.clear();
        this._localStream.set(null);
        this._micMuted.set(false);
        this._cameraOff.set(false);
        this._screenSharing.set(false);
    }

    /**
     * Fetch the server's ICE configuration for this call (STUN + a TURN relay with an
     * ephemeral credential issued to the call's participants, when configured); fall back to
     * the static public STUN if the endpoint can't be reached -- or refuses, as for a call that
     * ended meanwhile -- so a call still connects on the same network.
     */
    private async resolveIceServers(callId: string): Promise<RTCIceServer[]> {
        try {
            const config = await firstValueFrom(this.rtc.getCallIceServers(callId));
            if (config.iceServers.length > 0) {
                return config.iceServers;
            }
        } catch {
            // Endpoint unreachable / errored -- degrade to the static STUN fallback.
        }

        return [...RTC_FALLBACK_ICE_SERVERS];
    }

    private async applySignal(pc: RTCPeerConnection, signal: RtcSignal): Promise<void> {
        try {
            if (signal.type === 'candidate') {
                const candidate = signal.payload as RTCIceCandidateInit;
                // A candidate belongs to the remote description it came with; before that is set
                // the browser refuses it ("The remote description was null") and it is LOST. With
                // one network interface -- a container, a phone -- it can be the only path, and the
                // call never connects. Held, and applied as soon as the description is in -- the
                // answer's too, which can arrive while the offer before it is still being ignored.
                if (pc.remoteDescription === null) {
                    if (this.ignoreOffer && candidateUfrag(candidate) === null) {
                        return; // names no ICE session: taken for the ignored offer's, as perfect negotiation does
                    }
                    this.remoteCandidates.push(candidate);
                    return;
                }
                await this.addCandidate(pc, candidate);
                return;
            }

            // offer / answer -- perfect-negotiation collision handling.
            const description = signal.payload as RTCSessionDescriptionInit;
            const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
            this.ignoreOffer = !this.polite && collision;
            if (this.ignoreOffer) {
                // The impolite peer keeps its own offer. The polite one rolls its offer back and
                // answers with ICE credentials of its own (Chrome 150, measured), so a candidate of
                // the ignored offer can never be used: it is dropped, whether held or still to come.
                iceUfrags(description.sdp).forEach(ufrag => this.ignoredUfrags.add(ufrag));
                return;
            }

            await pc.setRemoteDescription(description); // implicit rollback if we had a local offer
            for (const candidate of this.remoteCandidates.splice(0)) {
                await this.addCandidate(pc, candidate);
            }
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

    private async addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
        // An ignored offer's candidate, unless the description now held shares its ICE session.
        const ufrag = candidateUfrag(candidate);
        if (ufrag !== null && this.ignoredUfrags.has(ufrag) && !iceUfrags(pc.remoteDescription?.sdp).includes(ufrag)) {
            return;
        }
        try {
            await pc.addIceCandidate(candidate);
        } catch (err) {
            if (!this.ignoreOffer) {
                console.error('[rtc] addIceCandidate failed', err);
            }
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
