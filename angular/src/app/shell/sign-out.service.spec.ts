import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { of, Subject } from 'rxjs';
import { Logout } from '@coolms/core-angular';

import { CallsEndWithTheSession } from '../features/rtc/calls-end-with-the-session.service';
import { SignOutService } from './sign-out.service';

/**
 * Signing out reaches the server (2026-09-25): the plain sign-out ends this session,
 * `everywhere` every session of the account; a call is hung up first; and this browser
 * is signed out whatever the server answered. Until then the admin's "Sign out" only
 * dispatched Logout.
 */
describe('SignOutService', () => {
    let http: HttpTestingController;
    let dispatched: unknown[];
    let navigated: unknown[][];
    let callEnded: Subject<void>;

    beforeEach(() => {
        dispatched = [];
        navigated = [];
        callEnded = new Subject<void>();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => ({ apiBase: '/api/v1' }),
                        dispatch: (action: unknown) => {
                            dispatched.push(action);
                            return of(null);
                        },
                    },
                },
                { provide: Router, useValue: { navigate: (commands: unknown[]) => navigated.push(commands) } },
                { provide: CallsEndWithTheSession, useValue: { endBeforeSigningOut: () => callEnded.asObservable() } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function callOver(): void {
        callEnded.next();
        callEnded.complete();
    }

    it('hangs up first, then asks the server to end this session, then signs this browser out', () => {
        TestBed.inject(SignOutService).signOut().subscribe();
        http.expectNone('/api/v1/auth/logout', 'nothing is signed out while the call is still being ended');

        callOver();
        const request = http.expectOne(r => r.url === '/api/v1/auth/logout');
        expect(request.request.method).toBe('POST');
        expect(request.request.params.has('everywhere')).toBeFalse();
        expect(dispatched).toEqual([], 'nothing is cleared before the server was asked');
        request.flush(null, { status: 204, statusText: 'No Content' });

        expect(dispatched.length).toBe(1);
        expect(dispatched[0] instanceof Logout).toBeTrue();
        expect(navigated).toEqual([['/login']]);
    });

    it('asks for every session and device with everywhere=true', () => {
        TestBed.inject(SignOutService).signOut({ everywhere: true }).subscribe();
        callOver();

        const request = http.expectOne(r => r.url === '/api/v1/auth/logout');
        expect(request.request.params.get('everywhere')).toBe('true');
        request.flush(null, { status: 204, statusText: 'No Content' });
        expect(dispatched[0] instanceof Logout).toBeTrue();
    });

    it('signs this browser out even when the server refuses', () => {
        TestBed.inject(SignOutService).signOut().subscribe();
        callOver();

        http.expectOne(r => r.url === '/api/v1/auth/logout').flush(null, { status: 401, statusText: 'Unauthorized' });

        expect(dispatched[0] instanceof Logout).toBeTrue();
        expect(navigated).toEqual([['/login']]);
    });
});
