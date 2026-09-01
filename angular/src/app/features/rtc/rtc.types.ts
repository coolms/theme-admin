/**
 * Voice/Video— WebRTC calling DTOs + realtime nudge shapes (Slice 4a,
 * the call-control plane). These mirror the `Rtc` backend: the REST resource
 * (`RtcCallResource`) and the three payloads the backend publishes on the Rtc
 * Centrifugo channels (`rtc.user.{id}` ring + `rtc.call.{id}` state/signal).
 */

export type RtcMediaKind = 'audio' | 'video';

/** Server-side call lifecycle (mirrors the backend `CallState`). */
export type RtcCallState = 'ringing' | 'connected' | 'ended' | 'declined' | 'missed' | 'cancelled';

export interface RtcCallParticipantDto {
    readonly userId: string;
    readonly state: 'invited' | 'joined' | 'declined' | 'left';
    readonly joinedAt: string | null;
    readonly leftAt: string | null;
}

/** `GET /rtc/calls/{id}` + the body returned by place/answer/decline/hangup. */
export interface RtcCallDto {
    readonly id: string;
    readonly conversationId: string;
    readonly initiatorUserId: string;
    readonly mediaKind: RtcMediaKind;
    readonly state: RtcCallState;
    readonly connectedAt: string | null;
    readonly endedAt: string | null;
    readonly endReason: string | null;
    /** Whether the call's media room is currently being recorded. */
    readonly recordingActive: boolean;
    readonly createdAt: string | null;
    readonly participants: readonly RtcCallParticipantDto[];
}

/** An SDP/ICE signalling envelope relayed via `POST /rtc/calls/{id}/signal`. */
export interface RtcSignal {
    readonly type: 'offer' | 'answer' | 'candidate';
    readonly payload: unknown;
    /** Optional targeted peer (mesh routing); omitted for a 1:1 call. */
    readonly to?: string;
}

/** `rtc.user.{myId}` — someone is calling me (published at place time). */
export interface RtcIncomingCallNudge {
    readonly type: 'call.incoming';
    readonly callId: string;
    readonly conversationId: string;
    readonly fromUserId: string;
    readonly mediaKind: RtcMediaKind;
}

/** `rtc.call.{id}` — the call's lifecycle changed; reconcile via REST. */
export interface RtcCallStateNudge {
    readonly type: 'call.state';
    readonly callId: string;
    readonly state: RtcCallState;
}

/** `rtc.call.{id}` — a peer relayed an SDP/ICE envelope (media plane, Slice 4b). */
export interface RtcSignalNudge {
    readonly type: 'call.signal';
    readonly callId: string;
    readonly from: string;
    readonly signal: RtcSignal;
}

export type RtcCallChannelNudge = RtcCallStateNudge | RtcSignalNudge;

/**
 * `GET /rtc/ice-servers` (Slice 4c) — the ICE configuration for the media plane:
 * STUN always, plus a Coturn TURN relay with a short-lived ephemeral credential
 * when TURN is configured server-side. `iceServers` is passed straight to
 * `new RTCPeerConnection({ iceServers })`; `ttlSeconds` is 0 when STUN-only.
 */
export interface RtcIceServersDto {
    readonly iceServers: RTCIceServer[];
    readonly ttlSeconds: number;
}

/**
 * `GET /rtc/calls/{id}/media-token` ( Slice G2) — the join credentials for
 * a GROUP call's SFU media room: the LiveKit endpoint the browser connects to, a
 * short-lived signed token scoped to this call's room + the caller, and the room
 * name + identity. Fed to the LiveKit JS client (`Room.connect(url, token)`). The
 * endpoint 503s when no SFU is deployed, so a group call degrades cleanly.
 */
export interface RtcMediaTokenDto {
    readonly id: string;
    readonly url: string;
    readonly token: string;
    readonly room: string;
    readonly identity: string;
    readonly ttlSeconds: number;
}

/** One remote party in an SFU group call — a video tile the overlay renders. */
export interface RtcSfuParticipant {
    /** The participant identity (their user id) within the LiveKit room. */
    readonly identity: string;
    /** Their display name (from the LiveKit token's `name` claim), or '' when unknown. */
    readonly name: string;
    /** Their live video, or null when they have no camera / it's off. */
    readonly videoStream: MediaStream | null;
    /** True while they are the/an active speaker (drives a highlight ring). */
    readonly speaking: boolean;
}
