import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { ApiService, CallRecordDto } from '../../api/api.service';
import { CallLiveEvent, CallLiveEventsService } from './call-live-events.service';
import { CmsPageHeaderComponent, PageTitleService } from '@coolms/ui-angular';
import { formatCallDuration } from './call-format';

/** A call currently on the board (live, or briefly lingering after it ended). */
interface LiveCall {
    readonly id:              string;
    readonly callId:          string;
    readonly direction:       string;
    readonly state:           string; // ringing | answered | on_hold | ended
    readonly fromNumber:      string | null;
    readonly toNumber:        string | null;
    readonly callerName:      string | null;
    readonly startedAtMs:     number;
    readonly endedAtMs:       number | null;
    readonly durationSeconds: number | null;
}

/** How long an ended call lingers on the board before it ages out. */
const ENDED_LINGER_MS = 6_000;

/**
 * M9.f.3 — Live-call wallboard (/admin/call/wallboard).
 *
 * A realtime board of in-progress calls, driven by the M9.c `calls.broadcast`
 * Centrifugo firehose ({@link CallLiveEventsService}). Each state transition
 * (ringing -> answered -> on_hold -> ended) upserts a card, keyed by call id;
 * ended calls linger briefly (with their final duration) then age out. The
 * board is seeded on load from the recent non-terminal CallRecords so it isn't
 * empty until the next transition. Clicking a card drills into the call detail
 * (M9.f.2). Read-only — the wallboard never mutates state.
 *
 * The live push needs a running Centrifugo + a PBX producing calls; without
 * them the board shows its empty state and the "Offline" indicator.
 */
@Component({
    selector: 'coolms-admin-call-wallboard',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent],
    template: `
        <cms-page-header title="Live calls" icon="telephone-inbound" [actions]="[]">
            <div header-meta class="conn">
                <span class="dot" [class.dot--on]="live()"></span>
                {{ live() ? 'Live' : 'Offline' }}
            </div>
        </cms-page-header>

        <div class="board">
            @let calls = activeCalls();
            @if (calls.length === 0) {
                <div class="empty" [class.empty--live]="live()">
                    <div class="empty__badge">
                        <i class="bi bi-telephone-inbound"></i>
                    </div>
                    <h2 class="empty__title">No active calls</h2>
                    <p class="empty__sub">
                        Calls appear here the moment they ring, connect, and hang up — live, with no refresh.
                    </p>
                    <div class="empty__status" [class.empty__status--on]="live()">
                        <span class="empty__pulse"></span>
                        {{ live() ? 'Listening for calls…' : 'Realtime connection offline' }}
                    </div>
                </div>
            } @else {
                <div class="grid">
                    @for (c of calls; track c.id) {
                        <button type="button" class="card" [attr.data-state]="c.state" (click)="open(c)">
                            <div class="card__top">
                                <span class="who">{{ c.callerName || c.fromNumber || c.callId }}</span>
                                <span class="state">
                                    @if (c.state !== 'ended') {
                                        <span class="livedot" [attr.data-state]="c.state"></span>
                                    }
                                    {{ label(c.state) }}
                                </span>
                            </div>
                            <div class="card__nums">
                                <span class="dir">{{ c.direction }}</span>
                                <span class="mono">{{ c.fromNumber || '—' }} → {{ c.toNumber || '—' }}</span>
                            </div>
                            <div class="card__timer mono">{{ formatCallDuration(elapsedSeconds(c)) }}</div>
                        </button>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .board { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        .conn { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; color: var(--cms-text-muted, #848b96); }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cms-text-muted); }
        .dot--on { background: var(--cms-success); }

        /* Centered, deliberate empty state — fills the board and sits dead-centre. */
        .empty {
            min-height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 48px 24px;
            color: var(--cms-text-muted, #848b96);
        }
        .empty__badge {
            position: relative;
            width: 76px; height: 76px;
            display: grid; place-items: center;
            border-radius: 50%;
            background: var(--cms-success-light);
            color: var(--cms-success);
            margin-bottom: 18px;
        }
        .empty__badge .bi { font-size: 2rem; }
        /* A soft ring that ripples outward while the board is listening,
           conveying "connected + waiting" without a spinner. */
        .empty__badge::after {
            content: '';
            position: absolute; inset: -8px;
            border-radius: 50%;
            border: 2px solid var(--cms-success-subtle-border);
            opacity: 0;
        }
        .empty--live .empty__badge::after { animation: wb-ring 2.4s ease-out infinite; }

        .empty__title { margin: 0; font-size: 1.05rem; font-weight: 600; color: var(--cms-text, #111827); }
        .empty__sub { margin: 8px 0 0; max-width: 340px; font-size: .85rem; line-height: 1.5; }

        .empty__status {
            margin-top: 20px;
            display: inline-flex; align-items: center; gap: 7px;
            padding: 5px 13px;
            border-radius: 999px;
            font-size: .75rem;
            background: var(--cms-surface-muted, #f3f4f6);
            color: var(--cms-text-muted, #848b96);
        }
        .empty__pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--cms-text-muted); }
        .empty__status--on { background: var(--cms-success-light); color: var(--cms-success-text); }
        .empty__status--on .empty__pulse { background: var(--cms-success); animation: wb-blink 1.4s ease-in-out infinite; }

        @keyframes wb-ring {
            0%   { transform: scale(.9); opacity: .7; }
            70%  { transform: scale(1.3); opacity: 0; }
            100% { opacity: 0; }
        }
        @keyframes wb-blink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 12px;
        }
        .card {
            display: flex; flex-direction: column; gap: 8px;
            text-align: left;
            padding: 12px 14px;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-left: 4px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            background: var(--cms-surface, #fff);
            cursor: pointer;
            font: inherit;
            transition: box-shadow .15s ease, transform .15s ease, border-color .15s ease;
        }
        .card:hover { transform: translateY(-2px); box-shadow: var(--cms-shadow-md, 0 4px 12px rgba(0,0,0,.10)); }
        .card:focus-visible { outline: 2px solid var(--cms-success); outline-offset: 2px; }
        .card[data-state="ringing"]  { border-left-color: var(--cms-warning); }
        .card[data-state="answered"] { border-left-color: var(--cms-success); }
        .card[data-state="on_hold"]  { border-left-color: var(--cms-meta); }
        .card[data-state="ended"]    { border-left-color: var(--cms-text-muted); opacity: .6; }

        .card__top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .who { font-weight: 600; font-size: .95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .state { display: inline-flex; align-items: center; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--cms-text-muted, #848b96); white-space: nowrap; }

        /* Small pulsing indicator on live (non-ended) cards. */
        .livedot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; background: var(--cms-text-muted); }
        .livedot[data-state="ringing"]  { background: var(--cms-warning); animation: wb-blink 1s   ease-in-out infinite; }
        .livedot[data-state="answered"] { background: var(--cms-success); animation: wb-blink 1.6s ease-in-out infinite; }
        .livedot[data-state="on_hold"]  { background: var(--cms-meta); }

        .card__nums { display: flex; gap: 8px; align-items: baseline; font-size: .8rem; color: var(--cms-text-muted, #848b96); }
        .dir { text-transform: capitalize; }

        .card__timer { font-size: 1.25rem; font-variant-numeric: tabular-nums; }

        .mono { font-family: var(--cms-font-mono, monospace); }
    `],
})
export class CallWallboardComponent implements OnInit {
    private readonly api        = inject(ApiService);
    private readonly liveEvents = inject(CallLiveEventsService);
    private readonly router     = inject(Router);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    /** All calls received, keyed by id (ended ones are pruned once they age out). */
    private readonly calls = signal<Map<string, LiveCall>>(new Map());
    /** Ticks every second — drives the live duration + the ended-linger age-out. */
    private readonly now = signal(Date.now());

    /** WebSocket connection state (passthrough to the shared Centrifugo client). */
    readonly live = this.liveEvents.isConnected;

    /** Cards to render: active calls + ended calls still within the linger window, newest first. */
    readonly activeCalls = computed<LiveCall[]>(() => {
        const t = this.now();
        return [...this.calls().values()]
            .filter(c => c.state !== 'ended' || (c.endedAtMs !== null && t - c.endedAtMs < ENDED_LINGER_MS))
            .sort((a, b) => b.startedAtMs - a.startedAtMs);
    });

    ngOnInit(): void {
        this.titleSvc.set('Live calls');

        // Subscribe FIRST so a transition during the seed fetch isn't missed.
        this.liveEvents.watchBroadcast().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  ev => this.upsert(this.fromEvent(ev)),
            error: () => { /* realtime unavailable — the board just stays empty/Offline */ },
        });

        // Seed the board with recent non-terminal calls (don't clobber live entries).
        this.api.listCallRecordsPage({ pageSize: 50 }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                for (const dto of result.items) {
                    if (dto.state !== 'ended' && dto.id && !this.calls().has(dto.id)) {
                        this.upsert(this.fromDto(dto));
                    }
                }
            },
            error: () => { /* seed is best-effort */ },
        });

        // 1s tick: advance `now` + prune ended cards that have aged past the linger.
        interval(1_000).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            const t = Date.now();
            this.now.set(t);
            const current = this.calls();
            let changed = false;
            const next = new Map(current);
            for (const [id, c] of current) {
                if (c.state === 'ended' && c.endedAtMs !== null && t - c.endedAtMs >= ENDED_LINGER_MS) {
                    next.delete(id);
                    changed = true;
                }
            }
            if (changed) this.calls.set(next);
        });
    }

    open(c: LiveCall): void {
        if (c.id) void this.router.navigate(['/call/records', c.id]);
    }

    private upsert(c: LiveCall): void {
        // An `ended` transition that carries no usable end timestamp (null
        // `endedAt` in the payload) would never age out: the linger filter
        // drops it on sight AND the 1s prune skips it (both require
        // `endedAtMs !== null`), so the entry would sit in the Map forever —
        // an invisible leak on a board left running all day. Anchor its linger
        // to receive-time so it shows briefly, then prunes like any ended call.
        const normalized: LiveCall = (c.state === 'ended' && c.endedAtMs === null)
            ? { ...c, endedAtMs: Date.now() }
            : c;
        const next = new Map(this.calls());
        next.set(normalized.id, normalized);
        this.calls.set(next);
    }

    private fromEvent(ev: CallLiveEvent): LiveCall {
        return {
            id:              ev.id,
            callId:          ev.callId,
            direction:       ev.direction,
            state:           ev.state,
            fromNumber:      ev.fromNumber,
            toNumber:        ev.toNumber,
            callerName:      ev.callerName,
            startedAtMs:     this.parseMs(ev.startedAt) ?? Date.now(),
            endedAtMs:       this.parseMs(ev.endedAt),
            durationSeconds: ev.durationSeconds,
        };
    }

    private fromDto(dto: CallRecordDto): LiveCall {
        return {
            id:              dto.id ?? '',
            callId:          dto.callId ?? '',
            direction:       dto.direction ?? '',
            state:           dto.state ?? '',
            fromNumber:      dto.fromNumber ?? null,
            toNumber:        dto.toNumber ?? null,
            callerName:      dto.callerName ?? null,
            startedAtMs:     this.parseMs(dto.startedAt) ?? Date.now(),
            endedAtMs:       this.parseMs(dto.endedAt ?? null),
            durationSeconds: dto.durationSeconds ?? null,
        };
    }

    private parseMs(iso: string | null | undefined): number | null {
        if (!iso) return null;
        const ms = Date.parse(iso);
        return Number.isNaN(ms) ? null : ms;
    }

    /** Seconds to display: live elapsed for active calls, final duration for ended. */
    elapsedSeconds(c: LiveCall): number {
        if (c.state === 'ended') {
            if (c.durationSeconds !== null) return c.durationSeconds;
            const end = c.endedAtMs ?? this.now();
            return Math.max(0, Math.round((end - c.startedAtMs) / 1000));
        }
        return Math.max(0, Math.round((this.now() - c.startedAtMs) / 1000));
    }

    label(state: string): string {
        switch (state) {
            case 'on_hold': return 'On hold';
            case 'ringing': return 'Ringing';
            case 'answered': return 'Answered';
            case 'ended': return 'Ended';
            default: return state || '—';
        }
    }

    protected readonly formatCallDuration = formatCallDuration;
}
