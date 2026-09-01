import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import {
    Invitation,
    Inviter,
    Registerer,
    RegistererState,
    Session,
    SessionState,
    UserAgent,
    UserAgentOptions,
} from 'sip.js';
import { SessionDescriptionHandler as WebSessionDescriptionHandler } from 'sip.js/lib/platform/web';

import { ApiService } from '../../api/api.service';

export type WebPhoneStatus = 'idle' | 'disabled' | 'connecting' | 'registered' | 'failed';

/**
 * The in-browser softphone.
 *
 * Makes the browser a real SIP endpoint: it REGISTERs to Asterisk `res_pjsip`
 * over a secure WebSocket (the descriptor from `GET /call/webphone/config` — C.1
 * coordinates + the C.2 owner-only password), negotiates DTLS-SRTP media using
 * the shared Coturn ICE servers (`GET /rtc/ice-servers`, reused), and rings /
 * answers real INVITEs. Answering + audio happen in the tab — no desk phone.
 *
 * **Dormant when disabled:** if the config isn't `enabled` (no WebRTC PBX, or the
 * user has no provisioned credential) the service never registers and shows no
 * UI — the softphone degrades invisibly where telephony WebRTC isn't deployed.
 * The `calls.*` Centrifugo screen-pop + Call history stay the awareness/history
 * layer above this media plane.
 *
 * Single-call model (v1): one active SIP session at a time; a second incoming
 * INVITE while busy is rejected.
 *
 * Requires a WS(S)-capable Asterisk. The dev rig has one since —
 * plain `ws://localhost:8088/ws`, legal because `http://localhost` is a secure
 * context, so no certificate is involved (docker/asterisk/pjsip.conf). A real
 * deployment must terminate TLS and serve `wss://`; browsers refuse `ws://` from
 * any non-localhost origin. Dial 600 on the rig for Asterisk's echo test — the
 * one extension that exercises DTLS-SRTP + ICE end to end.
 */
@Injectable({ providedIn: 'root' })
export class WebPhoneService {
    private readonly api = inject(ApiService);
    private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    /** Registration status; the overlay only shows Answer/Hangup when `registered`. */
    readonly status = signal<WebPhoneStatus>('idle');
    /** True while an inbound INVITE is ringing (not yet answered). */
    readonly incoming = signal(false);
    /** True while a session is connected (established). */
    readonly inCall = signal(false);
    /** The remote party's display name / user, for the in-call label. */
    readonly peerName = signal<string>('');

    private ua: UserAgent | null = null;
    private registerer: Registerer | null = null;
    /** The current inbound/active session (one at a time). */
    private session: Session | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private started = false;

    /** Boot the softphone once (called from the admin shell after sign-in). */
    async start(): Promise<void> {
        if (!this.isBrowser || this.started) {
            return;
        }
        this.started = true;

        try {
            const config = await firstValueFrom(this.api.getWebPhoneConfig());
            if (!config.enabled || !config.password || !config.wssUrl || !config.authorizationUser) {
                this.status.set('disabled');
                return;
            }

            this.status.set('connecting');
            const iceServers = await this.resolveIceServers();
            const uri = UserAgent.makeURI(`sip:${config.authorizationUser}@${config.sipDomain}`);
            if (!uri) {
                this.status.set('failed');
                return;
            }

            const options: UserAgentOptions = {
                uri,
                transportOptions: { server: config.wssUrl },
                authorizationUsername: config.authorizationUser,
                authorizationPassword: config.password,
                displayName: config.displayName || config.authorizationUser,
                delegate: { onInvite: invitation => this.onInvite(invitation) },
                sessionDescriptionHandlerFactoryOptions: {
                    peerConnectionConfiguration: { iceServers },
                },
            };

            this.ua = new UserAgent(options);
            await this.ua.start();

            this.registerer = new Registerer(this.ua);
            this.registerer.stateChange.addListener(state => {
                if (state === RegistererState.Registered) {
                    this.status.set('registered');
                } else if (state === RegistererState.Terminated) {
                    this.status.set('failed');
                }
            });
            await this.registerer.register();
        } catch {
            this.status.set('failed');
        }
    }

    /** Accept the ringing inbound call (audio-only). */
    async answer(): Promise<void> {
        const session = this.session;
        if (!(session instanceof Invitation)) {
            return;
        }
        try {
            await session.accept({
                sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
            });
        } catch {
            /* declined by the far end, or media setup failed */
        }
    }

    /** Reject a ringing call, cancel an outbound one, or hang up an active one. */
    async hangup(): Promise<void> {
        const session = this.session;
        if (!session) {
            return;
        }
        try {
            switch (session.state) {
                case SessionState.Initial:
                case SessionState.Establishing:
                    if (session instanceof Invitation) {
                        await session.reject();
                    } else if (session instanceof Inviter) {
                        await session.cancel();
                    }
                    break;
                case SessionState.Established:
                    await session.bye();
                    break;
                default:
                    break;
            }
        } catch {
            /* already terminating */
        }
    }

    /** Send a DTMF tone on the active call (keypad during a call). */
    sendDtmf(tone: string): void {
        const sdh = this.session?.sessionDescriptionHandler as WebSessionDescriptionHandler | undefined;
        sdh?.sendDtmf(tone);
    }

    private onInvite(invitation: Invitation): void {
        // One call at a time — a second incoming INVITE while busy is rejected.
        if (this.session) {
            void invitation.reject();
            return;
        }
        this.session = invitation;
        this.peerName.set(
            invitation.remoteIdentity.displayName || invitation.remoteIdentity.uri.user || 'Caller',
        );
        this.incoming.set(true);
        invitation.stateChange.addListener(state => this.onSessionState(invitation, state));
    }

    private onSessionState(session: Session, state: SessionState): void {
        switch (state) {
            case SessionState.Established:
                this.incoming.set(false);
                this.inCall.set(true);
                this.attachRemoteAudio(session);
                break;
            case SessionState.Terminated:
                this.cleanupSession();
                break;
            default:
                break;
        }
    }

    /** Pipe the remote audio track into a hidden <audio> sink. */
    private attachRemoteAudio(session: Session): void {
        const sdh = session.sessionDescriptionHandler as WebSessionDescriptionHandler | undefined;
        const pc = sdh?.peerConnection;
        if (!pc) {
            return;
        }
        const remote = new MediaStream();
        for (const receiver of pc.getReceivers()) {
            if (receiver.track) {
                remote.addTrack(receiver.track);
            }
        }
        const el = this.audioSink();
        el.srcObject = remote;
        void el.play().catch(() => {
            /* autoplay may be blocked until a user gesture — the Answer click covers it */
        });
    }

    private cleanupSession(): void {
        this.session = null;
        this.incoming.set(false);
        this.inCall.set(false);
        this.peerName.set('');
        if (this.audioEl) {
            this.audioEl.srcObject = null;
        }
    }

    private audioSink(): HTMLAudioElement {
        if (!this.audioEl) {
            const el = document.createElement('audio');
            el.autoplay = true;
            el.style.display = 'none';
            document.body.appendChild(el);
            this.audioEl = el;
        }
        return this.audioEl;
    }

    private async resolveIceServers(): Promise<RTCIceServer[]> {
        try {
            const cfg = await firstValueFrom(this.api.getCallIceServers());
            return cfg.iceServers ?? [];
        } catch {
            return [];
        }
    }
}
