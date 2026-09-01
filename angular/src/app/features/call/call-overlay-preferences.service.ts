import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, ReplaySubject, shareReplay } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { ApiService } from '../../api/api.service';

/**
 * Reactive access to the user's incoming-call overlay
 * preferences (mirrors {@link UserCalendarPreferencesService}, minus the
 * platform-defaults cascade: these are personal UX prefs, not an
 * operator-configured floor).
 *
 * The stored values live in `IdentityProfile.extras.settings.call` and
 * reach the FE through the existing `GET /auth/me/settings` endpoint (the
 * same one the Preferences/Interface/Calendar tabs use). We lazily load
 * that response, cache it for the SPA lifetime, and mirror the
 * resolved-by-default values into signals the screen-pop overlay reads.
 *
 * When the Profile "Calls" tab saves it calls {@link update} so the live
 * overlay reacts without a refetch.
 */
export interface CallOverlayPrefs {
    /** Show the incoming-call screen-pop at all. */
    readonly overlayEnabled: boolean;
    /**
     * Seconds a settled (answered/ended) card lingers before it
     * auto-closes. 0 = never auto-close (manual dismiss only).
     */
    readonly autoDismissSeconds: number;
    /**
     * The user's own device/channel for click-to-dial, e.g.
     * `PJSIP/1001`. Blank = the dial pad prompts them to set it. Rung first
     * when they place a call, then bridged to the dialled number.
     */
    readonly sipEndpoint: string;
}

const DEFAULTS: CallOverlayPrefs = {
    overlayEnabled:     true,
    autoDismissSeconds: 8,
    sipEndpoint:        '',
};

/** Upper bound on the auto-dismiss window (10 minutes) — a settled card
 *  should never sit forever unless the user explicitly picked 0. */
const MAX_DISMISS_SECONDS = 600;

@Injectable({ providedIn: 'root' })
export class CallOverlayPreferencesService {
    private readonly api = inject(ApiService);

    private readonly _prefs = signal<CallOverlayPrefs>(DEFAULTS);
    private readonly loaded$ = new ReplaySubject<CallOverlayPrefs>(1);
    private loadOnce$?: Observable<CallOverlayPrefs>;

    // -- Public signals (read-only) --------------------------------------------
    readonly prefs              = this._prefs.asReadonly();
    readonly overlayEnabled     = computed(() => this._prefs().overlayEnabled);
    readonly autoDismissSeconds = computed(() => this._prefs().autoDismissSeconds);
    readonly sipEndpoint        = computed(() => this._prefs().sipEndpoint);

    /**
     * One-shot load of `/auth/me/settings`. Subsequent calls return the
     * same cached observable. Falls back to defaults on error (incl.
     * anonymous users who can't hit the endpoint) so signals never expose
     * a broken shape.
     */
    ensureLoaded(): Observable<CallOverlayPrefs> {
        if (this.loadOnce$) return this.loadOnce$;

        this.loadOnce$ = this.api.getSettings().pipe(
            map(all => this.merge((all['call'] as Partial<CallOverlayPrefs> | undefined) ?? {})),
            tap(prefs => {
                this._prefs.set(prefs);
                this.loaded$.next(prefs);
            }),
            catchError(() => {
                this._prefs.set(DEFAULTS);
                this.loaded$.next(DEFAULTS);
                return of(DEFAULTS);
            }),
            shareReplay({ bufferSize: 1, refCount: false }),
        );
        return this.loadOnce$;
    }

    /** Called by the Profile "Calls" tab after a successful save. */
    update(partial: Partial<CallOverlayPrefs>): void {
        this._prefs.update(prev => this.merge({ ...prev, ...partial }));
        this.loaded$.next(this._prefs());
    }

    /** Force a re-fetch, bypassing the cache (e.g. a fresh login in the same tab). */
    refresh(): Observable<CallOverlayPrefs> {
        this.loadOnce$ = undefined;
        return this.ensureLoaded();
    }

    /** Reset to defaults — used on logout. */
    reset(): void {
        this._prefs.set(DEFAULTS);
        this.loadOnce$ = undefined;
    }

    // -- Internals -------------------------------------------------------------

    private merge(overrides: Partial<CallOverlayPrefs>): CallOverlayPrefs {
        return {
            overlayEnabled:     typeof overrides.overlayEnabled === 'boolean'
                                    ? overrides.overlayEnabled
                                    : DEFAULTS.overlayEnabled,
            autoDismissSeconds: this.coerceSeconds(overrides.autoDismissSeconds),
            sipEndpoint:        typeof overrides.sipEndpoint === 'string'
                                    ? overrides.sipEndpoint.trim()
                                    : DEFAULTS.sipEndpoint,
        };
    }

    private coerceSeconds(v: unknown): number {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return DEFAULTS.autoDismissSeconds;
        }
        return Math.min(MAX_DISMISS_SECONDS, Math.floor(v));
    }
}
