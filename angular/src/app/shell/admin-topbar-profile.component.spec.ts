import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';

/**
 * The profile menu's ink, in the light theme.
 *
 * The topbar is dark in both themes and sets `color: var(--cms-sidebar-text)`
 * on itself (admin-layout.component.ts) so its 40 children agree on a light
 * ink. The menu is a child of the bar, so it inherited that ink too -- and
 * `bg-white`, re-varred to `--cms-surface`, painted it white in the light
 * theme: light text on white, the entries present and unreadable. Reported
 * 2026-09-21 from the served admin.
 *
 * The host below is the bar as the menu sees it: dark ink set by an ancestor,
 * with the page tokens on the root as the light theme defines them.
 */
describe('AdminTopbarProfileComponent -- the menu in the light theme', () => {
    const BAR_INK  = 'rgb(201, 211, 224)';
    const PAGE_INK = 'rgb(17, 24, 39)';
    const SURFACE  = 'rgb(255, 255, 255)';

    @Component({
        selector: 'spec-topbar',
        standalone: true,
        imports: [AdminTopbarProfileComponent],
        template: `<div class="bar" [style.color]="ink"><app-admin-topbar-profile /></div>`,
    })
    class SpecTopbar {
        ink = BAR_INK;
    }

    let httpMock: HttpTestingController;

    beforeEach(() => {
        document.documentElement.style.setProperty('--cms-text', PAGE_INK);
        document.documentElement.style.setProperty('--cms-surface', SURFACE);

        TestBed.configureTestingModule({
            imports: [SpecTopbar],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideRouter([]),
                {
                    provide:  Store,
                    useValue: {
                        selectSnapshot: () => ({
                            apiBase:  '/api/v1',
                            identity: { elevationUrl: '/api/v1/auth/elevation' },
                            navi:     { topbarNavGraph: '/api/v1/navi/topbar' },
                        }),
                        select:   () => of({ identifier: 'd.popov@example.test' }),
                        dispatch: () => of(null),
                    },
                },
                { provide: ConfirmDialogService, useValue: { open: () => of(false) } },
                {
                    provide:  NaviGraphService,
                    useValue: {
                        loadTopbarNav: () => of([{
                            id: 'profile', path: '/profile', title: 'My Profile', parentId: null, sortOrder: 10,
                            isActive: true, isVisible: true, meta: { icon: 'person' }, children: [],
                        }]),
                        getTree: () => of([]),
                        tree:    () => [],
                    },
                },
                {
                    provide:  UserCalendarPreferencesService,
                    useValue: { ensureLoaded: () => undefined, tz: () => 'UTC', dateFormat: () => 'yyyy-MM-dd', timeFormat: () => '24h' },
                },
            ],
        });
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.match(() => true).forEach(r => r.flush({
            elevated: false, expiresAt: null, ended: { reason: 'never', at: null },
            lifetimeSeconds: 900, lifetimeCeilingSeconds: 3600, mfaRequired: false, warnings: [],
        }));
        httpMock.verify();
        document.documentElement.style.removeProperty('--cms-text');
        document.documentElement.style.removeProperty('--cms-surface');
    });

 it('paints the page surface and the page ink, not the bar ink it sits under', () => {
        const fixture = TestBed.createComponent(SpecTopbar);
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        (host.querySelector('app-admin-topbar-profile button') as HTMLButtonElement).click();
        fixture.detectChanges();

        const panel = host.querySelector('app-admin-topbar-profile .position-absolute') as HTMLElement;
        expect(panel).withContext('the menu opened').not.toBeNull();
        const email = panel.querySelector('.fw-semibold') as HTMLElement;
        const item  = panel.querySelector('.dropdown-item') as HTMLElement;
        expect(item).withContext('the navi node rendered as a menu entry').not.toBeNull();

        expect(getComputedStyle(host.querySelector('.bar')!).color).withContext('the bar ink is what the host set').toBe(BAR_INK);
        expect(getComputedStyle(panel).backgroundColor).toBe(SURFACE);
        expect(getComputedStyle(panel).color).toBe(PAGE_INK);
        expect(getComputedStyle(email).color).withContext('the identity row').toBe(PAGE_INK);
        expect(getComputedStyle(item).color).withContext('a menu entry').toBe(PAGE_INK);
    });
});
