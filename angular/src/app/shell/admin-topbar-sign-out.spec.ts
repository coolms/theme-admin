import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ConfirmDialogService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';
import { SignOutService } from './sign-out.service';

/**
 * The account menu, as rendered and clicked (2026-09-25, 2026-09-26): "Sign out"
 * ends this session, "Sign out everywhere" every session of the account -- and the
 * menu is the account's, shown to every signed-in person without asking for the
 * admin-only navi tree, which answered a non-admin 403 and left the menu empty.
 */
describe('AdminTopbarProfileComponent -- the account menu', () => {
    let httpMock: HttpTestingController;
    let asked: Array<{ everywhere?: boolean } | undefined>;

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
                            navi:     { topbarNavGraph: '/api/v1/navi/trees/navi.admin.topbar/graph' },
                        }),
                        select:   () => of({ identifier: 'someone@example.test', roles: ['ROLE_USER'] }),
                        dispatch: () => of(null),
                    },
                },
                { provide: ConfirmDialogService, useValue: { open: () => of(false) } },
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
        expect(httpMock.match(r => r.url.includes('/navi/')).length)
            .withContext('the account menu asks for no navi tree')
            .toBe(0);
        httpMock.match(() => true).forEach(r => r.flush({
            elevated: false, expiresAt: null, ended: { reason: 'never', at: null },
            lifetimeSeconds: 900, lifetimeCeilingSeconds: 3600, mfaRequired: false, warnings: [],
        }));
        httpMock.verify();
    });

    function open(): HTMLElement[] {
        const fixture = TestBed.createComponent(AdminTopbarProfileComponent);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        (host.querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();

        return Array.from(host.querySelectorAll<HTMLElement>('.dropdown-item'));
    }

    function click(title: string): void {
        const entry = open().find(e => e.textContent?.trim().endsWith(title));
        expect(entry).withContext(`"${title}" is in the menu`).toBeDefined();
        entry!.click();
    }

    it('shows a signed-in person without the admin role their profile and both sign-outs', () => {
        const titles = open().map(e => e.textContent?.trim());

        expect(titles).toEqual(['My Profile', 'Sign out', 'Sign out everywhere']);
    });

    it('"Sign out" asks for this session only', () => {
        click('Sign out');
        expect(asked).toEqual([undefined]);
    });

    it('"Sign out everywhere" asks for every session', () => {
        click('Sign out everywhere');
        expect(asked).toEqual([{ everywhere: true }]);
    });

    it('"My Profile" opens the profile page', () => {
        const navigated: unknown[][] = [];
        spyOn(TestBed.inject(Router), 'navigate').and.callFake((c: unknown[]) => (navigated.push(c), Promise.resolve(true)));

        click('My Profile');

        expect(navigated).toEqual([['/profile']]);
        expect(asked).toEqual([]);
    });
});
