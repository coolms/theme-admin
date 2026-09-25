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
            on: (_event: string, h: (ctx: { data: unknown }) => void) => { handler = h; },
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

    it('reads a null, a missing or a malformed politeUserId as null', () => {
        publish({ type: 'call.state', callId: 'call-1', state: 'connected', politeUserId: null });
        publish({ type: 'call.state', callId: 'call-1', state: 'ringing' });
        publish({ type: 'call.state', callId: 'call-1', state: 'ended', politeUserId: 42 });

        expect(received.map(n => n.type === 'call.state' ? n.politeUserId : 'not a state')).toEqual([null, null, null]);
    });
});
