import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ConsoleActivation, CONSOLE_ENTRIES, consoleChildren } from '@coolms/core-angular';

import { CallDialQuickAccessComponent } from '../call-dial-quick-access.component';
import { CallScreenpopOverlayComponent } from '../call-screenpop-overlay.component';
import { ProfileCallTabComponent } from '../profile-call-tab.component';
import entry from './console';

/**
 * Call's console entry, the first module moved off the shell's compiled-in
 * lists: what it declares, how the host mounts it, and that the manifest --
 * not the bundle -- decides whether any of it shows.
 */
describe('Call: console entry', () => {
 it('declares the two mounts, the profile pane, the dial tile and the screen-pop', () => {
        expect(entry.module).toBe('call');
        expect(entry.range).toBe('^1.0');
        expect(entry.routes?.map(r => r.path)).toEqual(['call/records', 'call/wallboard']);
        expect(entry.bindings).toEqual([{ name: 'profile.tab:call', component: ProfileCallTabComponent }]);
        expect(entry.topbar).toEqual([{ id: 'call.dial', order: 50, component: CallDialQuickAccessComponent }]);
        expect(entry.overlays).toEqual([{ id: 'call.screenpop', component: CallScreenpopOverlayComponent }]);
    });

 it('mounts as two lazy children under the layout, each answering to the manifest', () => {
        const routes = consoleChildren([entry]);
        expect(routes.map(r => r.path)).toEqual(['call/records', 'call/wallboard']);
        expect(routes[0].loadChildren).toBeDefined();
        expect(routes[0].data).toEqual({ activeNav: '/call/records' });
        expect(routes[1].loadComponent).toBeDefined();
        expect(routes[1].data).toEqual({ activeNav: '/call/wallboard' });
        expect(routes.every(r => r.canMatch?.length === 1)).toBeTrue();
    });

    const configure = (installed: string[]) => {
        TestBed.resetTestingModule();
        const manifest = { apiBase: '/api/v1', ui: { contracts: { console: '1.0' }, modules: installed.map(m => ({ module: m, contract: 'console', range: '^1.0', framework: 'angular' })) } };
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: Store, useValue: { selectSignal: () => () => manifest, selectSnapshot: () => manifest, select: () => of(manifest) } },
                { provide: CONSOLE_ENTRIES, useValue: [entry] },
            ],
        });
        return TestBed.inject(ConsoleActivation);
    };

 it('shows the tile and the overlay only where the manifest lists call', () => {
        const on = configure(['call']);
        expect(on.topbar().map(t => t.id)).toEqual(['call.dial']);
        expect(on.overlays().map(o => o.id)).toEqual(['call.screenpop']);
        expect(on.missing()).toEqual([]);

        const off = configure(['email']);
        expect(off.topbar()).toEqual([]);
        expect(off.overlays()).toEqual([]);
        expect(off.isInstalled('call')).toBeFalse();
 // The manifest names a module this build has no entry for: said by name, not silent.
        expect(off.missing()).toEqual(['email']);
    });
});
