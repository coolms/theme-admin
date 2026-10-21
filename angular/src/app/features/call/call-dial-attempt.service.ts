import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
import { type Observable, Subscription, catchError, map, of, tap } from 'rxjs';

import { CallApiService } from './call-api.service';
import { type CallLiveEvent, CallLiveEventsService } from './call-live-events.service';
import type { CallOriginateDto } from './call.types';

/** One outbound call the person asked for, while the platform places it (or after it gave up). */
export interface CallDialAttempt {
    readonly callId:       string;
    readonly number:       string;
    /** `placing` while the platform tries; `not_placed` once it gave up or was cancelled. */
    readonly state:        'placing' | 'not_placed';
    readonly windowEndsAt: string | null;
    readonly reason:       string | null;
    /** Local clock (ms) when the attempt started: the elapsed time counts from here. */
    readonly startedAt:    number;
}

/** What `dial()` did: started or re-showed an attempt, or the call is already up. */
export type CallDialOutcome = 'attempt' | 'placed';

/**
 * The dial pad's outbound attempt (A1 contract, 2026-10-21). `POST /call/originate` answers at once with `placing`
 * and a `windowEndsAt`; the platform keeps trying until then and says how it ended on `calls.{agentUuid}`:
 * `call.ringing` placed it, `call.not_placed` gave up (with a `reason`).
 *
 * Root-scoped so the attempt outlives the drawer: closing the pad and opening it again shows the same attempt. A
 * dial while one is placing re-shows it and sends nothing; a retry is a new POST, made only by the person.
 */
@Injectable({ providedIn: 'root' })
export class CallDialAttemptService {
    private readonly callApi = inject(CallApiService);
    private readonly live    = inject(CallLiveEventsService);
    private readonly store   = inject(Store);

    private readonly attemptSig = signal<CallDialAttempt | null>(null);
    private readonly nowSig     = signal(Date.now());
    private ticker: ReturnType<typeof setInterval> | null = null;
    private events: Subscription | null = null;
    private watchedAgent: string | null = null;
    /**
     * A terminal event can arrive before the POST answers (the platform may give up at once). Held by callId until
     * the answer names it; only the last few are kept.
     */
    private readonly early = new Map<string, CallLiveEvent>();

    readonly attempt = this.attemptSig.asReadonly();
    /** Whole seconds since the attempt started; ticks once a second while placing. */
    readonly elapsedSeconds = computed(() => {
        const a = this.attemptSig();
        return a === null ? 0 : Math.max(0, Math.floor((this.nowSig() - a.startedAt) / 1000));
    });
    /** Fires once when a placing attempt became a ringing call; the panel says so and closes. */
    readonly placed = signal<{ readonly callId: string; readonly number: string } | null>(null);

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.stopTicker();
            this.events?.unsubscribe();
        });
    }

    /**
     * Asks the platform to place a call -- unless one is placing: then it answers the same attempt and sends
     * nothing. Errors (403, 422, network) surface to the caller; a refusal by the phone system is a `not_placed`
     * attempt, not an error.
     */
    dial(endpoint: string, number: string): Observable<CallDialOutcome> {
        const current = this.attemptSig();
        if (current !== null && current.state === 'placing') {
            return of('attempt');
        }
        this.watch();
        return this.callApi.originateCall({ endpoint, extension: number }).pipe(
            map(dto => this.accept(dto, number)),
        );
    }

    /**
     * Stops the placing attempt. 200 (stopped, or already stopped) and 404 (not ours any more) end it as not placed;
     * 409 means it was placed meanwhile -- the call is up, so the attempt clears.
     */
    cancel(): Observable<void> {
        const a = this.attemptSig();
        if (a === null || a.state !== 'placing') {
            return of(undefined);
        }
        return this.callApi.cancelCall(a.callId).pipe(
            tap(dto => this.endAttempt(a.callId, dto.reason ?? 'cancelled by the caller')),
            map(() => undefined),
            catchError((e: { status?: number; error?: { detail?: string } }) => {
                if (e?.status === 409) {
                    this.markPlaced(a.callId);
                } else if (e?.status === 404) {
                    this.endAttempt(a.callId, e.error?.detail ?? 'No outbound call of yours with this id.');
                } else {
                    throw e;
                }
                return of(undefined);
            }),
        );
    }

    /** Puts the not-placed attempt away (the person read it and did not retry). */
    dismiss(): void {
        if (this.attemptSig()?.state === 'not_placed') {
            this.attemptSig.set(null);
        }
    }

    private accept(dto: CallOriginateDto, number: string): CallDialOutcome {
        const callId = dto.callId ?? '';
        if (dto.originated === true || (dto.state !== undefined && dto.state !== 'placing' && dto.state !== 'not_placed')) {
            this.attemptSig.set(null);
            this.stopTicker();
            return 'placed';
        }
        this.attemptSig.set({
            callId,
            number,
            state:        dto.state === 'not_placed' ? 'not_placed' : 'placing',
            windowEndsAt: dto.windowEndsAt ?? null,
            reason:       dto.reason ?? null,
            startedAt:    Date.now(),
        });
        this.nowSig.set(Date.now());
        if (this.attemptSig()?.state === 'placing') {
            this.startTicker();
        }
        const seen = this.early.get(callId);
        this.early.clear();
        if (seen !== undefined) {
            this.onEvent(seen);
        }
        return this.attemptSig() === null ? 'placed' : 'attempt';
    }

    private watch(): void {
        const agent = this.store.selectSnapshot(AuthState.currentUser)?.id ?? null;
        if (agent === null || agent === this.watchedAgent) {
            return;
        }
        this.events?.unsubscribe();
        this.watchedAgent = agent;
        this.events = this.live.watchAgent(agent).subscribe(ev => this.onEvent(ev));
    }

    private onEvent(ev: CallLiveEvent): void {
        const a = this.attemptSig();
        if (a === null || a.callId !== ev.callId) {
            if (ev.type === 'call.ringing' || ev.type === 'call.not_placed' || ev.type === 'call.placing') {
                this.early.set(ev.callId, ev);
                if (this.early.size > 8) {
                    this.early.delete(this.early.keys().next().value as string);
                }
            }
            return;
        }
        if (a.state !== 'placing') {
            return;
        }
        if (ev.type === 'call.placing') {
            this.attemptSig.set({ ...a, windowEndsAt: ev.windowEndsAt ?? a.windowEndsAt });
        } else if (ev.type === 'call.not_placed') {
            this.endAttempt(a.callId, ev.reason);
        } else if (ev.type === 'call.ringing' || ev.type === 'call.answered' || ev.type === 'call.on_hold') {
            this.markPlaced(a.callId);
        }
    }

    private endAttempt(callId: string, reason: string | null): void {
        const a = this.attemptSig();
        if (a === null || a.callId !== callId) {
            return;
        }
        this.stopTicker();
        this.attemptSig.set({ ...a, state: 'not_placed', reason });
    }

    private markPlaced(callId: string): void {
        const a = this.attemptSig();
        if (a === null || a.callId !== callId) {
            return;
        }
        this.stopTicker();
        this.attemptSig.set(null);
        this.placed.set({ callId, number: a.number });
    }

    private startTicker(): void {
        this.stopTicker();
        this.ticker = setInterval(() => this.nowSig.set(Date.now()), 1000);
    }

    private stopTicker(): void {
        if (this.ticker !== null) {
            clearInterval(this.ticker);
            this.ticker = null;
        }
    }
}
