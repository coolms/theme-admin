import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';

import {
    AppInitService,
    ComponentRegistry,
    ConsoleAccessService,
    ConsoleActivation,
    ErrorHandlerService,
    NaviGraphService,
    UserPreferencesService,
} from '@coolms/core-angular';
import { ConfirmDialogService, FormRenderService, ToastService } from '@coolms/ui-angular';

import { ModuleSettingsService } from './module-settings.service';
import { ModuleSettingsBlockDto } from './module-settings.types';
import { MODULE_SETTINGS_ROUTE, SETTINGS_ROUTES } from './settings.routes';
import { SETTINGS_PANE_SLOT, SettingsHubPageComponent } from './settings-hub.page';

/** Something a module binds under one of its settings. */
@Component({ selector: 'app-pane-extra-stub', standalone: true, template: 'extra' })
class PaneExtraStubComponent {}

/**
 * The scope of the Settings screen is chosen by the route, never by the setting picked.
 *
 * Global (`/settings/{module}/{key}`) lists every module; picking another module's setting changes only the pane and
 * the URL. Module (`/{module}/settings/{key}`) lists that module only. Before the shell, the global URL and a
 * module's own URL were one shape, so picking a setting of another module turned the global list into that module's.
 */
describe('SettingsHubPageComponent -- the route chooses the scope', () => {
    function block(module: string, key: string, label: string): ModuleSettingsBlockDto {
        return {
            key, module, label, moduleLabel: module.toUpperCase(), moduleIcon: null, moduleRoute: null, formId: null,
            data: {}, defaults: {}, effective: {}, locked: {},
        } as unknown as ModuleSettingsBlockDto;
    }

    const BLOCKS = [block('call', 'call.originate', 'Originate'), block('email', 'email.sync', 'Sync')];

    let installed: Set<string>;
    let routing: RouterTestingHarness;
    let router: Router;

    beforeEach(async () => {
        installed = new Set(['settings']);
        TestBed.configureTestingModule({
            providers: [
                provideRouter([
                    MODULE_SETTINGS_ROUTE,
                    { path: 'settings', children: SETTINGS_ROUTES },
                    { path: 'dashboard', children: [] },
                ]),
                { provide: ModuleSettingsService, useValue: { list: () => of(BLOCKS), get: () => NEVER } },
                { provide: FormRenderService, useValue: { fetch: () => NEVER } },
                { provide: NaviGraphService, useValue: { loadTree: () => NEVER, isVisible: () => true, matchesShowWhen: () => true } },
                { provide: Store, useValue: { select: () => of([]), selectSnapshot: () => undefined } },
                { provide: UserPreferencesService, useValue: { getPageState: () => null, setPageState: () => undefined } },
                { provide: ConfirmDialogService, useValue: { confirmDiscard: () => of(true), confirm: () => of(true) } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                // What a module mount's canMatch asks: is Settings installed here.
                { provide: AppInitService, useValue: { ready$: of(true) } },
                { provide: ConsoleAccessService, useValue: { ensure: () => Promise.resolve() } },
                { provide: ConsoleActivation, useValue: { isInstalled: (m: string) => installed.has(m) } },
            ],
        });
        routing = await RouterTestingHarness.create();
        router = TestBed.inject(Router);
    });

    /** The entries of the section list, by their labels. */
    function listed(): string[] {
        return Array.from(routing.routeNativeElement?.querySelectorAll('nav button, aside button') ?? [])
            .map(b => (b.textContent ?? '').trim())
            .filter(t => 'Originate' === t || 'Sync' === t);
    }

    function entry(label: string): HTMLButtonElement {
        const found = Array.from(routing.routeNativeElement?.querySelectorAll('button') ?? [])
            .find(b => (b.textContent ?? '').trim() === label);
        expect(found).withContext(`an entry "${label}" in the list`).toBeDefined();

        return found as HTMLButtonElement;
    }

    it('a module\'s extra under a setting is what it bound to settings.pane:<key>, for that setting only', async () => {
        await routing.navigateByUrl('/settings/email/email.sync');
        const hub = routing.routeDebugElement?.componentInstance as SettingsHubPageComponent;
        TestBed.inject(ComponentRegistry).register('settings.pane:email.sync', PaneExtraStubComponent);

        expect(hub.paneExtraKey('email.sync')).toBe(`${SETTINGS_PANE_SLOT}:email.sync`);
        expect(hub.hasPaneExtra('email.sync')).toBeTrue();
        expect(hub.hasPaneExtra('call.originate')).withContext('another setting has none').toBeFalse();
    });

    it('from the global route, picking another module\'s setting keeps the global list and the global URL', async () => {
        await routing.navigateByUrl('/settings/call/call.originate');
        routing.detectChanges();
        expect(listed()).withContext('the global list, before').toEqual(['Originate', 'Sync']);

        entry('Sync').click();
        await routing.fixture.whenStable();
        routing.detectChanges();

        expect(router.url).toBe('/settings/email/email.sync');
        expect(listed()).withContext('the global list, after picking another module\'s setting').toEqual(['Originate', 'Sync']);
    });

    it('a module\'s own route lists that module only, and keeps its URL shape when a setting is picked', async () => {
        await routing.navigateByUrl('/email/settings/email.sync');
        routing.detectChanges();

        expect(listed()).toEqual(['Sync']);
        expect(routing.routeNativeElement?.textContent).toContain('EMAIL settings');
        expect(router.url).toBe('/email/settings/email.sync');
    });

    it('a module\'s own settings route exists only where Settings is installed, like every module mount', async () => {
        installed = new Set();

        await expectAsync(routing.navigateByUrl('/email/settings/email.sync')).toBeRejected();
    });

    it('the global route with nothing selected opens the first setting', async () => {
        await routing.navigateByUrl('/settings');
        routing.detectChanges();
        await routing.fixture.whenStable();

        expect(router.url).toBe('/settings/call/call.originate');
    });
});
