import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { type Observable, of, throwError } from 'rxjs';
import { ComponentRegistry, ThemeService } from '@coolms/core-angular';
import { PageTitleService, ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { ConsoleSettingsService } from '../settings/console-settings.service';
import { type DeclaredSection, DeclaredSettingsService } from './declared-settings.service';
import { IdentityApiService } from './identity-api.service';
import { type ProfileSection } from './identity.types';
import { ProfilePageComponent } from './profile-page.component';

function declared(section: string, keys: ReadonlyArray<Record<string, unknown>> = [{ key: 'k' }]): DeclaredSection {
    return { section, label: section, icon: 'x', version: 'v', keys } as unknown as DeclaredSection;
}

const OLD: ReadonlyArray<ProfileSection> = ['calendar', 'preferences', 'ui', 'mail'].map(section => ({
    section, label: section, icon: 'x', formId: `f:${section}`,
}));

describe('ProfilePageComponent -- its tabs', () => {
    let themes: unknown[];
    let accents: unknown[];
    let consoleLoads: number;
    let settingsReads: number;
    let calendars: unknown[];

    function build(read: () => Observable<ReadonlyArray<DeclaredSection>>): ProfilePageComponent {
        themes = [];
        accents = [];
        consoleLoads = 0;
        settingsReads = 0;
        calendars = [];
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: IdentityApiService,
                    useValue: {
                        getMe: () => of({ id: 'u', identifier: 'a@example.test' }),
                        getSettingsSections: () => of(OLD),
                        getSettings: () => {
                            ++settingsReads;
                            return of({ calendar: { tz: 'Europe/Berlin' } });
                        },
                    },
                },
                { provide: Store, useValue: { selectSnapshot: () => null, dispatch: () => of(null) } },
                { provide: ToastService, useValue: { error: () => undefined, success: () => undefined } },
                { provide: PageTitleService, useValue: { set: () => undefined } },
                { provide: UserCalendarPreferencesService, useValue: { update: (c: unknown) => calendars.push(c) } },
                {
                    provide: ThemeService,
                    useValue: { update: (t: unknown) => themes.push(t), updateAccent: (a: unknown) => accents.push(a) },
                },
                { provide: DeclaredSettingsService, useValue: { read } },
                {
                    provide: ConsoleSettingsService,
                    useValue: {
                        load: () => {
                            ++consoleLoads;
                            return of(undefined);
                        },
                    },
                },
                { provide: ComponentRegistry, useValue: { has: () => false } },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new ProfilePageComponent());
        page.ngOnInit();
        return page;
    }

    const ids = (page: ProfilePageComponent): string[] => page.tabItems().map(t => t.id);

    it('reads in the decided order, without the old sections whose keys moved', () => {
        const page = build(() => of([declared('region'), declared('appearance')]));

        expect(ids(page)).toEqual(['personal', 'region', 'appearance', 'calendar', 'mail', 'security']);
    });

    it('a server without the declared read keeps its older tabs', () => {
        const page = build(() => throwError(() => new Error('404')));

        expect(ids(page)).toEqual(['personal', 'calendar', 'preferences', 'ui', 'mail', 'security']);
    });

    it('Appearance holds the shared section and the console, and leaves out a console with no keys', () => {
        const page = build(() => of([declared('appearance'), declared('console'), declared('region')]));
        page.activeTab.set('appearance');
        expect(page.declaredTab()?.map(s => s.section)).toEqual(['appearance', 'console']);

        const empty = build(() => of([declared('appearance'), declared('console', []), declared('region')]));
        empty.activeTab.set('appearance');
        expect(empty.declaredTab()?.map(s => s.section)).toEqual(['appearance']);
    });

    it('a saved appearance takes effect on the page at once', () => {
        const page = build(() => of([
            declared('appearance', [{ key: 'theme', value: 'dark' }, { key: 'accentColor', value: '#112233' }]),
        ]));

        page.declaredSaved('appearance');

        expect(themes).toEqual(['dark']);
        expect(accents).toEqual(['#112233']);
        expect(consoleLoads).toBe(0);
    });

    it('a saved console section reaches the lists and the sidebar', () => {
        const page = build(() => of([declared('console')]));

        page.declaredSaved('console');

        expect(consoleLoads).toBe(1);
    });

    it('a saved region reaches the calendar readers, through the old keys it also wrote', () => {
        const page = build(() => of([declared('region')]));
        const before = settingsReads;

        page.declaredSaved('region');

        expect(settingsReads).toBe(before + 1);
        expect(calendars).toContain({ tz: 'Europe/Berlin' });
    });
});
