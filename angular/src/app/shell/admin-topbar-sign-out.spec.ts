import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';
import { SignOutService } from './sign-out.service';

/**
 * The account menu's two sign-outs (2026-09-25), clicked as rendered from the navi
 * nodes: "Sign out" ends this session, "Sign out everywhere" every session of the
 * account. Until then "Sign out" only cleared this browser.
 */
describe('AdminTopbarProfileComponent -- signing out', () => {
    let httpMock: HttpTestingController;
    let asked: Array<{ everywhere?: boolean } | undefined>;

    const node = (path: string, title: string, target: string, sortOrder: number) => ({
        id: path, path, title, parentId: null, sortOrder, isActive: true, isVisible: true,
        meta: { icon: 'logout', target }, children: [],
    });

    beforeEach(() => {
        asked = [];
        TestBed.configureTestingModule({
            imports: [AdminTopbarProfileComponent],
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
                        select:   () => of({ identifier: 'someone@example.test' }),
                        dispatch: () => of(null),
                    },
                },
                { provide: ConfirmDialogService, useValue: { open: () => of(false) } },
                {
                    provide:  NaviGraphService,
                    useValue: {
                        loadTopbarNav: () => of([
                            node('/profile/logout', 'Sign out', 'action.logout', 20),
                            node('/profile/sign-out-everywhere', 'Sign out everywhere', 'action.logout-everywhere', 30),
                        ]),
                        getTree: () => of([]),
                        tree:    () => [],
                    },
                },
                {
                    provide:  UserCalendarPreferencesService,
                    useValue: { ensureLoaded: () => undefined, tz: () => 'UTC', dateFormat: () => 'yyyy-MM-dd', timeFormat: () => '24h' },
                },
                {
                    provide:  SignOutService,
                    useValue: { signOut: (options?: { everywhere?: boolean }) => (asked.push(options), of(undefined)) },
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
    });

    function click(title: string): void {
        const fixture = TestBed.createComponent(AdminTopbarProfileComponent);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        (host.querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();

        const entries = Array.from(host.querySelectorAll<HTMLElement>('.dropdown-item'));
        const entry = entries.find(e => e.textContent?.trim().endsWith(title));
        expect(entry).withContext(`"${title}" is in the menu`).toBeDefined();
        entry!.click();
    }

    it('"Sign out" asks for this session only', () => {
        click('Sign out');
        expect(asked).toEqual([undefined]);
    });

    it('"Sign out everywhere" asks for every session', () => {
        click('Sign out everywhere');
        expect(asked).toEqual([{ everywhere: true }]);
    });
});
