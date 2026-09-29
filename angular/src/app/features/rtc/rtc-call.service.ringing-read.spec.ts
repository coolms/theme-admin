import { WritableSignal, signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Observable, Subject, of } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { RtcCallService } from './rtc-call.service';
import { RtcLiveEventsService } from './rtc-live-events.service';
import { RtcMediaController } from './rtc-media-controller';
import { RtcSfuMediaController } from './rtc-sfu-media-controller';
import { RtcService } from './rtc.service';
import { RtcCallChannelNudge, RtcCallDto, RtcCallState, RtcIncomingCallNudge } from './rtc.types';

/**
 * The ringing read (Dmitry, 2026-09-29): "a ring published on rtc.user before the app's subscription
 * is confirmed is lost [...] The app and the admin read it after every rtc.user subscribe
 * confirmation, including after reconnects, and apply it under the version rule. Tests: a ring
 * published while the client delays its subscribe appears after subscribe and read".
 *
 * The ring channel here behaves as the server's does: it keeps no history, so a ring published
 * while the subscription is not yet confirmed reaches nobody; the confirmation is the spec's to give.
 */
describe('RtcCallService -- the calls ringing now are read once the ring subscription is confirmed', () => {
    const ME = 'user-a';
    const CALLER = 'user-b';

    let connected: WritableSignal<boolean>;
    /** Each ring subscription, in order: whether the server has confirmed it, and how to tell the client. */
    let rings: { confirmed: boolean; channel: Subject<RtcIncomingCallNudge>; onSubscribed: (() => void) | undefined }[];
    /** Each call channel the service watches, by call. */
    let calls: Map<string, Subject<RtcCallChannelNudge>>;
    /** What GET /rtc/ringing answers now. */
    let ringingNow: RtcCallDto[];
    let ringing: jasmine.Spy<() => Observable<RtcCallDto[]>>;

    function record(id: string, state: RtcCallState, version: number): RtcCallDto {
        return {
            id,
            conversationId: 'conv-' + id,
            initiatorUserId: CALLER,
            mediaKind: 'audio',
            state,
            connectedAt: null,
            endedAt: null,
            endReason: null,
            recordingActive: false,
            politeUserId: ME,
            createdAt: null,
            participants: [],
            version,
        };
    }

    /** The server publishes a ring: delivered only on a confirmed subscription. */
    function publishRing(callId: string): void {
        const ring = rings[rings.length - 1];
        if (ring?.confirmed) {
            ring.channel.next({ type: 'call.incoming', callId, conversationId: 'conv-' + callId, fromUserId: CALLER, mediaKind: 'audio' });
        }
    }

    /** The server confirms the latest ring subscription. */
    function confirm(): void {
        const ring = rings[rings.length - 1];
        ring.confirmed = true;
        ring.onSubscribed?.();
    }

    function ringService(): RtcCallService {
        TestBed.configureTestingModule({
            providers: [
                { provide: RtcMediaController, useValue: jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'setPolite', 'stop']) },
                { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
                { provide: RtcService, useValue: { ringing, get: (id: string) => of(record(id, 'ringing', 1)) } },
                {
                    provide: RtcLiveEventsService,
                    useValue: {
                        isConnected: connected,
                        connect: () => Promise.resolve(),
                        watchUserRing: (_userId: string, onSubscribed?: () => void): Observable<RtcIncomingCallNudge> =>
                            new Observable<RtcIncomingCallNudge>(subscriber => {
                                const ring = { confirmed: false, channel: new Subject<RtcIncomingCallNudge>(), onSubscribed };
                                rings.push(ring);
                                const inner = ring.channel.subscribe(subscriber);
                                return () => inner.unsubscribe();
                            }),
                        watchCall: (callId: string): Observable<RtcCallChannelNudge> => {
                            const channel = new Subject<RtcCallChannelNudge>();
                            calls.set(callId, channel);
                            return channel.asObservable();
                        },
                    },
                },
                { provide: Store, useValue: { select: () => of({ id: ME }), selectSnapshot: () => ({ id: ME }) } },
                { provide: ToastService, useValue: { error: () => undefined } },
            ],
        });
        return TestBed.inject(RtcCallService);
    }

    beforeEach(() => {
        connected = signal(true);
        rings = [];
        calls = new Map();
        ringingNow = [];
        ringing = jasmine.createSpy('ringing').and.callFake(() => of(ringingNow));
    });

    it('a ring published while the subscribe is unconfirmed is lost on the channel, and rings once the read on confirmation lists it', () => {
        const service = ringService();
        TestBed.tick();
        expect(rings.length).withContext('the ring is subscribed').toBe(1);

        publishRing('call-1');
        ringingNow = [record('call-1', 'ringing', 1)];
        expect(service.activeCall()).withContext('the ring reached nobody: the subscription was not confirmed').toBeNull();
        expect(ringing).withContext('nothing is read before the confirmation').not.toHaveBeenCalled();

        confirm();

        expect(ringing).toHaveBeenCalledTimes(1);
        const call = service.activeCall();
        expect(call?.callId).withContext('the read raised the missed call').toBe('call-1');
        expect(call?.ui).toBe('ringing-in');
        expect(call?.role).toBe('callee');
        expect(call?.peerUserId).toBe(CALLER);
        expect(call?.version).withContext('applied at its version').toBe(1);
    });

    it('reads again at every reconnect\'s confirmation', () => {
        ringService();
        TestBed.tick();
        confirm();
        expect(ringing).toHaveBeenCalledTimes(1);

        connected.set(false);
        TestBed.tick();
        connected.set(true);
        TestBed.tick();
        expect(rings.length).withContext('subscribed again on the reconnect').toBe(2);
        expect(ringing).withContext('not before that subscription is confirmed').toHaveBeenCalledTimes(1);

        confirm();
        expect(ringing).toHaveBeenCalledTimes(2);
    });

    it('a call its ring already raised is not raised twice; the read applies to it under the version rule', () => {
        const service = ringService();
        TestBed.tick();
        rings[0].confirmed = true;
        publishRing('call-1');
        expect(service.activeCall()?.version).withContext('the ring carries no version').toBe(0);

        ringingNow = [record('call-1', 'ringing', 1)];
        rings[0].onSubscribed?.();

        expect(calls.size).withContext('its channel is watched once').toBe(1);
        expect(service.activeCall()?.version).toBe(1);
    });

    it('while in another call, a call the read lists is ignored, as its ring would be', () => {
        const service = ringService();
        TestBed.tick();
        rings[0].confirmed = true;
        publishRing('call-1');

        ringingNow = [record('call-2', 'ringing', 1)];
        rings[0].onSubscribed?.();

        expect(service.activeCall()?.callId).toBe('call-1');
    });

    it('a call this client has seen end is not brought back by a read older than its end', fakeAsync(() => {
        const service = ringService();
        TestBed.tick();
        confirm();
        publishRing('call-1');
        calls.get('call-1')?.next({ type: 'call.state', callId: 'call-1', state: 'cancelled', politeUserId: null, version: 2 });
        expect(service.activeCall()?.ui).toBe('ended');
        tick(2_000);
        expect(service.activeCall()).withContext('dismissed').toBeNull();

        ringingNow = [record('call-1', 'ringing', 1)]; // a read made before the cancel, returning after it
        rings[0].onSubscribed?.();

        expect(service.activeCall()).withContext('the ended call does not ring again').toBeNull();
    }));

    it('an empty read raises nothing', () => {
        const service = ringService();
        TestBed.tick();
        confirm();

        expect(ringing).toHaveBeenCalledTimes(1);
        expect(service.activeCall()).toBeNull();
    });
});
