import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, NaviGraphService } from '@coolms/core-angular';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';

/**
 * The account menu and elevation (2026-10-12): a member of admin always has "Elevate session" while the
 * session is not elevated, and "Elevated until HH:MM" with "End elevation" while it is. Whether the account may
 * elevate is the server's answer (`mayElevate` on the elevation state), never read from membership here: an account
 * the server says may not is offered nothing.
 */
describe('the account menu and elevation', () => {
    const ELEVATION = '/api/v1/auth/elevation';

    const state = (elevated: boolean, mayElevate: boolean | undefined) => ({
        elevated,
        expiresAt: elevated ? '2099-01-01T01:30:00Z' : null,
        ended: { reason: 'never' as const, at: null },
        lifetimeSeconds: 900,
        lifetimeCeilingSeconds: 3600,
        mfaRequired: false,
        warnings: [],
        ...(mayElevate === undefined ? {} : { mayElevate }),
    });

    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [AdminTopbarProfileComponent],
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
                    useValue: { ensureLoaded: () => undefined, tz: () => 'UTC', dateFormat: () => 'yyyy-MM-dd', timeFormat: () => '24h' },
                },
            ],
        });
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.match(() => true).forEach(r => r.flush(state(false, false)));
        httpMock.verify();
    });

    /** The open menu's text, once the state the server answered has landed. */
    function openMenuWith(answer: ReturnType<typeof state>): { text: string; el: HTMLElement } {
        const elevation = TestBed.inject(ElevationService);
        const menu = TestBed.createComponent(AdminTopbarProfileComponent);
        menu.detectChanges();
        elevation.refresh().subscribe();
        httpMock.match(ELEVATION).forEach(r => r.flush(answer));
        menu.componentInstance.toggle();
        menu.detectChanges();
        const el = menu.nativeElement as HTMLElement;
        return { text: el.textContent ?? '', el };
    }

    it('offers "Elevate session" to an account that may elevate, while not elevated, and it asks', () => {
        const elevation = TestBed.inject(ElevationService);
        const asked = spyOn(elevation, 'offerFor').and.returnValue(of(true));
        const { text, el } = openMenuWith(state(false, true));

        expect(text).toContain('Elevate session');
        expect(text).not.toContain('Elevated until');

        const button = [...el.querySelectorAll('button')].find(b => /Elevate session/.test(b.textContent ?? ''));
        button!.click();
        expect(asked).toHaveBeenCalledTimes(1);
    });

    it('offers nothing to an account the server says may not elevate', () => {
        expect(openMenuWith(state(false, false)).text).not.toContain('Elevate session');
    });

    it('offers nothing when the server says nothing (an older server): absent reads as may not', () => {
        expect(openMenuWith(state(false, undefined)).text).not.toContain('Elevate session');
    });

    it('says "Elevated until" with "End elevation" while elevated, and no longer offers to elevate', () => {
        const { text } = openMenuWith(state(true, true));

        expect(text).toContain('Elevated until');
        expect(text).toContain('End elevation');
        expect(text).not.toContain('Elevate session');
    });
});
