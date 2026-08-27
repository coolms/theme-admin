import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from '../../api/api.service';
import { CallOverlayPreferencesService } from './call-overlay-preferences.service';

/**
 * Companion to `user-calendar-preferences.service.spec.ts` for the call side of
 * the #2033 fallout, and the sharper of the two: the screen-pop overlay is
 * mounted once by the admin shell and refreshes only in its own ngOnInit, so
 * nothing re-fetches these values after boot. A save that failed to land in
 * this cache stayed un-landed for the whole session.
 *
 * `merge()` here rebuilds from a whitelist exactly as the calendar service
 * does, so a keyless bag could not put `undefined` into the overlay's
 * `autoDismissSeconds` — it just could not put the user's value there either.
 */
describe('CallOverlayPreferencesService.update()', () => {
    const STORED = { overlayEnabled: false, autoDismissSeconds: 0, sipEndpoint: 'PJSIP/2002' };

    function setup(): CallOverlayPreferencesService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                CallOverlayPreferencesService,
                { provide: ApiService, useValue: { getSettings: () => of({ call: {} }) } },
            ],
        });

        return TestBed.inject(CallOverlayPreferencesService);
    }

    it('applies a keyed section to the live signals', () => {
        const svc = setup();

        svc.update(STORED);

        // `false` and `0` are both real user choices here — popup off, and
        // "keep the card until I close it" — so neither may fall back.
        expect(svc.overlayEnabled()).toBeFalse();
        expect(svc.autoDismissSeconds()).toBe(0);
        expect(svc.sipEndpoint()).toBe('PJSIP/2002');
    });

    it('keeps wire junk out of the VO — a keyless bag stores nothing and changes nothing', () => {
        const svc = setup();
        svc.update(STORED);

        const hydra = { member: Object.values(STORED), totalItems: 3 };
        svc.update(hydra as unknown as Partial<typeof STORED>);

        expect(Object.keys(svc.prefs()).sort()).toEqual(
            ['autoDismissSeconds', 'overlayEnabled', 'sipEndpoint'],
        );
        expect(svc.overlayEnabled()).toBeFalse();
        expect(svc.autoDismissSeconds()).toBe(0);
        expect(svc.sipEndpoint()).toBe('PJSIP/2002');
    });
});
