import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { ThemeService } from '@coolms/core-angular';
import { ApiService } from '../../api/api.service';
import { CallOverlayPrefs, CallOverlayPreferencesService } from '../call/call-overlay-preferences.service';
import { CalendarPrefs, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { ProfileCalendarTabComponent } from './profile-calendar-tab.component';
import { ProfileCallTabComponent } from './profile-call-tab.component';

/**
 * downstream audit — what the section PATCH's echo DID to the caches.
 *
 * `updateSettings()` used to go out without `Accept: application/json`, so API
 * Platform answered in ld+json. A settings section is a MAP, and ld+json
 * renders a map as a Hydra Collection with the KEYS STRIPPED:
 * `{"member":["Europe/Berlin","dd.MM.yyyy","12h","sunday","team-ops"]}`. The
 * PATCH persisted correctly — only the echo was keyless — and all three save
 * handlers in `profile-page.component.ts` merge that echo into a cache.
 *
 * The header itself is pinned by `api/api.service.settings.spec.ts`.
 * What was never covered is the CONSEQUENCE, which is where a user felt it:
 *
 *  - the two preference services rebuild their VO from a whitelist, so a
 *    keyless bag contributes NOTHING and every field resolves from the
 *    previous value. No junk, no error — the save simply did not land in
 *    memory, and the widgets already on screen kept the old values.
 *  - the page's `settings` signal DID keep the keyless bag, and that is what
 *    re-seeds a tab body when the user leaves the tab and comes back. Fed one,
 *    the tab falls to its hardcoded defaults — and the next Save writes THOSE
 *    to the server.
 *
 * Each spec runs the real chain: the real `ApiService.updateSettings()` over a
 * fake backend that models the actual content negotiation (a request that did
 * not ask for plain JSON gets the Hydra shape), into the real preference
 * services, into a real tab component re-created from the cached section. Drop
 * the header again and these go red where a user would notice, not at a header
 * string.
 *
 * BOUNDARY — the one link these cannot execute is `ProfilePageComponent`
 * itself: it imports `DynamicFormComponent`, whose rich-text field pulls
 * `@coolms/editor-angular` -> `@coolms/document-engine`, and the karma builder
 * (webpack) cannot resolve that package's `./x.js` specifiers to its `.ts`
 * sources the way the esbuild application builder does — importing the page
 * fails the whole suite at build time. So the three `update(...)` calls below
 * are written out here exactly as the handlers make them
 * (profile-page.component.ts:571-572, :595-596, :612, :618-619); everything on
 * either side of those lines is the real thing.
 */
describe('Settings-section echo -> profile caches', () => {
    const THEME_CACHE_KEY  = 'coolms_theme';
    const ACCENT_CACHE_KEY = 'coolms_accent';

    const MANIFEST = {
        apiBase: '/api/v1',
        identity: {
            settingsUrl:        '/api/v1/auth/me/settings',
            settingsSectionUrl: '/api/v1/auth/me/settings/{section}',
        },
        platformDefaults: {
            timezone:   'UTC',
            dateFormat: 'yyyy-MM-dd',
            timeFormat: '24h',
            weekStart:  'monday',
        },
    };

    let api:       ApiService;
    let http:      HttpTestingController;
    let calPrefs:  UserCalendarPreferencesService;
    let callPrefs: CallOverlayPreferencesService;
    let theme:     ThemeService;

    /**
     * API Platform's content negotiation for a settings section, modelled.
     *
     * The response shape is decided by the REQUEST, which is what makes these
     * regression tests rather than a restatement of the fixed code: the spec
     * never chooses the good shape, the header the code sends does.
     */
    function flushSection(req: TestRequest, body: Record<string, unknown>): void {
        if ('application/json' === req.request.headers.get('Accept')) {
            req.flush(body);
            return;
        }
        req.flush({
            '@context':  '/api/contexts/Settings',
            '@type':     'Collection',
            member:      Object.values(body),
            totalItems:  Object.keys(body).length,
        });
    }

    /**
     * Save a section and return what the handler would hold as `updated` —
     * the value it merges into `settings` and hands to the prefs services.
     * `stored` is the whole merged bag the server answers with, as it does.
     */
    function saveSection(section: string, stored: Record<string, unknown>): Record<string, unknown> {
        let echo: Record<string, unknown> = {};
        api.updateSettings(section, stored).subscribe(r => (echo = r));
        flushSection(http.expectOne(`/api/v1/auth/me/settings/${section}`), stored);

        return echo;
    }

    beforeEach(() => {
        localStorage.removeItem(THEME_CACHE_KEY);
        localStorage.removeItem(ACCENT_CACHE_KEY);

        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
 // Covers both roles this graph asks of the store: the API
 // manifest (ApiService, platform defaults) and
 // `AuthState.currentUser` — the manifest object carries no
 // `id`, so the personal-calendar fallback resolves to null,
 // which nothing here leans on.
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST } },
            ],
        });

        api       = TestBed.inject(ApiService);
        http      = TestBed.inject(HttpTestingController);
        calPrefs  = TestBed.inject(UserCalendarPreferencesService);
        callPrefs = TestBed.inject(CallOverlayPreferencesService);
        theme     = TestBed.inject(ThemeService);
    });

    afterEach(() => {
        http.verify();
        localStorage.removeItem(THEME_CACHE_KEY);
        localStorage.removeItem(ACCENT_CACHE_KEY);
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.style.removeProperty('--cms-accent');
    });

 // -- Calendar tab ---------------------------------------------------------

    /** What the user had when the page loaded, as GET /settings served it. */
    const CALENDAR_BEFORE: CalendarPrefs = {
        tz:                  'UTC',
        dateFormat:          'yyyy-MM-dd',
        timeFormat:          '24h',
        weekStart:           'monday',
        defaultCalendarSlug: null,
    };

    const CALENDAR_SAVED: CalendarPrefs = {
        tz:                  'Europe/Berlin',
        dateFormat:          'dd.MM.yyyy',
        timeFormat:          '12h',
        weekStart:           'sunday',
        defaultCalendarSlug: 'team-ops',
    };

 it('a calendar save reaches the live prefs — the widgets do not keep the pre-save values', () => {
        calPrefs.update(CALENDAR_BEFORE);              // page ngOnInit seeds from GET /settings
        expect(calPrefs.tz()).toBe('UTC');

        const echo = saveSection('calendar', { ...CALENDAR_SAVED });
        calPrefs.update(echo as Partial<CalendarPrefs>);   // profile-page.component.ts:572

 // Every one of these is read by something already on screen:
 // FullCalendar's timeZone and firstDay, MiniCalendar, the date/time
 // formatting service, and the topbar calendar quick-access.
        expect(calPrefs.tz()).toBe('Europe/Berlin');
        expect(calPrefs.dateFormat()).toBe('dd.MM.yyyy');
        expect(calPrefs.timeFormat()).toBe('12h');
        expect(calPrefs.weekStart()).toBe('sunday');
        expect(calPrefs.firstDay()).toBe(0);
        expect(calPrefs.defaultCalendarSlug()).toBe('team-ops');
    });

 it('re-opening the Calendar tab after a save offers the saved values back, not defaults', () => {
        const echo = saveSection('calendar', { ...CALENDAR_SAVED });

 // Switching profile tabs destroys the tab body and builds a new one
 // from `settings()[section]`, which is this echo; the component reads
 // `initial` once, in ngOnInit. Fed a keyless bag it falls to
 // UTC / yyyy-MM-dd / 24h / monday / personal — and the next Save
 // writes those over what the user actually stored, which is how a
 // mangled echo turns into data loss.
        const tab = TestBed.createComponent(ProfileCalendarTabComponent);
        tab.componentRef.setInput('initial', echo);

        let emitted: CalendarPrefs | undefined;
        tab.componentInstance.saved.subscribe(v => (emitted = v));

        tab.componentInstance.ngOnInit();
        http.expectOne(`${MANIFEST.apiBase}/calendar`).flush({ member: [] });
        tab.componentInstance.save();

        expect(emitted).toEqual(CALENDAR_SAVED);
    });

 // -- Calls tab ------------------------------------------------------------

    const CALL_BEFORE: CallOverlayPrefs = {
        overlayEnabled:     true,
        autoDismissSeconds: 8,
        sipEndpoint:        'PJSIP/1001',
    };

    const CALL_SAVED: CallOverlayPrefs = {
        overlayEnabled:     false,
        autoDismissSeconds: 0,
        sipEndpoint:        'PJSIP/2002',
    };

 it('a call-settings save reaches the live overlay prefs', () => {
        callPrefs.update(CALL_BEFORE);
        expect(callPrefs.overlayEnabled()).toBeTrue();

        const echo = saveSection('call', { ...CALL_SAVED });
        callPrefs.update(echo as Partial<CallOverlayPrefs>);   // profile-page.component.ts:596

 // The screen-pop overlay is mounted once by the admin shell and
 // refreshes only in its own ngOnInit, so a value that fails to land
 // here outlives every route change: the user turns the popup off and
 // it keeps popping up until the tab is reloaded.
        expect(callPrefs.overlayEnabled()).toBeFalse();
        expect(callPrefs.autoDismissSeconds()).toBe(0);
        expect(callPrefs.sipEndpoint()).toBe('PJSIP/2002');
    });

 it('re-opening the Calls tab after a save keeps the SIP endpoint', () => {
        const echo = saveSection('call', { ...CALL_SAVED });

        const tab = TestBed.createComponent(ProfileCallTabComponent);
        tab.componentRef.setInput('initial', echo);

        let emitted: CallOverlayPrefs | undefined;
        tab.componentInstance.saved.subscribe(v => (emitted = v));

        tab.componentInstance.ngOnInit();
        tab.componentInstance.save();

 // The blank-string default is the dangerous one: an endpoint the tab
 // never saw is an endpoint the next Save clears, and click-to-dial
 // stops working for a user who merely visited the tab twice.
        expect(emitted).toEqual(CALL_SAVED);
    });

 // -- Preferences tab ------------------------------------------------------

 it('a preferences save re-themes on the spot', () => {
        const echo = saveSection(
            'preferences',
            { theme: 'dark', accentColor: '#3366ff', locale: 'en', pageSize: 20 },
        );

        theme.update(echo['theme']);              // profile-page.component.ts:618
        theme.updateAccent(echo['accentColor']);  // profile-page.component.ts:619
        TestBed.flushEffects();

 // The original report. Both of these read a NAMED field off the
 // echo, so both received `undefined` and were dropped by the service's
 // own guards: the save worked, and the admin stayed the colour it
 // already was until the next reload.
        expect(theme.choice()).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(theme.userAccent()).toBe('#3366ff');
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');
    });

 it('the echo a generic section caches is keyed, so the dynamic form can re-seed from it', () => {
        const echo = saveSection(
            'preferences',
            { theme: 'dark', accentColor: '#3366ff', locale: 'en', pageSize: 20 },
        );

 // DynamicFormComponent patches its group from `initialValue` once, when
 // the definition arrives. A `{member:[…]}` bag is non-empty, so the
 // patch RAN, matched no control, and the re-opened form showed the
 // definition's defaults with nothing to suggest anything was wrong.
        expect(Object.keys(echo)).not.toContain('member');
        expect(echo['theme']).toBe('dark');
        expect(echo['pageSize']).toBe(20);
    });
});
