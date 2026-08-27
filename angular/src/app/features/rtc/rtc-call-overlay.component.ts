import { ChangeDetectionStrategy, Component, DestroyRef, Signal, computed, inject, signal } from '@angular/core';

import { ActiveCall, RtcCallService } from './rtc-call.service';
import { RtcMediaController } from './rtc-media-controller';
import { RtcSfuMediaController } from './rtc-sfu-media-controller';
import { RtcSrcObjectDirective } from './rtc-src-object.directive';

/**
 * Global call overlay (Track B, Slice 4a control · 4d video · G4b group grid) —
 * mounted once in the admin shell so it floats above every route. Renders the single
 * {@link RtcCallService.activeCall}: an INCOMING ring card (Accept / Decline), an
 * OUTGOING "Calling…" bar (Cancel), a "Call ended" note, and — when connected — one
 * of three in-call surfaces chosen by the call's media topology (ADR-144 hybrid):
 *
 *  - a **group tile grid** (`topology === 'sfu'`, 3+ parties) — a self-tile plus one
 *    tile per remote participant (their live video, or an avatar when their camera is
 *    off), driven by {@link RtcSfuMediaController}'s `participants` / `localVideoStream`
 *    signals, with the shared mute / camera / share-screen / hang-up controls;
 *  - a floating 1:1 **video stage** (remote video + a mirrored self-view PiP) for a
 *    connected `mesh` video call (or while screen-sharing);
 *  - an in-call **bar** (mute + share-screen + hang up + live timer) for 1:1 audio.
 *
 * Real media rides {@link RtcMediaController} for the 1:1 mesh (Slice 4b audio / 4d
 * video / 4g screen-share) and {@link RtcSfuMediaController} for the SFU group; the
 * mute + camera + screen-share buttons drive whichever plane owns the active call.
 */
@Component({
    selector: 'app-rtc-call-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RtcSrcObjectDirective],
    template: `
        @if (call(); as c) {
          @if (c.ui === 'connected' && c.topology === 'sfu') {
            <div class="rtc-overlay rtc-overlay--group" role="dialog" aria-label="Group call">
                <div class="rtc-group">
                    <div class="rtc-group-head">
                        <span class="rtc-group-name">{{ title(c) }}</span>
                        <span class="rtc-group-meta">
                            @if (c.recording) {
                                <span class="rtc-rec" aria-label="Recording"><i class="bi bi-record-circle-fill"></i> REC</span>
                            }
                            <span class="rtc-group-time">{{ subtitle(c) }} · {{ sfu.participants().length + 1 }}</span>
                        </span>
                    </div>
                    @if (sfu.connecting() && sfu.participants().length === 0) {
                        <div class="rtc-group-connecting">Connecting…</div>
                    }
                    <div class="rtc-grid" [attr.data-count]="sfu.participants().length + 1">
                        <!-- Self tile: the local camera (mirrored), or an avatar when the camera is off. -->
                        <div class="rtc-tile rtc-tile--self" [class.rtc-tile--speaking]="sfu.localSpeaking()">
                            @if (sfu.cameraOff() || sfu.localVideoStream() === null) {
                                <div class="rtc-tile-avatar"><i class="bi bi-person-fill"></i></div>
                            } @else {
                                <video class="rtc-tile-video rtc-tile-video--self"
                                       [rtcSrcObject]="sfu.localVideoStream()" autoplay playsinline muted></video>
                            }
                            @if (sfu.micMuted()) {
                                <span class="rtc-tile-mic"><i class="bi bi-mic-mute-fill"></i></span>
                            }
                            <span class="rtc-tile-label">You</span>
                        </div>
                        <!-- One tile per remote party — their video, or an avatar while their camera is off.
                             Remote AUDIO plays through the controller's detached <audio> sinks, so these
                             <video> elements are MUTED to avoid doubling it. -->
                        @for (p of sfu.participants(); track p.identity) {
                            <div class="rtc-tile" [class.rtc-tile--speaking]="p.speaking">
                                @if (p.videoStream === null) {
                                    <div class="rtc-tile-avatar"><i class="bi bi-person-fill"></i></div>
                                } @else {
                                    <video class="rtc-tile-video" [rtcSrcObject]="p.videoStream" autoplay playsinline muted></video>
                                }
                                <span class="rtc-tile-label">{{ p.name || 'Guest' }}</span>
                            </div>
                        }
                    </div>
                    <div class="rtc-group-actions">
                        <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="sfu.micMuted()"
                                [title]="sfu.micMuted() ? 'Unmute' : 'Mute'" (click)="sfu.toggleMute()">
                            <i class="bi" [class.bi-mic-mute-fill]="sfu.micMuted()" [class.bi-mic-fill]="!sfu.micMuted()"></i>
                        </button>
                        @if (c.mediaKind === 'video') {
                            <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="sfu.cameraOff()"
                                    [title]="sfu.cameraOff() ? 'Turn camera on' : 'Turn camera off'" (click)="sfu.toggleCamera()">
                                <i class="bi" [class.bi-camera-video-off-fill]="sfu.cameraOff()" [class.bi-camera-video-fill]="!sfu.cameraOff()"></i>
                            </button>
                        }
                        <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="sfu.screenSharing()"
                                [title]="sfu.screenSharing() ? 'Stop sharing' : 'Share screen'" (click)="sfu.toggleScreenShare()">
                            <i class="bi" [class.bi-display-fill]="sfu.screenSharing()" [class.bi-display]="!sfu.screenSharing()"></i>
                        </button>
                        <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--rec]="c.recording"
                                [title]="c.recording ? 'Stop recording' : 'Record'" (click)="onToggleRecording(c)">
                            <i class="bi" [class.bi-record-circle-fill]="c.recording" [class.bi-record-circle]="!c.recording"></i>
                        </button>
                        <button type="button" class="rtc-btn rtc-btn--end" title="Hang up" (click)="rtc.hangup()">
                            <i class="bi bi-telephone-x-fill"></i>
                        </button>
                    </div>
                </div>
            </div>
          } @else if (c.ui === 'connected' && (c.mediaKind === 'video' || media.screenSharing())) {
            <div class="rtc-overlay rtc-overlay--video" role="dialog" aria-label="Video call">
                <div class="rtc-stage">
                    <!-- Remote video is MUTED: its audio plays through the media controller's
                         detached <audio> sink, so binding it here would double the audio. -->
                    <video class="rtc-remote" [rtcSrcObject]="media.remoteStream()" autoplay playsinline muted></video>
                    @if (media.remoteStream() === null) {
                        <div class="rtc-stage-connecting">Connecting…</div>
                    }
                    @if (media.cameraOff() && !media.screenSharing()) {
                        <div class="rtc-selfview rtc-selfview--off"><i class="bi bi-camera-video-off-fill"></i></div>
                    } @else {
                        <!-- A shared screen is NOT mirrored (unlike a self-camera). -->
                        <video class="rtc-selfview" [class.rtc-selfview--noflip]="media.screenSharing()"
                               [rtcSrcObject]="media.localStream()" autoplay playsinline muted></video>
                    }
                    @if (media.screenSharing()) {
                        <div class="rtc-stage-badge"><i class="bi bi-display-fill"></i> Sharing your screen</div>
                    }
                    <div class="rtc-stage-info">
                        <span class="rtc-stage-name">{{ title(c) }}</span>
                        <span class="rtc-stage-time">{{ subtitle(c) }}</span>
                    </div>
                    <div class="rtc-stage-actions">
                        <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="media.micMuted()"
                                [title]="media.micMuted() ? 'Unmute' : 'Mute'" (click)="media.toggleMute()">
                            <i class="bi" [class.bi-mic-mute-fill]="media.micMuted()" [class.bi-mic-fill]="!media.micMuted()"></i>
                        </button>
                        @if (c.mediaKind === 'video') {
                            <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="media.cameraOff()"
                                    [title]="media.cameraOff() ? 'Turn camera on' : 'Turn camera off'" (click)="media.toggleCamera()">
                                <i class="bi" [class.bi-camera-video-off-fill]="media.cameraOff()" [class.bi-camera-video-fill]="!media.cameraOff()"></i>
                            </button>
                        }
                        <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="media.screenSharing()"
                                [title]="media.screenSharing() ? 'Stop sharing' : 'Share screen'" (click)="onScreenShare()">
                            <i class="bi" [class.bi-display-fill]="media.screenSharing()" [class.bi-display]="!media.screenSharing()"></i>
                        </button>
                        <button type="button" class="rtc-btn rtc-btn--end" title="Hang up" (click)="rtc.hangup()">
                            <i class="bi bi-telephone-x-fill"></i>
                        </button>
                    </div>
                </div>
            </div>
          } @else {
            <div class="rtc-overlay" [class.rtc-overlay--incoming]="c.ui === 'ringing-in'" role="dialog" aria-live="assertive">
                <div class="rtc-card">
                    <div class="rtc-icon" [class.rtc-icon--pulse]="c.ui === 'ringing-in' || c.ui === 'ringing-out'">
                        <i class="bi" [class.bi-camera-video-fill]="c.mediaKind === 'video'" [class.bi-telephone-fill]="c.mediaKind !== 'video'"></i>
                    </div>

                    <div class="rtc-body">
                        <div class="rtc-title">{{ title(c) }}</div>
                        <div class="rtc-sub">{{ subtitle(c) }}</div>
                    </div>

                    <div class="rtc-actions">
                        @switch (c.ui) {
                            @case ('ringing-in') {
                                <button type="button" class="rtc-btn rtc-btn--accept" title="Accept" (click)="rtc.answer()">
                                    <i class="bi bi-telephone-fill"></i>
                                </button>
                                <button type="button" class="rtc-btn rtc-btn--end" title="Decline" (click)="rtc.decline()">
                                    <i class="bi bi-telephone-x-fill"></i>
                                </button>
                            }
                            @case ('connected') {
                                <button type="button" class="rtc-btn rtc-btn--mute" [class.rtc-btn--on]="media.micMuted()"
                                        [title]="media.micMuted() ? 'Unmute' : 'Mute'" (click)="media.toggleMute()">
                                    <i class="bi" [class.bi-mic-mute-fill]="media.micMuted()" [class.bi-mic-fill]="!media.micMuted()"></i>
                                </button>
                                <button type="button" class="rtc-btn rtc-btn--mute" title="Share screen" (click)="onScreenShare()">
                                    <i class="bi bi-display"></i>
                                </button>
                                <button type="button" class="rtc-btn rtc-btn--end" title="Hang up" (click)="rtc.hangup()">
                                    <i class="bi bi-telephone-x-fill"></i>
                                </button>
                            }
                            @case ('ended') {}
                            @default {
                                <button type="button" class="rtc-btn rtc-btn--end" title="Cancel" (click)="rtc.hangup()">
                                    <i class="bi bi-telephone-x-fill"></i>
                                </button>
                            }
                        }
                    </div>
                </div>
            </div>
          }
        }
    `,
    styles: [`
        .rtc-overlay {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2100;
        }
        .rtc-overlay--incoming {
            right: 50%;
            bottom: auto;
            top: 24px;
            transform: translateX(50%);
        }
        .rtc-card {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 280px;
            max-width: 92vw;
            padding: 12px 14px;
            background: var(--cms-surface);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
            animation: rtc-in .18s ease;
        }
        @keyframes rtc-in {
            from { transform: translateY(12px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        .rtc-overlay--incoming .rtc-card {
            transform: none;
            animation: rtc-drop .2s ease;
        }
        @keyframes rtc-drop {
            from { transform: translateY(-12px); opacity: 0; }
            to   { transform: translateY(0);     opacity: 1; }
        }
        .rtc-icon {
            flex: 0 0 auto;
            width: 40px; height: 40px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: color-mix(in srgb, var(--cms-primary, #2563eb) 14%, transparent);
            color: var(--cms-primary, #2563eb);
            font-size: 1.1rem;
        }
        .rtc-icon--pulse { animation: rtc-pulse 1.4s ease-in-out infinite; }
        @keyframes rtc-pulse {
            0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cms-primary, #2563eb) 40%, transparent); }
            50%      { box-shadow: 0 0 0 7px transparent; }
        }
        .rtc-body { flex: 1 1 auto; min-width: 0; }
        .rtc-title {
            font-size: .875rem; font-weight: 600; color: var(--cms-text);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rtc-sub { font-size: .75rem; color: var(--cms-text-secondary); margin-top: 1px; }
        .rtc-actions { flex: 0 0 auto; display: flex; gap: 8px; }
        .rtc-btn {
            width: 38px; height: 38px;
            display: flex; align-items: center; justify-content: center;
            border: none; border-radius: 50%;
            cursor: pointer; color: var(--cms-text-inverse); font-size: 1rem;
            transition: filter .12s ease;
        }
        .rtc-btn:hover { filter: brightness(1.08); }
        .rtc-btn--accept { background: var(--cms-success); }
        .rtc-btn--end    { background: var(--cms-danger); }
        .rtc-btn--mute   { background: var(--cms-text-muted, #6b7280); }
        .rtc-btn--mute.rtc-btn--on { background: var(--cms-warning, #d97706); }

        /* Video stage (Slice 4d) — a floating 1:1 call window. */
        .rtc-overlay--video { right: 16px; bottom: 16px; }
        .rtc-stage {
            position: relative;
            width: min(340px, 92vw);
            aspect-ratio: 3 / 4;
            background: #0b0f17;
            border-radius: var(--cms-radius);
            overflow: hidden;
            box-shadow: var(--cms-shadow-md);
            animation: rtc-in .18s ease;
        }
        .rtc-remote { width: 100%; height: 100%; object-fit: cover; background: #0b0f17; display: block; }
        .rtc-stage-connecting {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            color: rgba(255,255,255,.7); font-size: .85rem;
        }
        .rtc-selfview {
            position: absolute; top: 10px; right: 10px;
            width: 92px; aspect-ratio: 3 / 4; object-fit: cover;
            border-radius: 8px; border: 2px solid rgba(255,255,255,.7);
            background: #000;
            transform: scaleX(-1); /* mirror the local self-view, like a mirror */
        }
        .rtc-selfview--off {
            display: flex; align-items: center; justify-content: center;
            transform: none; color: rgba(255,255,255,.6); font-size: 1.1rem;
        }
        .rtc-selfview--noflip { transform: none; } /* a shared screen reads left-to-right */
        .rtc-stage-badge {
            position: absolute; left: 12px; bottom: 58px;
            display: inline-flex; align-items: center; gap: 6px;
            padding: 3px 9px; border-radius: 999px;
            background: color-mix(in srgb, var(--cms-primary, #2563eb) 85%, black);
            color: var(--cms-text-inverse); font-size: .72rem; font-weight: 600;
        }
        .rtc-stage-info {
            position: absolute; top: 10px; left: 12px; right: 112px;
            color: var(--cms-text-inverse); text-shadow: 0 1px 3px rgba(0,0,0,.6);
        }
        .rtc-stage-name {
            display: block; font-size: .85rem; font-weight: 600;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rtc-stage-time { display: block; font-size: .72rem; opacity: .85; }
        .rtc-stage-actions {
            position: absolute; left: 0; right: 0; bottom: 12px;
            display: flex; justify-content: center; gap: 12px;
        }

        /* Group tile grid (G4b) — a floating SFU call panel: self + one tile per party. */
        .rtc-overlay--group { right: 16px; bottom: 16px; }
        .rtc-group {
            display: flex; flex-direction: column;
            width: min(380px, 94vw);
            background: #0b0f17;
            border-radius: var(--cms-radius);
            overflow: hidden;
            box-shadow: var(--cms-shadow-md);
            animation: rtc-in .18s ease;
        }
        .rtc-group-head {
            display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
            padding: 10px 14px; color: var(--cms-text-inverse);
        }
        .rtc-group-name {
            flex: 1 1 auto; min-width: 0;
            font-size: .85rem; font-weight: 600;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rtc-group-meta { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
        .rtc-rec {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 1px 8px; border-radius: 999px;
            background: color-mix(in srgb, var(--cms-danger, #dc2626) 88%, black);
            color: var(--cms-text-inverse); font-size: .64rem; font-weight: 700; letter-spacing: .04em;
            animation: rtc-rec-blink 1.6s ease-in-out infinite;
        }
        @keyframes rtc-rec-blink { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        .rtc-btn--rec { background: var(--cms-danger, #dc2626); }
        .rtc-group-time { flex: 0 0 auto; font-size: .72rem; opacity: .8; }
        .rtc-group-connecting {
            padding: 22px; text-align: center;
            color: rgba(255,255,255,.7); font-size: .85rem;
        }
        .rtc-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
            padding: 0 10px;
            max-height: 46vh;
            overflow-y: auto;
        }
        .rtc-grid[data-count="1"] { grid-template-columns: 1fr; }
        .rtc-tile {
            position: relative;
            aspect-ratio: 4 / 3;
            background: #05070c;
            border-radius: 8px;
            overflow: hidden;
            border: 2px solid transparent;
        }
        .rtc-tile--speaking { border-color: var(--cms-success, #16a34a); }
        .rtc-tile-video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .rtc-tile-video--self { transform: scaleX(-1); } /* mirror the local self-view */
        .rtc-tile-avatar {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            color: rgba(255,255,255,.45); font-size: 1.7rem;
        }
        .rtc-tile-label {
            position: absolute; left: 6px; bottom: 5px;
            max-width: calc(100% - 12px);
            padding: 1px 7px; border-radius: 999px;
            background: rgba(0,0,0,.55); color: var(--cms-text-inverse); font-size: .68rem;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rtc-tile-mic {
            position: absolute; top: 6px; right: 6px;
            width: 22px; height: 22px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: color-mix(in srgb, var(--cms-warning, #d97706) 90%, black);
            color: var(--cms-text-inverse); font-size: .7rem;
        }
        .rtc-group-actions {
            display: flex; justify-content: center; gap: 12px;
            padding: 12px;
        }
    `],
})
export class RtcCallOverlayComponent {
    readonly rtc = inject(RtcCallService);
    readonly media = inject(RtcMediaController);
    readonly sfu = inject(RtcSfuMediaController);
    readonly call: Signal<ActiveCall | null> = this.rtc.activeCall;

    private readonly nowMs = signal(Date.now());

    constructor() {
        const timer = setInterval(() => this.nowMs.set(Date.now()), 1000);
        inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }

    private readonly elapsed = computed<string>(() => {
        const c = this.call();
        if (c?.connectedAtMs == null) {
            return '';
        }
        const total = Math.max(0, Math.floor((this.nowMs() - c.connectedAtMs) / 1000));
        const mm = Math.floor(total / 60).toString().padStart(2, '0');
        const ss = (total % 60).toString().padStart(2, '0');
        return `${mm}:${ss}`;
    });

    /** Sync wrapper for the async screen-share toggle (keeps the template handler void). */
    onScreenShare(): void {
        void this.media.toggleScreenShare();
    }

    /** Toggle recording on the group call — the notify-by-default consent control (ADR-145 G8c). */
    onToggleRecording(c: ActiveCall): void {
        if (c.recording) {
            this.rtc.stopRecording();
        } else {
            this.rtc.startRecording();
        }
    }

    title(c: ActiveCall): string {
        return c.peerName ?? (c.role === 'callee' ? 'Incoming call' : 'Call');
    }

    subtitle(c: ActiveCall): string {
        const kind = c.mediaKind === 'video' ? 'Video' : 'Audio';
        switch (c.ui) {
            case 'ringing-in':
                return `${kind} call…`;
            case 'ringing-out':
                return 'Calling…';
            case 'connecting':
                return 'Connecting…';
            case 'connected':
                return this.elapsed() || 'Connected';
            case 'ended':
                return this.endedLabel(c.endReason);
        }
    }

    private endedLabel(reason: string | null): string {
        switch (reason) {
            case 'declined':
                return 'Call declined';
            case 'missed':
                return 'No answer';
            case 'cancelled':
                return 'Call cancelled';
            default:
                return 'Call ended';
        }
    }
}
