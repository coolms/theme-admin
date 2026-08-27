import { Injectable, Signal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
    LocalTrackPublication,
    Participant,
    RemoteParticipant,
    RemoteTrack,
    Room,
} from 'livekit-client';

import { ToastService } from '@coolms/ui-angular';
import { RtcService } from './rtc.service';
import { RtcMediaKind, RtcSfuParticipant } from './rtc.types';

/** One remote tile's mutable state, keyed by participant identity in {@link RtcSfuMediaController}. */
interface Tile {
    name: string;
    videoStream: MediaStream | null;
    speaking: boolean;
}

/**
 * The GROUP media plane (ADR-144, Track B group calling) — the SFU counterpart of
 * the 1:1 {@link RtcMediaController} P2P mesh. For a call with 3+ participants the
 * {@link RtcCallService} orchestrator drives THIS controller instead: it fetches
 * the LiveKit join credentials from `GET /rtc/calls/{id}/media-token` (the ADR-144
 * G2 endpoint) and connects to the SFU, where each client sends ONE uplink and the
 * server forwards the others — so group video scales where a mesh cannot.
 *
 * The `Call` aggregate stays the authority: the backend mints the join token ONLY
 * for an active participant (room = the call id), so the SFU never authorises on
 * its own; if no SFU is deployed the token endpoint 503s and {@link start} surfaces
 * an unavailable toast rather than a broken call. LiveKit handles its own signalling
 * over its WebSocket, so — unlike the mesh — there is no SDP/ICE `handleSignal` here.
 *
 * `livekit-client` is loaded via a dynamic `import()` inside {@link start}, so the
 * SDK is code-split out of the main bundle (only fetched when a group call actually
 * starts) and never evaluated during SSR. The control contract mirrors the mesh
 * controller's surface (start / stop / toggleMute / toggleCamera / toggleScreenShare
 * + `micMuted` / `cameraOff` / `screenSharing`), plus the group-grid signals the
 * overlay renders: `participants` (remote tiles), `localVideoStream` (the self-view)
 * and `localSpeaking`.
 *
 * Tiles are PARTICIPANT-driven, not track-driven: a tile appears the moment a remote
 * party joins (seeded from `room.remoteParticipants` at connect + `ParticipantConnected`
 * after), so a participant whose camera is off still shows as an avatar tile — their
 * video simply fills in when they enable it. Their audio always plays through a
 * detached `<audio>` element regardless of the tile's render.
 */
@Injectable({ providedIn: 'root' })
export class RtcSfuMediaController {
    private readonly rtc = inject(RtcService);
    private readonly toast = inject(ToastService);

    private room: Room | null = null;
    /** Remote video tiles keyed by participant identity. */
    private readonly tiles = new Map<string, Tile>();
    /** Attached remote AUDIO elements keyed by track id, so playback survives re-render. */
    private readonly audioEls = new Map<string, HTMLMediaElement>();
    /** The LiveKit camera track source (`Track.Source.Camera`), captured from the dynamic import. */
    private cameraSource: string | null = null;

    private readonly _participants = signal<readonly RtcSfuParticipant[]>([]);
    private readonly _connecting = signal<boolean>(false);
    private readonly _micMuted = signal<boolean>(false);
    private readonly _cameraOff = signal<boolean>(false);
    private readonly _screenSharing = signal<boolean>(false);
    private readonly _localVideoStream = signal<MediaStream | null>(null);
    private readonly _localSpeaking = signal<boolean>(false);
    /** The remote parties + their live video, driving the overlay's tile grid. */
    readonly participants: Signal<readonly RtcSfuParticipant[]> = this._participants.asReadonly();
    /** True while joining the room (before the first remote track arrives). */
    readonly connecting: Signal<boolean> = this._connecting.asReadonly();
    readonly micMuted: Signal<boolean> = this._micMuted.asReadonly();
    readonly cameraOff: Signal<boolean> = this._cameraOff.asReadonly();
    readonly screenSharing: Signal<boolean> = this._screenSharing.asReadonly();
    /** The local camera track for the overlay's self-tile; null while the camera is off. */
    readonly localVideoStream: Signal<MediaStream | null> = this._localVideoStream.asReadonly();
    /** True while the local participant is an active speaker (self-tile highlight). */
    readonly localSpeaking: Signal<boolean> = this._localSpeaking.asReadonly();

    /** Join the call's SFU media room: fetch credentials → connect → publish → subscribe. */
    async start(callId: string, mediaKind: RtcMediaKind): Promise<void> {
        if (this.room !== null) {
            return; // already joined
        }
        this._connecting.set(true);
        try {
            const creds = await firstValueFrom(this.rtc.getMediaToken(callId));
            const { Room, RoomEvent, Track } = await import('livekit-client');
            this.cameraSource = Track.Source.Camera;
            const room = new Room({ adaptiveStream: true, dynacast: true });
            this.room = room;

            room
                .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => this.addTile(participant.identity, participant.name))
                .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => this.removeTile(participant.identity))
                .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => this.onTrackSubscribed(track, participant))
                .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => this.onTrackUnsubscribed(track, participant))
                .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => this.onLocalTrackPublished(pub))
                .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => this.onLocalTrackUnpublished(pub))
                .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => this.onActiveSpeakers(speakers))
                .on(RoomEvent.Disconnected, () => this.teardown());

            await room.connect(creds.url, creds.token);
            // Seed tiles for parties already in the room, so the grid is populated
            // even for a participant who joined camera-off (their video fills in later).
            room.remoteParticipants.forEach(p => this.addTile(p.identity, p.name));
            this.publishTiles();

            await room.localParticipant.setMicrophoneEnabled(true);
            this._cameraOff.set(mediaKind !== 'video');
            if (mediaKind === 'video') {
                await room.localParticipant.setCameraEnabled(true);
            }
        } catch {
            this.toast.error('Group calling is unavailable.');
            this.teardown();
        } finally {
            this._connecting.set(false);
        }
    }

    toggleMute(): void {
        const room = this.room;
        if (room === null) {
            return;
        }
        const muted = this._micMuted();
        // setMicrophoneEnabled(true) = unmuted; enable when currently muted.
        void room.localParticipant.setMicrophoneEnabled(muted);
        this._micMuted.set(!muted);
    }

    toggleCamera(): void {
        const room = this.room;
        if (room === null) {
            return;
        }
        const off = this._cameraOff();
        void room.localParticipant.setCameraEnabled(off);
        this._cameraOff.set(!off);
    }

    toggleScreenShare(): void {
        const room = this.room;
        if (room === null) {
            return;
        }
        const sharing = this._screenSharing();
        void room.localParticipant.setScreenShareEnabled(!sharing);
        this._screenSharing.set(!sharing);
    }

    /** Leave the room + release everything (idempotent; safe when not joined). */
    stop(): void {
        const room = this.room;
        if (room === null) {
            return;
        }
        void room.disconnect();
        this.teardown();
    }

    private onTrackSubscribed(track: RemoteTrack, participant: RemoteParticipant): void {
        if (track.mediaStreamTrack.kind === 'video') {
            const tile = this.ensureTile(participant.identity, participant.name);
            tile.videoStream = new MediaStream([track.mediaStreamTrack]);
            this.publishTiles();
            return;
        }
        // Remote audio: keep a tile for the party + attach a detached element so it
        // plays regardless of render.
        this.ensureTile(participant.identity, participant.name);
        this.publishTiles();
        this.audioEls.set(track.mediaStreamTrack.id, track.attach());
    }

    private onTrackUnsubscribed(track: RemoteTrack, participant: RemoteParticipant): void {
        if (track.mediaStreamTrack.kind === 'video') {
            const tile = this.tiles.get(participant.identity);
            if (tile !== undefined) {
                // Keep the tile (the party is still here) — just drop the video → avatar.
                tile.videoStream = null;
                this.publishTiles();
            }
            return;
        }
        const key = track.mediaStreamTrack.id;
        const el = this.audioEls.get(key);
        if (el !== undefined) {
            track.detach(el);
            this.audioEls.delete(key);
        }
    }

    private onLocalTrackPublished(pub: LocalTrackPublication): void {
        if (pub.source !== this.cameraSource) {
            return; // ignore the screen-share (and any non-camera) local track
        }
        const track = pub.track?.mediaStreamTrack;
        if (track !== undefined) {
            this._localVideoStream.set(new MediaStream([track]));
        }
    }

    private onLocalTrackUnpublished(pub: LocalTrackPublication): void {
        if (pub.source === this.cameraSource) {
            this._localVideoStream.set(null);
        }
    }

    private onActiveSpeakers(speakers: Participant[]): void {
        const speaking = new Set(speakers.map(s => s.identity));
        for (const [identity, tile] of this.tiles) {
            tile.speaking = speaking.has(identity);
        }
        const localId = this.room?.localParticipant.identity;
        this._localSpeaking.set(localId !== undefined && speaking.has(localId));
        this.publishTiles();
    }

    private addTile(identity: string, name: string | undefined): void {
        if (!this.tiles.has(identity)) {
            this.tiles.set(identity, { name: name ?? '', videoStream: null, speaking: false });
            this.publishTiles();
        }
    }

    private ensureTile(identity: string, name: string | undefined): Tile {
        const label = name ?? ''; // RemoteParticipant.name is optional in livekit-client
        let tile = this.tiles.get(identity);
        if (tile === undefined) {
            tile = { name: label, videoStream: null, speaking: false };
            this.tiles.set(identity, tile);
        } else if (label !== '' && tile.name !== label) {
            tile.name = label; // a name that only became known on a later event
        }
        return tile;
    }

    private removeTile(identity: string): void {
        if (this.tiles.delete(identity)) {
            this.publishTiles();
        }
    }

    private publishTiles(): void {
        this._participants.set(
            [...this.tiles.entries()].map(([identity, tile]) => ({
                identity,
                name: tile.name,
                videoStream: tile.videoStream,
                speaking: tile.speaking,
            })),
        );
    }

    /** Release local references + reset UI signals (does NOT re-disconnect the room). */
    private teardown(): void {
        this.audioEls.forEach(el => {
            el.srcObject = null;
            el.remove();
        });
        this.audioEls.clear();
        this.tiles.clear();
        this.room = null;
        this.cameraSource = null;
        this._participants.set([]);
        this._micMuted.set(false);
        this._cameraOff.set(false);
        this._screenSharing.set(false);
        this._localVideoStream.set(null);
        this._localSpeaking.set(false);
    }
}
