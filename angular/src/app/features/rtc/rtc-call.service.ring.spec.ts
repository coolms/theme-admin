import { WritableSignal, signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { RING_CONNECT_RETRY_MS, RtcCallService } from './rtc-call.service';
import { RtcLiveEventsService } from './rtc-live-events.service';
import { RtcMediaController } from './rtc-media-controller';
import { RtcSfuMediaController } from './rtc-sfu-media-controller';
import { RtcService } from './rtc.service';
import { RtcIncomingCallNudge } from './rtc.types';

/**
 * The ring, `rtc.user.{myId}` (Dmitry, 2026-09-28): subscribed when BOTH the signed-in user and
 * the realtime connection are ready, and again after every reconnect. It was subscribed on the
 * user alone, in one pipe -- a subscribe made before the connection was up, or lost with it,
 * was never made again, and one failed subscribe ended the ring for the whole session: a
 * reopened admin that never rang (the backend's call harness, its `reopen` scenario, 2026-09-28).
 */
describe('RtcCallService -- the ring is subscribed when the user and the connection are ready', () => {
    const USER = 'user-a';
    const RING: RtcIncomingCallNudge = { type: 'call.incoming', callId: 'call-1', conversationId: 'conv-1', fromUserId: 'user-b', mediaKind: 'audio' };

    let connected: WritableSignal<boolean>;
    /** Each subscribe to the ring, in order: the user it was for, and the channel it was given. */
    let subscribes: { userId: string; channel: Subject<RtcIncomingCallNudge> }[];
    let teardowns: number;
    /** How the next subscribes go: 'refused' fails that subscribe, as a broken channel would. */
    let outcomes: ('ok' | 'refused')[];
    let connect: jasmine.Spy<() => Promise<void>>;

    function ringService(): RtcCallService {
        TestBed.configureTestingModule({
            providers: [
                { provide: RtcMediaController, useValue: jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'setPolite', 'stop']) },
                { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
                { provide: RtcService, useValue: {} },
                {
                    provide: RtcLiveEventsService,
                    useValue: {
                        isConnected: connected,
                        connect,
                        watchUserRing: (userId: string): Observable<RtcIncomingCallNudge> => {
                            if (outcomes.shift() === 'refused') {
                                subscribes.push({ userId, channel: new Subject<RtcIncomingCallNudge>() });
                                return throwError(() => new Error('subscribe refused'));
                            }
                            return new Observable<RtcIncomingCallNudge>(subscriber => {
                                const channel = new Subject<RtcIncomingCallNudge>();
                                subscribes.push({ userId, channel });
                                const inner = channel.subscribe(subscriber);
                                return () => {
                                    teardowns++;
                                    inner.unsubscribe();
                                };
                            });
                        },
                        watchCall: () => new Subject().asObservable(),
                    },
                },
                { provide: Store, useValue: { select: () => of({ id: USER }), selectSnapshot: () => ({ id: USER }) } },
                { provide: ToastService, useValue: { error: () => undefined } },
            ],
        });
        return TestBed.inject(RtcCallService);
    }

    beforeEach(() => {
        connected = signal(false);
        subscribes = [];
        teardowns = 0;
        outcomes = [];
        connect = jasmine.createSpy('connect').and.callFake(() => Promise.resolve());
    });

    it('subscribes nothing while the connection is down, and once when it comes up -- and a ring then rings', () => {
        const service = ringService();
        TestBed.tick();
        expect(subscribes.length).withContext('no subscribe before the connection is up').toBe(0);

        connected.set(true);
        TestBed.tick();
        expect(subscribes.map(s => s.userId)).toEqual([USER]);

        subscribes[0].channel.next(RING);
        expect(service.activeCall()?.callId).withContext('the ring raised the call').toBe('call-1');
    });

    it('subscribes again after every reconnect, and lets the old subscription go', () => {
        connected.set(true);
        const service = ringService();
        TestBed.tick();
        expect(subscribes.length).toBe(1);

        connected.set(false);
        TestBed.tick();
        expect(teardowns).withContext('the subscription is dropped with the connection').toBe(1);
        connected.set(true);
        TestBed.tick();
        expect(subscribes.length).withContext('made again on the reconnect').toBe(2);

        subscribes[1].channel.next(RING);
        expect(service.activeCall()?.callId).withContext('the ring after the reconnect rang').toBe('call-1');
    });

    it('a subscribe that fails ends only itself: the next time the connection is up it is made again, and rings', () => {
        outcomes = ['refused'];
        connected.set(true);
        const service = ringService();
        TestBed.tick();
        expect(subscribes.length).toBe(1);

        connected.set(false);
        TestBed.tick();
        connected.set(true);
        TestBed.tick();
        expect(subscribes.length).withContext('subscribed again after the failed one').toBe(2);

        subscribes[1].channel.next(RING);
        expect(service.activeCall()?.callId).toBe('call-1');
    });

    it('asks for the connection once the user is known, again with a doubling wait while it fails, and not after it succeeds', fakeAsync(() => {
        let failures = 2;
        connect.and.callFake(() => (failures-- > 0 ? Promise.reject(new Error('no connection token')) : Promise.resolve()));
        ringService();
        flushMicrotasks();
        expect(connect).withContext('asked at once').toHaveBeenCalledTimes(1);

        tick(RING_CONNECT_RETRY_MS - 1);
        expect(connect).withContext('not before the first wait').toHaveBeenCalledTimes(1);
        tick(1);
        flushMicrotasks();
        expect(connect).withContext('asked again after the first wait').toHaveBeenCalledTimes(2);

        tick(2 * RING_CONNECT_RETRY_MS);
        flushMicrotasks();
        expect(connect).withContext('asked a third time after a doubled wait').toHaveBeenCalledTimes(3);

        tick(60_000);
        expect(connect).withContext('never again once it succeeded').toHaveBeenCalledTimes(3);
    }));
});
