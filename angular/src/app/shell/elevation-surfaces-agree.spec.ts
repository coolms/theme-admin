import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, NaviGraphService } from '@coolms/core-angular';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { ElevationBadgeComponent } from './elevation-badge.component';
import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';

/**
 * The badge and the profile menu now make the same statement about the same
 * subject, in two places. Two places is how they start disagreeing.
 *
 * What actually prevents the drift is that they share one implementation --
 * {@link ElevationDisplay} -- rather than each computing it. This spec is the
 * backstop for the day someone stops using it, and it is honest about that:
 * while both call the same method, the comparison below cannot fail. What it
 * still catches on its own is the rendering either side of that method.
 *
 * The association is deliberate and both halves of it are asserted here: the
 * badge is what APPEARED (nothing at all while unelevated, so it cannot
 * become furniture), and both name the END TIME (an indicator saying only
 * "elevated" cannot tell a live grant from a forgotten one).
 */
describe('the elevation surfaces agree', () => {
    const ELEVATION = '/api/v1/auth/elevation';
    const PROFILE_TZ = 'Asia/Tokyo';

    const state = (elevated: boolean, expiresAt: string | null) => ({
        elevated,
        expiresAt,
        ended: { reason: 'never' as const, at: null },
        lifetimeSeconds: 900,
        lifetimeCeilingSeconds: 3600,
        mfaRequired: false,
        warnings: [],
    });

    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [ElevationBadgeComponent, AdminTopbarProfileComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideRouter([]),
                {
                    provide:  Store,
                    useValue: {
                        selectSnapshot: () => ({ apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } }),
                        select:         () => of(null),
                        dispatch:       () => of(null),
                    },
                },
                { provide: ConfirmDialogService, useValue: { open: () => of(false) } },
                { provide: NaviGraphService, useValue: { getTree: () => of([]), tree: () => [] } },
                {
                    provide:  UserCalendarPreferencesService,
                    useValue: {
                        ensureLoaded: () => undefined,
                        tz:           () => PROFILE_TZ,
                        dateFormat:   () => 'yyyy-MM-dd',
                        timeFormat:   () => '24h',
                    },
                },
            ],
        });
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.match(() => true).forEach(r => r.flush(state(false, null)));
        httpMock.verify();
    });

    it('name the same end time, and both say nothing when the session is not elevated', () => {
        const elevation = TestBed.inject(ElevationService);

        const badge = TestBed.createComponent(ElevationBadgeComponent);
        const menu  = TestBed.createComponent(AdminTopbarProfileComponent);

        // Unelevated: the badge renders nothing and the menu line is absent.
        // This is the half that keeps the badge something that APPEARED.
        badge.detectChanges();
        menu.detectChanges();
        httpMock.match(ELEVATION).forEach(r => r.flush(state(false, null)));
        badge.detectChanges();
        menu.detectChanges();

        expect(badge.componentInstance.until()).toBeNull();
        expect(menu.componentInstance.elevatedUntil()).toBeNull();
        expect(badge.nativeElement.textContent.trim()).toBe('');

        // Elevated: both name the SAME time, and it is the profile's.
        elevation.refresh().subscribe();
        httpMock.expectOne(ELEVATION).flush(state(true, '2026-09-15T01:30:00.000Z'));
        badge.detectChanges();
        menu.detectChanges();

        const fromBadge = badge.componentInstance.until();
        const fromMenu  = menu.componentInstance.elevatedUntil();

        expect(fromBadge).toBe('10:30');
        expect(fromMenu).toBe(fromBadge);
        expect(badge.nativeElement.textContent).toContain('Elevated until 10:30');
    });
});
