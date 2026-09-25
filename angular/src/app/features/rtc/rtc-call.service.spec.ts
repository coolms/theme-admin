import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Observable, Subject, of } from 'rxjs';
import { ToastService } from '@coolms/ui-angular';
import { RtcCallService } from './rtc-call.service';
import { RtcLiveEventsService } from './rtc-live-events.service';
import { RtcMediaController } from './rtc-media-controller';
import { RtcSfuMediaController } from './rtc-sfu-media-controller';
import { RtcService } from './rtc.service';
import { RtcCallChannelNudge, RtcCallDto, RtcCallState, RtcIncomingCallNudge, RtcSignal } from './rtc.types';

/**
 * A 1:1 call's negotiation, as the server actually relays it.
 *
 * `POST /rtc/calls/{id}/signal` is published on `rtc.call.{id}` (RtcCallPublisher),
 * and BOTH parties subscribe to that channel -- so every offer, answer and candidate
 * reaches its own sender too, stamped with the sender's user id in `from`. Both
 * parties start media on the same `call.state connected`, so both offer at once: the
 * glare perfect negotiation exists for (the caller impolite, the callee polite).
 *
 * The echo breaks it. The polite callee never ignores an offer, so its own offer,
 * coming back, is applied as the PEER's: when the caller's offer lands first, the
 * callee answers it and then rolls back onto its own SDP as the remote description,
 * and the call never connects (measured with tools/call-harness, 2026-09-25: about
 * half the runs, "Failed to set remote answer sdp: Called in wrong state" in every
 * run). The fix is the orchestrator's: a `call.signal` from the signed-in user is
 * not forwarded to the media plane.
 *
 * The second group runs two REAL parties -- each its own RtcCallService and its own
 * RtcMediaController over a real RTCPeerConnection in the test browser -- joined by
 * a fake server whose channel broadcasts to both, sender included, as Centrifugo
 * does. It holds the signals until both parties have offered and then releases
 * them with a chosen party's offer first, so the glare happens in both orders on
 * every run instead of half of them. What is asserted is the negotiation's END
 * STATE: each connection's remote description carries the ICE credentials the OTHER
 * connection holds now. ICE itself is not waited for -- the suite's Chrome hides
 * host addresses behind mDNS names nothing in the container resolves (the call
 * harness turns that off for the same reason), so connectivity here would measure
 * the container, not the negotiation.
 *
 * Measured with the `from` check removed from RtcCallService.onCallNudge (every
 * signal forwarded, as before): all three fail. The forwarding spec sees its own
 * offer forwarded; with the caller's offer first BOTH connections end on a
 * description the other no longer holds, with the callee's first one of them does;
 * and both orders log "Failed to set remote answer sdp: Called in wrong state:
 * stable" three times -- the harness's error, from the echoed answers.
 */
describe('RtcCallService -- a call.signal is applied only when it is the peer\'s', () => {
    const CALL_ID = 'call-1';
    const CONVERSATION_ID = 'conv-1';
    const USER_A = 'user-a';
    const USER_B = 'user-b';

    function dto(state: RtcCallState): RtcCallDto {
        return {
            id: CALL_ID,
            conversationId: CONVERSATION_ID,
            initiatorUserId: USER_A,
            mediaKind: 'audio',
            state,
            connectedAt: null,
            endedAt: null,
            endReason: null,
            recordingActive: false,
            createdAt: null,
            participants: [
                { userId: USER_A, state: 'joined', joinedAt: null, leftAt: null },
                { userId: USER_B, state: state === 'ringing' ? 'invited' : 'joined', joinedAt: null, leftAt: null },
            ],
        };
    }

    /** The ICE username fragment a description was generated with -- whose SDP it is. */
    function ufrag(description: RTCSessionDescription | null): string | null {
        return /a=ice-ufrag:(\S+)/.exec(description?.sdp ?? '')?.[1] ?? null;
    }

    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    describe('the orchestrator', () => {
        let channel: Subject<RtcCallChannelNudge>;
        let media: jasmine.SpyObj<RtcMediaController>;
        let service: RtcCallService;
        let injector: EnvironmentInjector;

        beforeEach(() => {
            channel = new Subject<RtcCallChannelNudge>();
            const ring = new Subject<RtcIncomingCallNudge>();
            media = jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'stop']);
            injector = createEnvironmentInjector([
                RtcCallService,
                { provide: RtcMediaController, useValue: media },
                { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
                { provide: RtcService, useValue: { hangup: () => of(dto('ended')) } },
                { provide: RtcLiveEventsService, useValue: { watchUserRing: () => ring.asObservable(), watchCall: () => channel.asObservable() } },
                { provide: Store, useValue: { select: () => of({ id: USER_B }), selectSnapshot: () => ({ id: USER_B }) } },
                { provide: ToastService, useValue: { error: () => undefined } },
            ], TestBed.inject(EnvironmentInjector));
            service = injector.get(RtcCallService);
            ring.next({ type: 'call.incoming', callId: CALL_ID, conversationId: CONVERSATION_ID, fromUserId: USER_A, mediaKind: 'audio' });
        });

        afterEach(() => injector.destroy());

        it('drops a signal the signed-in user sent and forwards the peer\'s', () => {
            expect(service.activeCall()?.callId).withContext('the ring made the call active').toBe(CALL_ID);
            const own: RtcSignal = { type: 'offer', payload: { type: 'offer', sdp: 'own' } };
            const peers: RtcSignal = { type: 'offer', payload: { type: 'offer', sdp: 'peer' } };

            channel.next({ type: 'call.signal', callId: CALL_ID, from: USER_B, signal: own });
            channel.next({ type: 'call.signal', callId: CALL_ID, from: USER_A, signal: peers });

            expect(media.handleSignal).toHaveBeenCalledOnceWith(CALL_ID, peers);
        });
    });

    describe('two parties over a channel that echoes to its sender', () => {
        /**
         * The server: places, rings, answers, and relays signals on one broadcast
         * channel, one delivery at a time with a small gap (a network, not a
         * synchronous call). Signals are held until both parties have offered.
         */
        class FakeServer {
            readonly channel = new Subject<RtcCallChannelNudge>();
            readonly rings = new Map<string, Subject<RtcIncomingCallNudge>>();
            private held: { from: string; signal: RtcSignal }[] | null = [];
            private tail: Promise<void> = Promise.resolve();
            private inFlight = 0;

            constructor(private readonly firstOffer: string) {}

            get idle(): boolean {
                return this.held === null && this.inFlight === 0;
            }

            ringOf(userId: string): Subject<RtcIncomingCallNudge> {
                let ring = this.rings.get(userId);
                if (ring === undefined) {
                    ring = new Subject<RtcIncomingCallNudge>();
                    this.rings.set(userId, ring);
                }
                return ring;
            }

            place(): void {
                this.ringOf(USER_B).next({ type: 'call.incoming', callId: CALL_ID, conversationId: CONVERSATION_ID, fromUserId: USER_A, mediaKind: 'audio' });
            }

            answer(): void {
                this.publish({ type: 'call.state', callId: CALL_ID, state: 'connected' });
            }

            signal(from: string, sig: RtcSignal): void {
                if (this.held === null) {
                    this.publish({ type: 'call.signal', callId: CALL_ID, from, signal: sig });
                    return;
                }
                this.held.push({ from, signal: sig });
                const offered = new Set(this.held.filter(h => h.signal.type === 'offer').map(h => h.from));
                if (offered.size < 2) {
                    return;
                }
                // Glare: both have offered. The chosen party's offer goes first, the rest in order.
                const first = this.held.findIndex(h => h.signal.type === 'offer' && h.from === this.firstOffer);
                const order = [this.held[first], ...this.held.filter((_, i) => i !== first)];
                this.held = null;
                for (const h of order) {
                    this.publish({ type: 'call.signal', callId: CALL_ID, from: h.from, signal: h.signal });
                }
            }

            private publish(nudge: RtcCallChannelNudge): void {
                this.inFlight++;
                this.tail = this.tail.then(async () => {
                    await sleep(15);
                    this.channel.next(nudge);
                    this.inFlight--;
                });
            }
        }

        let server: FakeServer;
        let injectors: EnvironmentInjector[];
        let connections: RTCPeerConnection[];
        let audio: AudioContext[];
        let sdpErrors: string[];
        const NativePeerConnection = window.RTCPeerConnection;

        function party(userId: string): RtcCallService {
            const rtc: Partial<RtcService> = {
                place: () => {
                    server.place();
                    return of(dto('ringing'));
                },
                answer: () => {
                    server.answer();
                    return of(dto('connected'));
                },
                get: () => of(dto('connected')),
                hangup: () => of(dto('ended')),
                // A STUN that is not there: host candidates only, and nothing leaves the box.
                getIceServers: () => of({ iceServers: [{ urls: 'stun:127.0.0.1:9' }], ttlSeconds: 0 }),
                sendSignal: (_callId: string, sig: RtcSignal): Observable<void> => {
                    server.signal(userId, sig);
                    return of(undefined);
                },
            };
            const live: Partial<RtcLiveEventsService> = {
                watchUserRing: (id: string) => server.ringOf(id).asObservable(),
                watchCall: () => server.channel.asObservable(),
                isConnected: signal(true),
            };
            const injector = createEnvironmentInjector([
                RtcCallService,
                RtcMediaController,
                { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
                { provide: RtcService, useValue: rtc },
                { provide: RtcLiveEventsService, useValue: live },
                { provide: Store, useValue: { select: () => of({ id: userId }), selectSnapshot: () => ({ id: userId }) } },
                { provide: ToastService, useValue: { error: () => undefined } },
            ], TestBed.inject(EnvironmentInjector));
            injectors.push(injector);
            return injector.get(RtcCallService);
        }

        /** Place, ring, answer -- then wait until the relay is drained and both connections are stable. */
        async function callAndNegotiate(firstOffer: string): Promise<void> {
            server = new FakeServer(firstOffer);
            const a = party(USER_A);
            const b = party(USER_B);
            a.place(CONVERSATION_ID, 'audio');
            b.answer();
            const settled = (): boolean => server.idle
                && connections.length === 2
                && connections.every(pc => pc.signalingState === 'stable' && pc.remoteDescription !== null);
            const until = Date.now() + 4000;
            while (Date.now() < until && !settled()) {
                await sleep(25);
            }
            await sleep(200); // whatever the last delivery set off
        }

        beforeEach(() => {
            injectors = [];
            connections = [];
            audio = [];
            sdpErrors = [];
            // Every connection the controllers make, as the browser made it.
            const Recording = function (config?: RTCConfiguration): RTCPeerConnection {
                const pc = new NativePeerConnection(config);
                connections.push(pc);
                return pc;
            } as unknown as typeof RTCPeerConnection;
            window.RTCPeerConnection = Recording;
            // A real, silent audio track per party: no device, no permission prompt.
            spyOn(navigator.mediaDevices, 'getUserMedia').and.callFake(() => {
                const context = new AudioContext();
                audio.push(context);
                return Promise.resolve(context.createMediaStreamDestination().stream);
            });
            const consoleError = console.error.bind(console);
            spyOn(console, 'error').and.callFake((...args: unknown[]) => {
                if (typeof args[0] === 'string' && args[0].startsWith('[rtc] applySignal failed')) {
                    sdpErrors.push(String(args[1]));
                    return;
                }
                consoleError(...args);
            });
        });

        afterEach(async () => {
            for (const injector of injectors) {
                injector.get(RtcCallService).hangup();
                injector.destroy();
            }
            window.RTCPeerConnection = NativePeerConnection;
            await Promise.all(audio.map(context => context.close()));
        });

        for (const first of [USER_A, USER_B]) {
            const who = first === USER_A ? 'the caller\'s' : 'the callee\'s';

            it(`ends with each side holding the other's description when ${who} offer lands first`, async () => {
                await callAndNegotiate(first);

                expect(connections.length).withContext('one peer connection per party').toBe(2);
                const [one, two] = connections;
                expect(one.signalingState).withContext('first connection settled').toBe('stable');
                expect(two.signalingState).withContext('second connection settled').toBe('stable');
                expect(ufrag(one.localDescription)).withContext('first connection has a description of its own').not.toBeNull();
                expect(ufrag(two.localDescription)).withContext('second connection has a description of its own').not.toBeNull();
                expect(ufrag(one.remoteDescription)).withContext('first connection holds the second one\'s description')
                    .toBe(ufrag(two.localDescription));
                expect(ufrag(two.remoteDescription)).withContext('second connection holds the first one\'s description')
                    .toBe(ufrag(one.localDescription));
                expect(sdpErrors).withContext('no description was applied in the wrong state').toEqual([]);
            }, 10000);
        }
    });
});
