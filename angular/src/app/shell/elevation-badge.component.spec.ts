import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { ElevationService } from '@coolms/core-angular';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { of } from 'rxjs';

import { ElevationBadgeComponent } from './elevation-badge.component';

/**
 * The badge must go away when the elevation it names runs out -- and it must
 * go away because the STATE ran out, not because a timer happened to fire.
 *
 * The distinction is the whole repair. Until now the badge was cleared by a
 * `setTimeout` armed at `expiresAt`, with nothing to catch up if it never
 * fired: a laptop asleep at that moment swallows it, a background tab delays
 * it, and no `visibilitychange`, `focus`, `online` or `pageshow` listener
 * existed to notice afterwards. The database shows why nobody had seen this --
 * the only grant this installation has ever made was dropped by hand at 2m58s
 * of a 15-minute lifetime, so the timer had never once reached its moment.
 *
 * So this spec never lets a timer run. It uses real timers and never yields,
 * and it moves the clock instead of waiting for it. Anything it observes was
 * done by a read of the state.
 *
 * The control it is paired with is a MUTATION, not another spec: neuter
 * `ElevationService.schedule()` to arm nothing at all and this still passes;
 * make `state()` hand back the stored answer unexamined and the second case
 * fails while everything else stays green.
 */
describe('ElevationBadgeComponent', () => {
    const ELEVATION = '/api/v1/auth/elevation';

    /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
    const PROFILE_TZ = 'Asia/Tokyo';

    let fixture: ComponentFixture<ElevationBadgeComponent>;
    let httpMock: HttpTestingController;
    let elevation: ElevationService;

    const state = (elevated: boolean, expiresAt: string | null) => ({
        elevated,
        expiresAt,
        ended: { reason: 'never' as const, at: null },
        lifetimeSeconds: 900,
        lifetimeCeilingSeconds: 3600,
        mfaRequired: false,
        warnings: [],
    });

    const text = (): string => fixture.nativeElement.textContent.trim();

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [ElevationBadgeComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide:  Store,
                    useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } }) },
                },
                { provide: ConfirmDialogService, useValue: { open: () => of(false) } },
                // The profile this person actually has: 24h, and a timezone
                // that is NOT the browser's. Both halves matter -- the old
                // code took the browser's locale AND the browser's zone.
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

        httpMock  = TestBed.inject(HttpTestingController);
        elevation = TestBed.inject(ElevationService);
        fixture   = TestBed.createComponent(ElevationBadgeComponent);
    });

    afterEach(() => httpMock.verify());

    /** Render the badge with a live grant that ends `seconds` from now. */
    const renderGranted = (seconds: number): number => {
        const endsAt = Date.now() + seconds * 1_000;
        fixture.detectChanges();                       // ngOnInit reads once
        httpMock.expectOne(ELEVATION).flush(state(true, new Date(endsAt).toISOString()));
        fixture.detectChanges();
        return endsAt;
    };

    it('renders the PROFILE time, not the browser locale and not the browser zone', () => {
        // 01:30 UTC is 10:30 in Tokyo. A 24h profile in Tokyo must say 10:30.
        const iso = '2026-09-15T01:30:00.000Z';

        fixture.detectChanges();
        httpMock.expectOne(ELEVATION).flush(state(true, iso));
        fixture.detectChanges();

        // What the code did before: browser locale, browser zone.
        const browserWould = new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Without this the case can pass while proving nothing -- a browser
        // already in Tokyo would render 10:30 by accident, and the assertion
        // below would be satisfied by the very behaviour it exists to reject.
        expect(browserWould)
            .withContext('this spec is vacuous unless the browser renders it differently')
            .not.toBe('10:30');

        expect(text()).toContain('Elevated until 10:30');
        expect(text()).not.toContain(browserWould);
        expect(text()).not.toMatch(/AM|PM/);
    });

    it('names the time the elevation ends while it is live', () => {
        const endsAt = renderGranted(900);

        // The expectation is built the way the PROFILE says, not the way the
        // browser would: the profile's zone, and 24h with no meridiem.
        const shown = new Intl.DateTimeFormat('en-GB', {
            timeZone: PROFILE_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(endsAt));

        expect(text()).toContain(`Elevated until ${shown}`);
    });

    it('clears once expiresAt has gone by, on a read alone -- no timer, no request', () => {
        const endsAt = renderGranted(900);
        expect(text()).toContain('Elevated until');

        // The machine was asleep at the moment the grant ended: the clock is
        // three hours past it and nothing has been delivered to this tab.
        spyOn(Date, 'now').and.returnValue(endsAt + 3 * 60 * 60 * 1_000);

        // One read of the state. That is the entire mechanism under test.
        expect(elevation.elevated()).toBe(false);
        httpMock.expectNone(ELEVATION);

        fixture.detectChanges();
        expect(text()).toBe('');
    });

    it('still names the time while the grant is live but the clock has not reached it', () => {
        const endsAt = renderGranted(900);

        // One second short: the read must not round its way past the moment.
        spyOn(Date, 'now').and.returnValue(endsAt - 1_000);

        expect(elevation.elevated()).toBe(true);
        fixture.detectChanges();
        expect(text()).toContain('Elevated until');
    });
});
