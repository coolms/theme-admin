import { HttpErrorResponse } from '@angular/common/http';

import {
    CallRelay,
    callIdOf,
    resolveCallRelay,
    withinBound,
    withPerCallIceServers,
} from './sip-call-relay';

/**
 * A SIP call is answered with ITS relay credential or with none -- never the account's -- and when
 * none, the reason is one of a known few, refusals told apart from a network error and from the bound.
 */
describe('sip-call-relay', () => {
    const ID = '01A10000-0000-7000-8000-000000000042';
    const TURN: RTCIceServer[] = [{ urls: ['turn:turn.test:3478'], username: '1700000000:call', credential: 'x' }];

    describe('callIdOf()', () => {
        it('takes a UUID, lowercased', () => {
            expect(callIdOf(ID)).toBe(ID.toLowerCase());
            expect(callIdOf(`  ${ID}  `)).toBe(ID.toLowerCase());
        });

        it('takes nothing else as an id', () => {
            expect(callIdOf(undefined)).toBeNull();
            expect(callIdOf('')).toBeNull();
            expect(callIdOf('none')).toBeNull();
            expect(callIdOf(`${ID}x`)).toBeNull();
        });
    });

    describe('resolveCallRelay()', () => {
        it('gives a call with an id its own ICE servers', async () => {
            const asked: string[] = [];
            const relay = await resolveCallRelay('abc', async id => {
                asked.push(id);
                return { iceServers: TURN };
            });

            expect(asked).toEqual(['abc']);
            expect(relay).toEqual({ iceServers: TURN, noRelay: null });
        });

        it('asks nothing for a call without an id, and answers it without a relay', async () => {
            let asked = 0;
            const relay = await resolveCallRelay(null, async () => {
                asked++;
                return { iceServers: TURN };
            });

            expect(asked).toBe(0);
            expect(relay).toEqual({ iceServers: [], noRelay: 'no call id' });
        });

        it('tells the refusals apart', async () => {
            for (const status of [403, 404, 409]) {
                const relay = await resolveCallRelay('abc', () => Promise.reject(new HttpErrorResponse({ status })));
                expect(relay).toEqual({ iceServers: [], noRelay: `refused (${status})` as CallRelay['noRelay'] });
            }
        });

        it('tells a network error apart from a refusal and from a server failure', async () => {
            const network = await resolveCallRelay('abc', () => Promise.reject(new HttpErrorResponse({ status: 0 })));
            const thrown = await resolveCallRelay('abc', () => Promise.reject(new Error('offline')));
            const failed = await resolveCallRelay('abc', () => Promise.reject(new HttpErrorResponse({ status: 500 })));

            expect(network.noRelay).toBe('network error');
            expect(thrown.noRelay).toBe('network error');
            expect(failed.noRelay).toBe('failed (500)');
        });

        it('says so when the server issues none', async () => {
            const relay = await resolveCallRelay('abc', async () => ({ iceServers: [] }));

            expect(relay).toEqual({ iceServers: [], noRelay: 'none issued' });
        });
    });

    describe('withinBound()', () => {
        it('answers without a relay at the bound, never hanging', async () => {
            const never = new Promise<CallRelay>(() => undefined);

            const relay = await withinBound(never, 10);

            expect(relay).toEqual({ iceServers: [], noRelay: 'answer bound (2 s)' });
        });

        it('passes a relay that came in time through', async () => {
            const relay = await withinBound(Promise.resolve({ iceServers: TURN, noRelay: null }), 1000);

            expect(relay).toEqual({ iceServers: TURN, noRelay: null });
        });
    });

    describe('withPerCallIceServers()', () => {
        type Options = { peerConnectionConfiguration?: RTCConfiguration; constraints?: object };

        it('gives each session its own ICE servers and keeps the other options', () => {
            const built: Options[] = [];
            const perCall = new Map<string, RTCIceServer[]>([['s1', TURN]]);
            const factory = withPerCallIceServers(
                (_session: { id: string }, options?: Options) => built.push(options ?? {}),
                id => perCall.get(id),
            );

            factory(
                { id: 's1' },
                { constraints: { audio: true }, peerConnectionConfiguration: { bundlePolicy: 'balanced' } },
            );
            factory({ id: 's2' });

            expect(built[0]).toEqual({
                constraints: { audio: true },
                peerConnectionConfiguration: { bundlePolicy: 'balanced', iceServers: TURN },
            });
            expect(built[1]).toEqual({ peerConnectionConfiguration: { iceServers: [] } });
        });
    });
});
