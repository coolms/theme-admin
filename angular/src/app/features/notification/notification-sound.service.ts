import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'coolms_notification_sound';
const THROTTLE_MS = 5_000;
const TONE_DURATION_S = 0.2;
const PEAK_FREQUENCY_HZ = 880;
const TAIL_FREQUENCY_HZ = 440;
const PEAK_GAIN = 0.3;
const SILENT_GAIN = 0.0001;
const ATTACK_S = 0.01;

/**
 * Short synthesized ding played on new notification arrival. Uses
 * Web Audio API directly (no audio asset), gated by a
 * user-toggleable localStorage preference, and throttled to one
 * tone per `THROTTLE_MS` window so a burst of arrivals does not
 * become a continuous beep.
 *
 * Autoplay policy: Chrome (and other modern browsers) refuses to
 * start or resume an `AudioContext` until the user has interacted
 * with the page at least once -- otherwise it logs
 * "The AudioContext was not allowed to start...". The constructor
 * registers `pointerdown` / `keydown` listeners with
 * `{ once: true }` so the very first user gesture flips an
 * `interacted` flag and auto-detaches. `ding()` silently skips
 * playback before that flag flips; this means the very first
 * push notification that arrives before any click is muted, but
 * every subsequent arrival (after the user has done anything at
 * all) plays normally.
 *
 * The preference key follows the project's `coolms_*` localStorage
 * convention (`coolms_token`, `coolms_ui_prefs`); the toggle UI
 * lives in `NotificationDrawerContentComponent`'s header.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSoundService {
    private audioContext: AudioContext | null = null;
    private lastPlayedAt = 0;
    private interacted = false;

    private readonly _enabled = signal<boolean>(this.loadPreference());
    readonly enabled = this._enabled.asReadonly();

    constructor() {
        const markInteracted = (): void => {
            this.interacted = true;
            // Create + resume the AudioContext synchronously inside
            // the gesture handler so the context exists in `running`
            // state long before the first notification arrives. Doing
            // this lazily on the first `ding()` call races Chrome's
            // ~5s user-activation transient window: a notification
            // that lands more than five seconds after the gesture
            // would otherwise produce a freshly-suspended context
            // whose `resume()` succeeds but whose first scheduled
            // oscillator clips its leading edge, producing the
            // "first ding is silent" symptom.
            try {
                this.audioContext = new AudioContext();
                if (this.audioContext.state === 'suspended') {
                    void this.audioContext.resume().catch(() => {
                        // Resume fully on the first `ding()` -- the
                        // service handles it there too.
                    });
                }
            } catch {
                // Web Audio unavailable; ding() will no-op.
            }
        };
        document.addEventListener('pointerdown', markInteracted, { once: true });
        document.addEventListener('keydown', markInteracted, { once: true });
    }

    toggle(): void {
        const next = !this._enabled();
        this._enabled.set(next);
        this.savePreference(next);
    }

    /**
     * Play the ding once when enabled, the user has interacted with
     * the page at least once, and the throttle window has elapsed;
     * otherwise no-op. Returns a Promise so the audio context can be
     * resumed before scheduling the oscillator -- callers (e.g., the
     * notification store) fire and forget without awaiting.
     */
    async ding(): Promise<void> {
        if (!this._enabled()) {
            return;
        }
        if (!this.interacted) {
            return;
        }
        const now = Date.now();
        if (now - this.lastPlayedAt < THROTTLE_MS) {
            return;
        }
        this.lastPlayedAt = now;

        const ctx = await this.ensureRunningContext();
        if (ctx === null) {
            return;
        }

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(PEAK_FREQUENCY_HZ, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(
                TAIL_FREQUENCY_HZ,
                ctx.currentTime + TONE_DURATION_S - ATTACK_S,
            );

            gain.gain.setValueAtTime(SILENT_GAIN, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, ctx.currentTime + ATTACK_S);
            gain.gain.exponentialRampToValueAtTime(
                SILENT_GAIN,
                ctx.currentTime + TONE_DURATION_S,
            );

            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + TONE_DURATION_S);
        } catch {
            // Audio output failed (rare once interaction has occurred);
            // swallow so the notification pipeline proceeds unaffected.
        }
    }

    /**
     * Lazy-create the `AudioContext` and AWAIT its resume when the
     * browser left it suspended (Chrome creates fresh contexts in
     * `suspended` once the user-activation transient window has
     * elapsed, even though the user has interacted at least once
     * earlier). Awaiting the resume guarantees `state === 'running'`
     * before the caller schedules the oscillator, eliminating the
     * race where the first ding silently no-ops because the
     * context's clock had not started.
     */
    private async ensureRunningContext(): Promise<AudioContext | null> {
        if (this.audioContext === null) {
            try {
                this.audioContext = new AudioContext();
            } catch {
                return null;
            }
        }
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch {
                return null;
            }
        }
        return this.audioContext;
    }

    private loadPreference(): boolean {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw === null ? true : raw === 'on';
        } catch {
            return true;
        }
    }

    private savePreference(enabled: boolean): void {
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
        } catch {
            // Storage unavailable; preference stays in-memory only.
        }
    }
}
