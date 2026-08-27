import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { paginateFlow } from '@coolms/document-engine';
import { FormRenderDefinition, ThemeService } from '@coolms/core-angular';
import { ProfileSection } from '../../api/api.service';
import { DynamicFormComponent, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { CallOverlayPreferencesService } from '../call/call-overlay-preferences.service';
import { ProfileCalendarTabComponent } from './profile-calendar-tab.component';
import { ProfilePageComponent } from './profile-page.component';

/**
 * My Profile — the three save handlers, RUN.
 *
 * This file exists because it could not. `ProfilePageComponent` imports
 * `DynamicFormComponent`, whose rich-text field pulls `@coolms/editor-angular`
 * → `@coolms/document-engine`; the engine's `index.ts` uses ESM-correct
 * `'./layout/page-layout.js'` specifiers against `.ts` sources, and the old
 * `@angular-devkit/build-angular:karma` builder was webpack with no
 * `resolve.extensionAlias`, so it could not follow them. Importing this page
 * from any spec killed the WHOLE suite at build time — ~40 "Can't resolve
 * './layout/x.js'" errors, "Found 1 load error", zero specs executed. The
 * `test` target now runs `@angular/build:karma`, which shares the `build`
 * target's esbuild resolution, so the two agree by construction.
 *
 * `profile-settings-echo.spec.ts` covers the same #2033 fallout from the
 * OUTSIDE: it drives the real ApiService and the real preference services, but
 * where the page's handlers merge the echo it has to REPLICATE those lines by
 * hand. A hand-copied line proves nothing about the line it copies — delete
 * `this.calPrefs.update(updated)` from `saveCalendarPrefs` and that spec stays
 * green while every calendar widget on screen silently keeps the pre-save
 * timezone. This file closes that gap: it renders the real page and lets the
 * real handlers do the merging.
 *
 * The fake backend models API Platform's content negotiation rather than
 * hardcoding a good response, so these stay regression tests: a section is a
 * MAP, and ld+json renders a map as a Hydra Collection with the KEYS STRIPPED.
 * The spec never picks the good shape — the `Accept` header the code sends does.
 */
describe('ProfilePageComponent — save handlers over a real render (#2033/#2034)', () => {
    const THEME_CACHE_KEY  = 'coolms_theme';
    const ACCENT_CACHE_KEY = 'coolms_accent';

    const API_BASE          = '/api/v1';
    const ME_URL            = '/api/v1/auth/me';
    const SETTINGS_URL      = '/api/v1/auth/me/settings';
    const SECTIONS_URL      = '/api/v1/auth/me/settings/sections';
    const CALENDAR_LIST_URL    = `${API_BASE}/calendar`;
    const TIMEZONE_OPTIONS_URL = `${API_BASE}/options/calendar.timezones`;

    const MANIFEST = {
        apiBase: API_BASE,
        identity: {
            meUrl:               ME_URL,
            settingsUrl:         SETTINGS_URL,
            settingsSectionsUrl: SECTIONS_URL,
            settingsSectionUrl:  '/api/v1/auth/me/settings/{section}',
        },
        platformDefaults: {
            timezone:   'UTC',
            dateFormat: 'yyyy-MM-dd',
            timeFormat: '24h',
            weekStart:  'monday',
        },
    };

    /** The three sections the page routes three different ways. */
    const SECTIONS: ProfileSection[] = [
        { section: 'calendar',    label: 'Calendar',    icon: 'calendar', formId: 'calendar:user_preferences' },
        { section: 'call',        label: 'Calls',       icon: 'telephone', formId: 'call:user_settings' },
        { section: 'preferences', label: 'Preferences', icon: 'sliders',  formId: 'identity:user_preferences' },
    ];

    /** What GET /auth/me/settings serves — i.e. what the user had on load. */
    const SETTINGS_ON_LOAD = {
        calendar: {
            tz:                  'UTC',
            dateFormat:          'yyyy-MM-dd',
            timeFormat:          '24h',
            weekStart:           'monday',
            defaultCalendarSlug: null,
        },
        call: {
            overlayEnabled:     true,
            autoDismissSeconds: 8,
            sipEndpoint:        'PJSIP/1001',
        },
        preferences: {
            theme:       'light',
            accentColor: '#112233',
            locale:      'en',
            pageSize:    20,
        },
    };

    const USER = {
        id:             'u-1',
        identifier:     'd.popov@example.test',
        identifierType: 'email',
        isVerified:     true,
        identifiers:    [],
        avatarUrl:      null,
        avatarColor:    null,
        firstName:      'Dmitry',
        lastName:       'Popov',
        fullName:       'Dmitry Popov',
        roles:          ['ROLE_ADMIN'],
        isActive:       true,
        lastLoginAt:    null,
        createdAt:      '2026-01-01T00:00:00+00:00',
        primaryGroup:   null,
        groups:         [],
        groupsCount:    0,
        uiPrefs:        {},
    };

    /**
     * A two-field render definition for the generic Preferences tab — the two
     * fields `saveSection` actually reads off the echo. Plain `text` controls:
     * the widget is not what is under test, the handler is.
     */
    const PREFERENCES_FORM: FormRenderDefinition = {
        id:      'identity:user_preferences',
        context: 'create',
        layout:  [{ type: 'theme' }, { type: 'accentColor' }],
        items:   [
            {
                alias: 'theme', type: 'text', label: 'Theme',
                required: false, readonly: false, locked: false, private: false, validators: [],
            },
            {
                alias: 'accentColor', type: 'text', label: 'Accent',
                required: false, readonly: false, locked: false, private: false, validators: [],
            },
        ],
        actions: [],
    };

    let fixture:   ComponentFixture<ProfilePageComponent>;
    let page:      ProfilePageComponent;
    let http:      HttpTestingController;
    let calPrefs:  UserCalendarPreferencesService;
    let callPrefs: CallOverlayPreferencesService;
    let theme:     ThemeService;

    /**
     * API Platform's content negotiation for a settings section, modelled.
     * A request that did not ask for plain JSON gets the Hydra shape, keys and
     * all — which is to say, no keys.
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

    /** The PATCH a save handler issues, answered with the merged bag as the server does. */
    function flushSave(section: string, stored: Record<string, unknown>): void {
        flushSection(http.expectOne(`${SETTINGS_URL}/${section}`), stored);
    }

    /** Switch tabs the way the tab bar does, and settle the new tab body. */
    function openTab(section: string): void {
        page.activeTab.set(section);
        fixture.detectChanges();
    }

    beforeEach(() => {
        localStorage.removeItem(THEME_CACHE_KEY);
        localStorage.removeItem(ACCENT_CACHE_KEY);

        TestBed.configureTestingModule({
            imports: [ProfilePageComponent],
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                // Covers both roles this graph asks of the store: the API
                // manifest (ApiService, FormRenderService, ThemeService) and
                // `AuthState.currentUser` (the calendar prefs' personal-calendar
                // fallback). The manifest object carries no `id`, so that
                // fallback resolves to null — nothing here leans on it.
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST } },
            ],
        });

        http      = TestBed.inject(HttpTestingController);
        calPrefs  = TestBed.inject(UserCalendarPreferencesService);
        callPrefs = TestBed.inject(CallOverlayPreferencesService);
        theme     = TestBed.inject(ThemeService);

        fixture = TestBed.createComponent(ProfilePageComponent);
        page    = fixture.componentInstance;

        // ngOnInit's forkJoin — the page renders nothing until all three land.
        fixture.detectChanges();
        http.expectOne(ME_URL).flush(USER);
        http.expectOne(SECTIONS_URL).flush({ member: SECTIONS });
        http.expectOne(SETTINGS_URL).flush(SETTINGS_ON_LOAD);
        fixture.detectChanges();
    });

    afterEach(() => {
        http.verify();
        localStorage.removeItem(THEME_CACHE_KEY);
        localStorage.removeItem(ACCENT_CACHE_KEY);
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.style.removeProperty('--cms-accent');
    });

    // ── The builder itself ───────────────────────────────────────────────────

    /**
     * The pin on the change that made this file possible. `paginateFlow` is the
     * export webpack named when it gave up ("export 'paginateFlow' was not
     * found in '@coolms/document-engine' (module has no exports)") — under the
     * old builder the engine resolved to an empty module, so every symbol was
     * undefined and the bundle never linked. Should `test` ever drift back to a
     * resolver that cannot follow the engine's `./x.js` specifiers to its `.ts`
     * sources, this fails as a one-line diagnosis instead of ~40 opaque
     * "Can't resolve" errors and a suite that executes nothing.
     */
    it('resolves @coolms/document-engine to real code, not an empty module', () => {
        expect(typeof paginateFlow).toBe('function');
    });

    it('renders the page, so every component it imports is reachable from a spec', () => {
        expect(page.user()?.fullName).toBe('Dmitry Popov');
        expect(page.sections().length).toBe(3);
        expect(fixture.nativeElement.textContent).toContain('Dmitry Popov');
    });

    // ── ngOnInit seeding ─────────────────────────────────────────────────────

    it('seeds the calendar and call prefs from the load response', () => {
        // Both services are shared with widgets mounted elsewhere in the shell,
        // so the page loading is what saves them a request each.
        expect(calPrefs.tz()).toBe('UTC');
        expect(callPrefs.sipEndpoint()).toBe('PJSIP/1001');
    });

    // ── saveCalendarPrefs ────────────────────────────────────────────────────

    const CALENDAR_SAVED = {
        tz:                  'Europe/Berlin',
        dateFormat:          'dd.MM.yyyy',
        timeFormat:          '12h' as const,
        weekStart:           'sunday' as const,
        defaultCalendarSlug: 'team-ops',
    };

    it('saveCalendarPrefs pushes the echo into the live prefs the widgets read', () => {
        expect(calPrefs.tz()).toBe('UTC');

        page.saveCalendarPrefs('calendar', CALENDAR_SAVED);
        flushSave('calendar', { ...CALENDAR_SAVED });

        // Each of these is read by something already on screen: FullCalendar's
        // timeZone and firstDay, MiniCalendar, the date/time formatting
        // service, the topbar calendar quick-access. The handler's
        // `this.calPrefs.update(updated)` is the only thing that moves them.
        expect(calPrefs.tz()).toBe('Europe/Berlin');
        expect(calPrefs.dateFormat()).toBe('dd.MM.yyyy');
        expect(calPrefs.timeFormat()).toBe('12h');
        expect(calPrefs.weekStart()).toBe('sunday');
        expect(calPrefs.firstDay()).toBe(0);
        expect(calPrefs.defaultCalendarSlug()).toBe('team-ops');
    });

    it('saveCalendarPrefs caches the echo under its section and clears the spinner', () => {
        page.saveCalendarPrefs('calendar', CALENDAR_SAVED);
        expect(page.savingCalendar()).withContext('spinner during the request').toBeTrue();

        flushSave('calendar', { ...CALENDAR_SAVED });

        // `settings()[section]` is what re-seeds a tab body when the user
        // leaves the tab and comes back; a keyless bag there sends the tab to
        // its hardcoded defaults, and the next Save writes THOSE to the server.
        expect(page.settings()['calendar']).toEqual(CALENDAR_SAVED);
        expect(page.savingCalendar()).toBeFalse();
    });

    it('the Calendar tab, re-opened after a save, offers the saved values back', () => {
        page.saveCalendarPrefs('calendar', CALENDAR_SAVED);
        flushSave('calendar', { ...CALENDAR_SAVED });

        // Switching to the tab builds the body from `settings()[section]`, so
        // this runs the cache the handler just wrote through the real
        // component, exactly as a user returning to the tab would. Fed a
        // keyless bag the tab falls to UTC / yyyy-MM-dd / 24h / monday and the
        // next Save writes THOSE over what the user actually stored.
        openTab('calendar');
        http.expectOne(CALENDAR_LIST_URL).flush({ member: [] });
        // The tab's timezone picker is a lazy-select over the
        // `calendar.timezones` OptionSource — rows keyed by `value`, not `id`.
        http.expectOne(r => r.url === TIMEZONE_OPTIONS_URL).flush({
            member: [
                { value: 'UTC',           label: 'UTC',    group: 'Other'  },
                { value: 'Europe/Berlin', label: 'Berlin', group: 'Europe' },
            ],
        });
        fixture.detectChanges();

        const tab = fixture.debugElement
            .query(de => de.componentInstance instanceof ProfileCalendarTabComponent)
            .componentInstance as ProfileCalendarTabComponent;

        expect(tab.tz).toBe('Europe/Berlin');
        expect(tab.dateFormat).toBe('dd.MM.yyyy');
        expect(tab.timeFormat).toBe('12h');
        expect(tab.weekStart).toBe('sunday');
        expect(tab.defaultCalendarSlug).toBe('team-ops');
    });

    it('a failed calendar save leaves the previous prefs alone and stops the spinner', () => {
        page.saveCalendarPrefs('calendar', CALENDAR_SAVED);
        http.expectOne(`${SETTINGS_URL}/calendar`).flush({ detail: 'nope' }, { status: 422, statusText: 'Unprocessable' });

        // A half-applied save is worse than a failed one: the widgets would
        // show a timezone the server does not have.
        expect(calPrefs.tz()).toBe('UTC');
        expect(page.settings()['calendar']).toEqual(SETTINGS_ON_LOAD.calendar);
        expect(page.savingCalendar()).toBeFalse();
    });

    // ── saveCallSettings ─────────────────────────────────────────────────────

    const CALL_SAVED = {
        overlayEnabled:     false,
        autoDismissSeconds: 0,
        sipEndpoint:        'PJSIP/2002',
    };

    it('saveCallSettings reaches the live overlay prefs', () => {
        page.saveCallSettings('call', CALL_SAVED);
        flushSave('call', { ...CALL_SAVED });

        // The screen-pop overlay is mounted once by the admin shell and
        // refreshes only in its own ngOnInit, so a value that fails to land
        // here outlives every route change: the user turns the popup off and it
        // keeps popping up until the tab is reloaded.
        expect(callPrefs.overlayEnabled()).toBeFalse();
        expect(callPrefs.autoDismissSeconds()).toBe(0);
        expect(callPrefs.sipEndpoint()).toBe('PJSIP/2002');
        expect(page.settings()['call']).toEqual(CALL_SAVED);
        expect(page.savingCall()).toBeFalse();
    });

    // ── saveSection, driven through the real DynamicForm ─────────────────────

    /** Open Preferences and answer the form-definition fetch it triggers. */
    function openPreferencesTab(): DynamicFormComponent {
        openTab('preferences');
        http.expectOne(`${API_BASE}/forms/${encodeURIComponent('identity:user_preferences')}/render?context=create`)
            .flush(PREFERENCES_FORM);
        fixture.detectChanges();

        const el = fixture.debugElement.query(de => de.componentInstance instanceof DynamicFormComponent);
        expect(el).withContext('the Preferences tab renders a DynamicFormComponent').not.toBeNull();

        return el.componentInstance as DynamicFormComponent;
    }

    it('the Preferences tab renders the dynamic form seeded from the cached section', () => {
        const form = openPreferencesTab();

        // The surface that had no coverage at all: the form loads a definition,
        // builds its group, and patches it from `settings()['preferences']`.
        expect(form.loading()).toBeFalse();
        expect(form.formGroup().getRawValue()).toEqual({ theme: 'light', accentColor: '#112233' });
    });

    it('submitting the form re-themes on the spot and clears the form spinner', () => {
        const form = openPreferencesTab();
        form.formGroup().patchValue({ theme: 'dark', accentColor: '#3366ff' });

        // The real chain from here: submit() → `submitted` → saveSection().
        form.submit();
        expect(form.saving()).withContext('form spinner during the request').toBeTrue();

        flushSave('preferences', { theme: 'dark', accentColor: '#3366ff', locale: 'en', pageSize: 20 });
        TestBed.flushEffects();
        fixture.detectChanges();

        // The original #2033 report. Both reads take a NAMED field off the
        // echo, so under a keyless Hydra bag both got `undefined` and were
        // dropped by the services' own guards: the save worked, and the admin
        // stayed the colour it already was until the next reload.
        expect(theme.choice()).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(theme.userAccent()).toBe('#3366ff');
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');

        // `settingsForm()?.resetSaving()` — a viewChild call that was
        // unreachable from a spec until this file could exist. Miss it and the
        // button says "Saving…" forever after a successful save.
        expect(form.saving()).toBeFalse();
        expect(page.settings()['preferences']).toEqual({
            theme: 'dark', accentColor: '#3366ff', locale: 'en', pageSize: 20,
        });
    });

    it('a rejected save shows the server detail on the form and re-enables it', () => {
        const form = openPreferencesTab();
        form.formGroup().patchValue({ theme: 'dark', accentColor: 'not-a-hex' });
        form.submit();

        http.expectOne(`${SETTINGS_URL}/preferences`)
            .flush({ detail: 'accentColor: must be a 6-digit hex colour.' }, { status: 422, statusText: 'Unprocessable' });
        fixture.detectChanges();

        // The error branch reads `e.error.detail` and hands it to the same
        // viewChild. Without it the user gets a generic toast and no idea which
        // field the server rejected.
        expect(form.serverError()).toBe('accentColor: must be a 6-digit hex colour.');
        expect(form.saving()).toBeFalse();
        expect(fixture.nativeElement.textContent).toContain('must be a 6-digit hex colour');

        // Nothing may be applied from a rejected save.
        expect(theme.choice()).not.toBe('dark');
        expect(page.settings()['preferences']).toEqual(SETTINGS_ON_LOAD.preferences);
    });
});
