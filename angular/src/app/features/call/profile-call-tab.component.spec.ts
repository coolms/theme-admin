import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { ComponentRegistry } from '@coolms/core-angular';
import { ProfileSection } from '../identity/identity.types';
import { ProfilePageComponent } from '../identity/profile-page.component';
import { CallOverlayPreferencesService } from './call-overlay-preferences.service';
import { ProfileCallTabComponent } from './profile-call-tab.component';

/**
 * The Calls pane ON the profile page -- Call's guest in Identity's
 * `profile.tab` slot, rendered by the real page through the real slot.
 *
 * This spec lives in features/call and imports the page from features/identity;
 * the page imports nothing from here. The only link between the two is the
 * registry key `profile.tab:call`, which app.config.ts binds for the app and
 * this file binds for the suite. Everything the pane used to receive from the
 * page (`initial`, `saving`, a `(saved)` handler that PATCHed and seeded the
 * overlay prefs) it now does itself, so what is pinned here is the whole
 * round trip a user makes: open the tab, see what is stored, press Save, and
 * find the live overlay running on the new values.
 *
 * The fake backend models API Platform's content negotiation as the identity
 * specs do: a PATCH that did not ask for plain JSON gets the Hydra shape with
 * the keys stripped, and a keyless echo lands nothing in the overlay prefs.
 * Drop the `Accept` header from `updateSettings()` and the save test fails at
 * the user-visible consequence, not at a header string.
 */
describe('ProfileCallTabComponent -- the Calls pane on My Profile', () => {
    const API_BASE     = '/api/v1';
    const ME_URL       = `${API_BASE}/auth/me`;
    const SETTINGS_URL = `${API_BASE}/auth/me/settings`;
    const SECTIONS_URL = `${API_BASE}/auth/me/settings/sections`;

    const MANIFEST = {
        apiBase: API_BASE,
        identity: {
            meUrl:               ME_URL,
            settingsUrl:         SETTINGS_URL,
            settingsSectionsUrl: SECTIONS_URL,
            settingsSectionUrl:  `${API_BASE}/auth/me/settings/{section}`,
        },
        platformDefaults: {
            timezone:   'UTC',
            dateFormat: 'yyyy-MM-dd',
            timeFormat: '24h',
            weekStart:  'monday',
        },
    };

    const SECTIONS: ProfileSection[] = [
        { section: 'call',        label: 'Calls',       icon: 'telephone', formId: 'call:user_settings' },
        { section: 'preferences', label: 'Preferences', icon: 'sliders',   formId: 'identity:user_preferences' },
    ];

    const USER = {
        id: 'u-1', identifier: 'd.popov@example.test', identifierType: 'email', isVerified: true,
        identifiers: [], avatarUrl: null, avatarColor: null, firstName: 'Dmitry', lastName: 'Popov',
        fullName: 'Dmitry Popov', roles: ['ROLE_ADMIN'], isActive: true, lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00+00:00', primaryGroup: null, groups: [], groupsCount: 0, uiPrefs: {},
    };

    /** What the server stores when the page opens. */
    const STORED = { overlayEnabled: true, autoDismissSeconds: 8, sipEndpoint: 'PJSIP/1001' };
    /** What the user changes it to. */
    const SAVED  = { overlayEnabled: false, autoDismissSeconds: 0, sipEndpoint: 'PJSIP/2002' };

    // The binding app.config.ts makes for the app, made for the suite. The
    // registry is a static map, so this holds for every spec after it -- which
    // is why the identity specs list no `call` section of their own.
    ComponentRegistry.register('profile.tab:call', ProfileCallTabComponent);

    let fixture:   ComponentFixture<ProfilePageComponent>;
    let page:      ProfilePageComponent;
    let http:      HttpTestingController;
    let callPrefs: CallOverlayPreferencesService;

    /** API Platform's negotiation for a settings section: keys only for a request that asked for plain JSON. */
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
     * Open the Calls tab the way the tab bar does. The pane asks the server
     * for its section as it opens -- answer with `stored` -- and settle.
     */
    function openCallsTab(stored: Record<string, unknown>): ProfileCallTabComponent {
        page.activeTab.set('call');
        fixture.detectChanges();
        http.expectOne(SETTINGS_URL).flush({ call: stored });
        fixture.detectChanges();

        const el = fixture.debugElement.query(de => de.componentInstance instanceof ProfileCallTabComponent);
        expect(el).withContext('the Calls tab renders the pane through the slot').not.toBeNull();

        return el.componentInstance as ProfileCallTabComponent;
    }

    function saveButton(): HTMLButtonElement {
        const btn = (fixture.nativeElement as HTMLElement).querySelector('.tab-footer button.cms-btn-primary');
        expect(btn).withContext('the pane brings its own Save button').not.toBeNull();

        return btn as HTMLButtonElement;
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [ProfilePageComponent],
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST } },
            ],
        });

        http      = TestBed.inject(HttpTestingController);
        callPrefs = TestBed.inject(CallOverlayPreferencesService);

        fixture = TestBed.createComponent(ProfilePageComponent);
        page    = fixture.componentInstance;

        fixture.detectChanges();
        http.expectOne(ME_URL).flush(USER);
        http.expectOne(SECTIONS_URL).flush({ member: SECTIONS });
        http.expectOne(SETTINGS_URL).flush({ call: STORED, preferences: {} });
        fixture.detectChanges();
    });

    afterEach(() => http.verify());

 it('renders on the profile page as before: the Calls tab is the pane, seeded from what the server stores, with its own Save', () => {
 // The page loaded the section with the others but seeds nothing into
 // Call: the pane asked for itself (the GET openCallsTab answers).
        const pane = openCallsTab(STORED);
        const host = fixture.nativeElement as HTMLElement;

        expect(pane.section()).toBe('call');
        expect(pane.overlayEnabled).toBeTrue();
        expect(pane.autoDismissSeconds).toBe(8);
        expect(pane.sipEndpoint).toBe('PJSIP/1001');

        expect(host.querySelector('#call-dismiss')).withContext('auto-dismiss field').not.toBeNull();
        expect(host.querySelector('#call-endpoint')).withContext('device field').not.toBeNull();
        expect(host.querySelector('.phone-card')).withContext('softphone status card').not.toBeNull();
        expect(saveButton().textContent).toContain('Save changes');
        expect(host.querySelector('.profile-footer')).withContext('no second footer from the page').toBeNull();

 // Opening the pane re-synced the live overlay as a side effect.
        expect(callPrefs.sipEndpoint()).toBe('PJSIP/1001');
    });

 it('Save PATCHes the section through Call, and the live overlay prefs take the echo', () => {
        const pane = openCallsTab(STORED);
        pane.overlayEnabled     = false;
        pane.autoDismissSeconds = 0;
        pane.sipEndpoint        = ' PJSIP/2002 ';

        saveButton().click();

        const req = http.expectOne(`${SETTINGS_URL}/call`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual(SAVED);
        expect(pane.saving()).withContext('the button is disabled while the PATCH is in flight').toBeTrue();

        flushSection(req, { ...SAVED });

 // The screen-pop overlay is mounted once by the admin shell and
 // refreshes only in its own ngOnInit, so a value that fails to land
 // here outlives every route change: the user turns the popup off and it
 // keeps popping up until the tab is reloaded.
        expect(callPrefs.overlayEnabled()).toBeFalse();
        expect(callPrefs.autoDismissSeconds()).toBe(0);
        expect(callPrefs.sipEndpoint()).toBe('PJSIP/2002');
        expect(pane.saving()).toBeFalse();
        expect(pane.sipEndpoint).withContext('the form re-seeds from the echo').toBe('PJSIP/2002');
    });

 it('re-opening the Calls tab after a save offers the saved values back -- the pane asks the server, not a cache', () => {
        const first = openCallsTab(STORED);
        first.sipEndpoint = 'PJSIP/2002';
        first.save();
        flushSection(http.expectOne(`${SETTINGS_URL}/call`), { ...STORED, sipEndpoint: 'PJSIP/2002' });

        page.activeTab.set('personal');
        fixture.detectChanges();

 // The blank-string default is the dangerous one: an endpoint the pane
 // never saw is an endpoint the next Save clears, and click-to-dial stops
 // working for a user who merely visited the tab twice.
        const again = openCallsTab({ ...STORED, sipEndpoint: 'PJSIP/2002' });
        expect(again).not.toBe(first);
        expect(again.sipEndpoint).toBe('PJSIP/2002');
    });

 it('a rejected save leaves the live prefs alone and re-enables the button', () => {
        const pane = openCallsTab(STORED);
        pane.sipEndpoint = 'PJSIP/2002';
        pane.save();

        http.expectOne(`${SETTINGS_URL}/call`).flush({ detail: 'no' }, { status: 422, statusText: 'Unprocessable' });

        expect(callPrefs.sipEndpoint()).toBe('PJSIP/1001');
        expect(pane.saving()).toBeFalse();
    });
});
