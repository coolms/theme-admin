import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { BehaviorSubject, Subject, throwError } from 'rxjs';

import { CallsEndWithTheSession } from './calls-end-with-the-session.service';
import { RtcCallService } from './rtc-call.service';
import { RtcService } from './rtc.service';

/**
 * A browser whose session ends closes its own calls (2026-09-25): the moment the
 * signed-in state goes from true to false, and only then; and before its own sign-out,
 * while the session still holds.
 */
describe('CallsEndWithTheSession', () => {
    let signedIn: BehaviorSubject<boolean>;
    let active: ReturnType<typeof signal<{ callId: string } | null>>;
    let localHangups: number;
    let serverHangups: string[];
    let serverAnswer: Subject<unknown>;

    beforeEach(() => {
        signedIn = new BehaviorSubject<boolean>(false);
        active = signal<{ callId: string } | null>(null);
        localHangups = 0;
        serverHangups = [];
        serverAnswer = new Subject<unknown>();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { select: () => signedIn.asObservable() } },
                { provide: RtcCallService, useValue: { hangup: () => localHangups++, activeCall: active } },
                {
                    provide: RtcService,
                    useValue: {
                        hangup: (callId: string) => {
                            serverHangups.push(callId);
                            return serverAnswer.asObservable();
                        },
                    },
                },
            ],
        });
    });

    it('hangs up when the session ends', () => {
        TestBed.inject(CallsEndWithTheSession).start();
        signedIn.next(true);
        expect(localHangups).toBe(0, 'signing in ends nothing');

        signedIn.next(false);
        expect(localHangups).toBe(1);
    });

    it('does nothing while signed out, and nothing twice', () => {
        const closer = TestBed.inject(CallsEndWithTheSession);
        closer.start();
        closer.start();
        signedIn.next(false);
        expect(localHangups).toBe(0, 'never signed in: no session ended');

        signedIn.next(true);
        signedIn.next(false);
        expect(localHangups).toBe(1, 'one subscription, one hang-up');
    });

    it('before signing out, tells the server and waits for it, then ends the call here', () => {
        active.set({ callId: 'call-1' });
        let done = false;
        TestBed.inject(CallsEndWithTheSession).endBeforeSigningOut().subscribe(() => (done = true));

        expect(serverHangups).toEqual(['call-1']);
        expect(done).toBeFalse();
        expect(localHangups).toBe(0);

        serverAnswer.next({});
        expect(done).toBeTrue();
        expect(localHangups).toBe(1);
    });

    it('before signing out with no call, lets the sign-out go on at once', () => {
        let done = false;
        TestBed.inject(CallsEndWithTheSession).endBeforeSigningOut().subscribe(() => (done = true));

        expect(done).toBeTrue();
        expect(serverHangups).toEqual([]);
    });

    it('a refused hang-up still ends the call here and lets the sign-out go on', () => {
        TestBed.overrideProvider(RtcService, { useValue: { hangup: () => throwError(() => new Error('401')) } });
        active.set({ callId: 'call-2' });
        let done = false;
        TestBed.inject(CallsEndWithTheSession).endBeforeSigningOut().subscribe(() => (done = true));

        expect(done).toBeTrue();
        expect(localHangups).toBe(1);
    });
});
