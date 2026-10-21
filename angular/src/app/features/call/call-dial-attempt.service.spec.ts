import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Subject, of, throwError } from 'rxjs';

import { CallApiService } from './call-api.service';
import { CallDialAttemptService } from './call-dial-attempt.service';
import { type CallLiveEvent, CallLiveEventsService } from './call-live-events.service';
import type { CallOriginateDto } from './call.types';

/**
 * The outbound attempt (A1, 2026-10-21): the platform places the call within a window and says how it ended on
 * `calls.{agentUuid}`. A dial while one is placing sends nothing; a retry is a new POST; Cancel stops it.
 */
describe('CallDialAttemptService', () => {
    let posts: { endpoint: string; extension: string }[];
    let cancels: string[];
    let answer: () => CallOriginateDto;
    let cancelAnswer: () => ReturnType<CallApiService['cancelCall']>;
    let events: Subject<CallLiveEvent>;
    let watched: string[];

    function ev(type: string, callId: string, extra: Partial<CallLiveEvent> = {}): CallLiveEvent {
        return {
            type, id: 'rec-' + callId, callId, direction: 'outbound', state: type.slice(5),
            fromNumber: null, toNumber: '123', callerName: null, assignedUserRef: null, answeredExtension: null,
            answeredByName: null, startedAt: '', answeredAt: null, endedAt: null, durationSeconds: null,
            windowEndsAt: null, reason: null, ...extra,
        };
    }

    function placing(callId: string): CallOriginateDto {
        return { callId, state: 'placing', windowEndsAt: '2026-10-21T21:00:30+03:00', reason: null, originated: false };
    }

    function service(): CallDialAttemptService {
        return TestBed.inject(CallDialAttemptService);
    }

    beforeEach(() => {
        posts = [];
        cancels = [];
        watched = [];
        events = new Subject<CallLiveEvent>();
        answer = () => placing('c1');
        cancelAnswer = () => of({ callId: 'c1', state: 'not_placed', reason: 'cancelled by the caller' });
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { selectSnapshot: () => ({ id: 'agent-1' }) } },
                {
                    provide: CallApiService,
                    useValue: {
                        originateCall: (b: { endpoint: string; extension: string }) => { posts.push(b); return of(answer()); },
                        cancelCall: (id: string) => { cancels.push(id); return cancelAnswer(); },
                    },
                },
                { provide: CallLiveEventsService, useValue: { watchAgent: (a: string) => { watched.push(a); return events; } } },
            ],
        });
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date('2026-10-21T18:00:00Z'));
    });

    afterEach(() => jasmine.clock().uninstall());

    it('starts a placing attempt on the person\'s own channel and counts its seconds', () => {
        const s = service();
        let outcome = '';
        s.dial('PJSIP/101', '123').subscribe(o => outcome = o);

        expect(outcome).toBe('attempt');
        expect(posts).toEqual([{ endpoint: 'PJSIP/101', extension: '123' }]);
        expect(watched).toEqual(['agent-1']);
        expect(s.attempt()?.state).toBe('placing');
        expect(s.attempt()?.callId).toBe('c1');
        expect(s.elapsedSeconds()).toBe(0);

        jasmine.clock().tick(3000);
        expect(s.elapsedSeconds()).withContext('the 1 s ticker').toBe(3);
    });

    it('a second dial while placing shows the same attempt and sends no second POST', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        const first = s.attempt();
        let outcome = '';
        s.dial('PJSIP/101', '123').subscribe(o => outcome = o);

        expect(posts.length).withContext('one POST only').toBe(1);
        expect(outcome).toBe('attempt');
        expect(s.attempt()).toBe(first);
    });

    it('call.not_placed ends the attempt with its reason and stops the ticker; a retry is a new POST', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        jasmine.clock().tick(2000);
        events.next(ev('call.not_placed', 'c1', { reason: 'the line is busy' }));

        expect(s.attempt()?.state).toBe('not_placed');
        expect(s.attempt()?.reason).toBe('the line is busy');
        jasmine.clock().tick(5000);
        expect(s.elapsedSeconds()).withContext('stopped at the end').toBe(2);
        expect(posts.length).withContext('nothing retried by itself').toBe(1);

        answer = () => placing('c2');
        s.dial('PJSIP/101', '123').subscribe();
        expect(posts.length).withContext('the retry').toBe(2);
        expect(s.attempt()?.callId).toBe('c2');
        expect(s.attempt()?.state).toBe('placing');
    });

    it('events for another call do not touch the attempt', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        events.next(ev('call.not_placed', 'other', { reason: 'x' }));

        expect(s.attempt()?.state).toBe('placing');
    });

    it('call.ringing makes it placed: the attempt clears and `placed` fires once', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        events.next(ev('call.ringing', 'c1'));

        expect(s.attempt()).toBeNull();
        expect(s.placed()).toEqual({ callId: 'c1', number: '123' });
    });

    it('call.placing updates the window end', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        events.next(ev('call.placing', 'c1', { windowEndsAt: '2026-10-21T21:01:00+03:00' }));

        expect(s.attempt()?.windowEndsAt).toBe('2026-10-21T21:01:00+03:00');
    });

    it('a not_placed that arrives before the POST answers is applied when the answer names the call', () => {
        const s = service();
        answer = () => {
            events.next(ev('call.not_placed', 'c1', { reason: 'no route' }));
            return placing('c1');
        };
        s.dial('PJSIP/101', '123').subscribe();

        expect(s.attempt()?.state).toBe('not_placed');
        expect(s.attempt()?.reason).toBe('no route');
    });

    it('an answer already not_placed is shown as such, with no ticker', () => {
        const s = service();
        answer = () => ({ callId: 'c1', state: 'not_placed', reason: 'refused', originated: false });
        s.dial('PJSIP/101', '123').subscribe();
        jasmine.clock().tick(4000);

        expect(s.attempt()?.state).toBe('not_placed');
        expect(s.elapsedSeconds()).toBe(0);
    });

    it('an answer for a call already up is placed, with no attempt', () => {
        const s = service();
        answer = () => ({ callId: 'c1', state: 'ringing', originated: true });
        let outcome = '';
        s.dial('PJSIP/101', '123').subscribe(o => outcome = o);

        expect(outcome).toBe('placed');
        expect(s.attempt()).toBeNull();
    });

    it('Cancel posts the attempt\'s id and ends it as not placed with the answered reason', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        s.cancel().subscribe();

        expect(cancels).toEqual(['c1']);
        expect(s.attempt()?.state).toBe('not_placed');
        expect(s.attempt()?.reason).toBe('cancelled by the caller');
    });

    it('Cancel answered 409 means it was placed meanwhile', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        cancelAnswer = () => throwError(() => ({ status: 409, error: { detail: 'already placed' } }));
        s.cancel().subscribe();

        expect(s.attempt()).toBeNull();
        expect(s.placed()?.callId).toBe('c1');
    });

    it('Cancel answered 500 surfaces the error and keeps the attempt placing', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        cancelAnswer = () => throwError(() => ({ status: 500 }));
        let failed = false;
        s.cancel().subscribe({ error: () => failed = true });

        expect(failed).toBeTrue();
        expect(s.attempt()?.state).toBe('placing');
    });

    it('dismiss puts a not-placed attempt away, never a placing one', () => {
        const s = service();
        s.dial('PJSIP/101', '123').subscribe();
        s.dismiss();
        expect(s.attempt()?.state).toBe('placing');

        events.next(ev('call.not_placed', 'c1', { reason: 'busy' }));
        s.dismiss();
        expect(s.attempt()).toBeNull();
    });
});
