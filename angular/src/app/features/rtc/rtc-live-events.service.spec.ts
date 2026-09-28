import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CentrifugoClientService } from '@coolms/ui-angular';
import { RtcLiveEventsService } from './rtc-live-events.service';
import { RtcCallChannelNudge } from './rtc.types';

/**
 * What `rtc.call.{id}` publications become. The server names the polite peer of a
 * call on EVERY `call.state` (`politeUserId`); the orchestrator hands it to the media
 * plane, so a parse that dropped it would leave a running call on whatever the last
 * REST read said. Absent or not a string, it is null -- never a guess.
 */
describe('RtcLiveEventsService -- call.state carries the polite peer', () => {
    let publish: (data: unknown) => void;
    let received: RtcCallChannelNudge[];
    let injector: EnvironmentInjector;

    beforeEach(async () => {
        received = [];
        let handler: ((ctx: { data: unknown }) => void) | null = null;
        const subscription = {
            state: 'subscribed',
            on: (event: string, h: (ctx: { data: unknown }) => void) => {
                if (event === 'publication') {
                    handler = h;
                }
            },
            off: () => undefined,
            subscribe: () => undefined,
            unsubscribe: () => undefined,
        };
        const client = {
            isConnected: signal(true),
            connect: () => Promise.resolve(),
            getOrCreateSubscription: () => subscription,
        };
        injector = createEnvironmentInjector([
            RtcLiveEventsService,
            { provide: CentrifugoClientService, useValue: client },
        ], TestBed.inject(EnvironmentInjector));
        injector.get(RtcLiveEventsService).watchCall('call-1').subscribe(n => received.push(n));
        await Promise.resolve(); // connect() resolves, the handler is attached
        await Promise.resolve();
        publish = data => {
            expect(handler).withContext('the service subscribed to the channel').not.toBeNull();
            handler?.({ data });
        };
    });

    afterEach(() => injector.destroy());

    it('keeps the politeUserId a call.state names', () => {
        publish({ type: 'call.state', callId: 'call-1', state: 'connected', politeUserId: 'user-b' });

        expect(received).toEqual([{ type: 'call.state', callId: 'call-1', state: 'connected', politeUserId: 'user-b' }]);
    });

    it('keeps the version a call.state carries, and drops one that is not a number', () => {
        publish({ type: 'call.state', callId: 'call-1', state: 'connected', politeUserId: 'user-b', version: 2 });
        publish({ type: 'call.state', callId: 'call-1', state: 'ended', politeUserId: 'user-b', version: '3' });

        expect(received.map(n => n.type === 'call.state' ? n.version : 'not a state')).toEqual([2, undefined]);
    });

    it('reads a null, a missing or a malformed politeUserId as null', () => {
        publish({ type: 'call.state', callId: 'call-1', state: 'connected', politeUserId: null });
        publish({ type: 'call.state', callId: 'call-1', state: 'ringing' });
        publish({ type: 'call.state', callId: 'call-1', state: 'ended', politeUserId: 42 });

        expect(received.map(n => n.type === 'call.state' ? n.politeUserId : 'not a state')).toEqual([null, null, null]);
    });
});

/**
 * When a call's channel subscription becomes active, the watcher is told -- the moment a
 * party reads what the channel said before it listened (it keeps no history). At once when
 * the subscription already is active; on each `subscribed` otherwise, a resubscribe
 * included; never after the watch is torn down.
 */
describe('RtcLiveEventsService -- a call watch says when its subscription is active', () => {
    let handlers: Map<string, (ctx: unknown) => void>;
    let subscription: { state: string; on: unknown; off: unknown; subscribe: jasmine.Spy; unsubscribe: () => void };
    let injector: EnvironmentInjector;

    function setUp(state: string): RtcLiveEventsService {
        handlers = new Map();
        subscription = {
            state,
            on: (event: string, h: (ctx: unknown) => void) => { handlers.set(event, h); },
            off: (event: string, h: (ctx: unknown) => void) => {
                if (handlers.get(event) === h) {
                    handlers.delete(event);
                }
            },
            subscribe: jasmine.createSpy('subscribe'),
            unsubscribe: () => undefined,
        };
        const client = {
            isConnected: signal(true),
            connect: () => Promise.resolve(),
            getOrCreateSubscription: () => subscription,
        };
        injector = createEnvironmentInjector([
            RtcLiveEventsService,
            { provide: CentrifugoClientService, useValue: client },
        ], TestBed.inject(EnvironmentInjector));
        return injector.get(RtcLiveEventsService);
    }

    afterEach(() => injector.destroy());

    it('tells the watcher once the subscription it asked for is active, and again on a resubscribe', async () => {
        let told = 0;
        setUp('unsubscribed').watchCall('call-1', () => told++).subscribe();
        await Promise.resolve();
        await Promise.resolve();

        expect(subscription.subscribe).withContext('it asked for the subscription').toHaveBeenCalledTimes(1);
        expect(told).withContext('nothing active yet').toBe(0);
        handlers.get('subscribed')?.({});
        expect(told).toBe(1);
        handlers.get('subscribed')?.({});
        expect(told).withContext('a resubscribe is told too').toBe(2);
    });

    it('tells the watcher at once when the subscription is already active', async () => {
        let told = 0;
        setUp('subscribed').watchCall('call-1', () => told++).subscribe();
        await Promise.resolve();
        await Promise.resolve();

        expect(subscription.subscribe).not.toHaveBeenCalled();
        expect(told).toBe(1);
    });

    it('stops telling once the watch is torn down', async () => {
        let told = 0;
        const watch = setUp('unsubscribed').watchCall('call-1', () => told++).subscribe();
        await Promise.resolve();
        await Promise.resolve();
        watch.unsubscribe();

        expect(handlers.has('subscribed')).withContext('the handler was removed').toBeFalse();
        expect(told).toBe(0);
    });
});
