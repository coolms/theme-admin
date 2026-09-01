import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { CallLiveEvent, CallLiveEventsService } from './call-live-events.service';
import { CallOverlayPreferencesService } from './call-overlay-preferences.service';
import { WebPhoneService } from './web-phone.service';
import { formatCallDuration } from './call-format';

/** A call currently popped on-screen (live, or briefly lingering after it settled). */
interface PoppedCall {
    readonly id:              string;
    readonly callId:          string;
    readonly direction:       string;
    readonly state:           string; // ringing | answered | on_hold | ended
    readonly fromNumber:      string | null;
    readonly toNumber:        string | null;
    readonly callerName:      string | null;
    /** Who answered — a resolved name, or an "ext NNNN" fallback, or null. */
    readonly answeredBy:      string | null;
    readonly startedAtMs:     number;
    /** When the call first left `ringing` (answered/ended) — starts the auto-dismiss clock. */
    readonly settledAtMs:     number | null;
    readonly endedAtMs:       number | null;
    readonly durationSeconds: number | null;
}

/** Newest-first cap so a busy firehose can't paper the screen. */
const MAX_VISIBLE = 4;
/** Hard safety: a card is never kept longer than this, whatever its state. */
const HARD_MAX_MS = 15 * 60 * 1000;

/**
 * The global incoming-call screen-pop.
 *
 * Mounted once in the admin shell (a sibling of the WebRTC
 * `RtcCallOverlayComponent`), so a manager mid-task sees a call arrive as
 * a small, non-intrusive card in the corner without leaving whatever page
 * they're on. Driven by the `calls.broadcast` firehose
 * ({@link CallLiveEventsService}) — each state transition
 * (ringing -> answered -> on_hold -> ended) upserts a card keyed by call id;
 * once a call settles (someone picks up, or it ends) its auto-dismiss
 * clock starts and it fades after the user-configured window (or waits for
 * a manual close). Clicking a card opens the call record.
 *
 * Read-only awareness only: this is a screen-pop, not a softphone. There
 * is deliberately no "Answer" button — answering in the browser needs the
 * WebRTC-SIP softphone (a later slice). The `broadcast` channel is
 * `ROLE_CALL`-gated, so a user without the role simply never sees a pop
 * (the subscription 403s and gives up quietly). Whether it shows at all,
 * and how long settled cards linger, is set on the Profile -> Calls tab
 * ({@link CallOverlayPreferencesService}).
 */
@Component({
    selector: 'app-call-screenpop-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (visibleCalls(); as calls) {
            @if (calls.length) {
                <div class="callpop-stack" role="region" aria-label="Incoming calls" aria-live="polite">
                    @for (c of calls; track c.id) {
                        <div class="callpop" [attr.data-state]="c.state">
                            <div class="callpop__icon" [class.callpop__icon--pulse]="c.state === 'ringing'">
                                <i class="bi bi-telephone-inbound-fill"></i>
                            </div>
                            <div class="callpop__body">
                                <div class="callpop__who">{{ c.callerName || c.fromNumber || 'Unknown caller' }}</div>
                                <div class="callpop__meta">
                                    <span class="callpop__chip" [attr.data-state]="c.state">{{ stateLabel(c.state) }}</span>
                                    <span class="callpop__sub">{{ subLine(c) }}</span>
                                </div>
                            </div>
                            <div class="callpop__actions">
                                <!-- Softphone: Answer/Decline a ringing call, or hang up a
                                     live one — only when the browser SIP endpoint is registered. -->
                                @if (webphone.status() === 'registered') {
                                    @if (c.state === 'ringing' && webphone.incoming()) {
                                        <button type="button" class="callpop__btn callpop__btn--answer"
                                                title="Answer" aria-label="Answer" (click)="answer()">
                                            <i class="bi bi-telephone-fill"></i>
                                        </button>
                                        <button type="button" class="callpop__btn callpop__btn--hangup"
                                                title="Decline" aria-label="Decline" (click)="hangup()">
                                            <i class="bi bi-telephone-x-fill"></i>
                                        </button>
                                    } @else if (webphone.inCall() && (c.state === 'answered' || c.state === 'on_hold')) {
                                        <button type="button" class="callpop__btn callpop__btn--hangup"
                                                title="Hang up" aria-label="Hang up" (click)="hangup()">
                                            <i class="bi bi-telephone-x-fill"></i>
                                        </button>
                                    }
                                }
                                <button type="button" class="callpop__btn callpop__btn--open"
                                        title="Open call" aria-label="Open call" (click)="open(c)">
                                    <i class="bi bi-box-arrow-up-right"></i>
                                </button>
                                <button type="button" class="callpop__btn callpop__btn--close"
                                        title="Dismiss" aria-label="Dismiss" (click)="dismiss(c)">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </div>
                    }
                </div>
            }
        }
    `,
    styles: [`
        .callpop-stack {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2099;
            display: flex;
            flex-direction: column-reverse;
            gap: 10px;
            max-width: 92vw;
        }
        .callpop {
            display: flex;
            align-items: center;
            gap: 12px;
            width: 320px;
            max-width: 92vw;
            padding: 12px 14px;
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-left: 4px solid var(--cms-text-muted);
            border-radius: var(--cms-radius, 10px);
            box-shadow: var(--cms-shadow-md, 0 6px 24px rgba(0, 0, 0, .12));
            animation: callpop-in .18s ease;
        }
        @keyframes callpop-in {
            from { transform: translateY(12px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        .callpop[data-state="ringing"]  { border-left-color: var(--cms-warning); }
        .callpop[data-state="answered"] { border-left-color: var(--cms-success); }
        .callpop[data-state="on_hold"]  { border-left-color: var(--cms-meta); }
        .callpop[data-state="ended"]    { border-left-color: var(--cms-text-muted); }

        .callpop__icon {
            flex: 0 0 auto;
            width: 40px; height: 40px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: var(--cms-success-light);
            color: var(--cms-success);
            font-size: 1.05rem;
        }
        .callpop__icon--pulse { animation: callpop-pulse 1.3s ease-in-out infinite; }
        @keyframes callpop-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, .45); }
            50%      { box-shadow: 0 0 0 8px rgba(22, 163, 74, 0); }
        }

        .callpop__body { flex: 1 1 auto; min-width: 0; }
        .callpop__who {
            font-size: .9rem; font-weight: 600; color: var(--cms-text, #111827);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .callpop__meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; min-width: 0; }
        .callpop__chip {
            flex: 0 0 auto;
            font-size: .64rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
            padding: 1px 7px; border-radius: 999px;
            background: var(--cms-surface-muted); color: var(--cms-text-secondary);
        }
        .callpop__chip[data-state="ringing"]  { background: rgba(245, 158, 11, .14); color: var(--cms-warning-text); }
        .callpop__chip[data-state="answered"] { background: rgba(22, 163, 74, .14);  color: var(--cms-success-text); }
        .callpop__chip[data-state="on_hold"]  { background: rgba(99, 102, 241, .14); color: var(--cms-meta-text); }
        .callpop__sub {
            font-size: .75rem; color: var(--cms-text-secondary, #6b7280);
            font-variant-numeric: tabular-nums;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .callpop__actions { flex: 0 0 auto; display: flex; gap: 4px; }
        .callpop__btn {
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            border: none; border-radius: var(--cms-radius-md, 8px);
            background: transparent; color: var(--cms-text-muted, #848b96);
            cursor: pointer; font-size: .9rem;
            transition: background .12s ease, color .12s ease;
        }
        .callpop__btn:hover { background: var(--cms-surface-muted, #f3f4f6); color: var(--cms-text, #111827); }

        .callpop__btn--answer { background: var(--cms-success); color: var(--cms-text-inverse); }
        .callpop__btn--answer:hover { background: var(--cms-success-text); color: var(--cms-text-inverse); }
        .callpop__btn--hangup { background: var(--cms-danger); color: var(--cms-text-inverse); }
        .callpop__btn--hangup:hover { background: var(--cms-danger-text); color: var(--cms-text-inverse); }
    `],
})
export class CallScreenpopOverlayComponent {
    private readonly liveEvents = inject(CallLiveEventsService);
    private readonly prefs      = inject(CallOverlayPreferencesService);
    private readonly router     = inject(Router);
    /** The in-browser softphone — drives the Answer/Hangup controls. */
    readonly webphone = inject(WebPhoneService);

    /** All popped calls, keyed by call id (pruned as they age out). */
    private readonly calls = signal<Map<string, PoppedCall>>(new Map());
    /** Ticks every second — drives live duration + the auto-dismiss prune. */
    private readonly nowMs = signal(Date.now());

    /** Cards to render: gated by the on/off preference, newest first, capped. */
    readonly visibleCalls = computed<PoppedCall[]>(() => {
        if (!this.prefs.overlayEnabled()) return [];
        // Touch nowMs so the timers in the template re-render each tick.
        this.nowMs();
        return [...this.calls().values()]
            .sort((a, b) => b.startedAtMs - a.startedAtMs)
            .slice(0, MAX_VISIBLE);
    });

    constructor() {
        // Refresh the user's overlay prefs on mount (on/off + auto-dismiss
        // window). The shell remounts this overlay per login, so refresh()
        // (not the cached ensureLoaded) keeps it correct after a same-tab
        // re-login — mirrors how calendar consumers re-sync on mount.
        this.prefs.refresh().pipe(takeUntilDestroyed()).subscribe();

        // Subscribe FIRST so a transition during any seed fetch isn't missed.
        // watchBroadcast() only emits `call.*` events; a 403 (no ROLE_CALL)
        // unsubscribes quietly and the board just stays empty.
        this.liveEvents.watchBroadcast().pipe(takeUntilDestroyed()).subscribe({
            next:  ev => this.upsert(ev),
            error: () => { /* realtime unavailable — nothing pops */ },
        });

        const timer = setInterval(() => this.tick(), 1000);
        inject(DestroyRef).onDestroy(() => clearInterval(timer));

        // Boot the in-browser softphone. Idempotent + self-guarding:
        // it stays dormant unless the deployment has a WebRTC PBX configured AND
        // this user has a provisioned credential — so it's a no-op everywhere else.
        void this.webphone.start();
    }

    open(c: PoppedCall): void {
        this.dismiss(c);
        if (c.id) void this.router.navigate(['/call/records', c.id]);
    }

    dismiss(c: PoppedCall): void {
        const next = new Map(this.calls());
        if (next.delete(c.id)) this.calls.set(next);
    }

    /** Answer the ringing softphone call. */
    answer(): void {
        void this.webphone.answer();
    }

    /** Decline a ringing call or hang up a live one. */
    hangup(): void {
        void this.webphone.hangup();
    }

    private upsert(ev: CallLiveEvent): void {
        const now = Date.now();
        const next = new Map(this.calls());
        const prev = next.get(ev.id);

        const startedAtMs = this.parseMs(ev.startedAt) ?? prev?.startedAtMs ?? now;
        // Latch the settle instant the first time the call leaves `ringing`.
        let settledAtMs = prev?.settledAtMs ?? null;
        if (settledAtMs === null && ev.state !== 'ringing') {
            settledAtMs = this.parseMs(ev.answeredAt) ?? this.parseMs(ev.endedAt) ?? now;
        }
        // Latch who answered, first-wins: a resolved name, else an "ext N" fallback.
        const answeredBy = prev?.answeredBy
            ?? ev.answeredByName
            ?? (ev.answeredExtension ? `ext ${ev.answeredExtension}` : null);

        next.set(ev.id, {
            id:              ev.id,
            callId:          ev.callId,
            direction:       ev.direction,
            state:           ev.state,
            fromNumber:      ev.fromNumber,
            toNumber:        ev.toNumber,
            callerName:      ev.callerName,
            answeredBy,
            startedAtMs,
            settledAtMs,
            endedAtMs:       this.parseMs(ev.endedAt),
            durationSeconds: ev.durationSeconds,
        });
        this.calls.set(next);
    }

    private tick(): void {
        const now = Date.now();
        this.nowMs.set(now);

        const dismissMs = this.prefs.autoDismissSeconds() * 1000;
        const current = this.calls();
        let changed = false;
        const next = new Map(current);
        for (const [id, c] of current) {
            // Hard safety — never keep a card indefinitely.
            if (now - c.startedAtMs >= HARD_MAX_MS) {
                next.delete(id);
                changed = true;
                continue;
            }
            // Settled (answered/ended) cards fade after the window; 0 = never.
            if (c.settledAtMs !== null && dismissMs > 0 && now - c.settledAtMs >= dismissMs) {
                next.delete(id);
                changed = true;
            }
        }
        if (changed) this.calls.set(next);
    }

    /** Seconds to display: live elapsed for active calls, final duration for ended. */
    private elapsedSeconds(c: PoppedCall): number {
        if (c.state === 'ended') {
            if (c.durationSeconds !== null) return c.durationSeconds;
            const end = c.endedAtMs ?? this.nowMs();
            return Math.max(0, Math.round((end - c.startedAtMs) / 1000));
        }
        return Math.max(0, Math.round((this.nowMs() - c.startedAtMs) / 1000));
    }

    subLine(c: PoppedCall): string {
        const dur = formatCallDuration(this.elapsedSeconds(c));
        switch (c.state) {
            case 'ringing':
                // A.2 will resolve `to`/answerer to a named employee.
                return c.toNumber ? `Incoming → ${c.toNumber} · ${dur}` : `Incoming · ${dur}`;
            case 'ended':
                return c.answeredBy ? `Answered by ${c.answeredBy} · ${dur}` : `Ended · ${dur}`;
            default: // answered | on_hold — who answered + a running timer
                return c.answeredBy ? `Answered by ${c.answeredBy} · ${dur}` : dur;
        }
    }

    stateLabel(state: string): string {
        switch (state) {
            case 'on_hold':  return 'On hold';
            case 'ringing':  return 'Ringing';
            case 'answered': return 'Answered';
            case 'ended':    return 'Ended';
            default:         return state || '—';
        }
    }

    private parseMs(iso: string | null | undefined): number | null {
        if (!iso) return null;
        const ms = Date.parse(iso);
        return Number.isNaN(ms) ? null : ms;
    }
}
