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
 * A 1:1 call's negotiation, as the server actually relays it and as the server
 * names its roles.
 *
 * `POST /rtc/calls/{id}/signal` is published on `rtc.call.{id}` (RtcCallPublisher),
 * and BOTH parties subscribe to that channel -- so every offer, answer and candidate
 * reaches its own sender too, stamped with the sender's user id in `from`. Both
 * parties start media on the same `call.state connected`, so both offer at once: the
 * glare perfect negotiation exists for, where one peer is polite and yields.
 *
 * The echo broke it. The polite callee never ignores an offer, so its own offer,
 * coming back, was applied as the PEER's: when the caller's offer landed first, the
 * callee answered it and then rolled back onto its own SDP as the remote description,
 * and the call never connected (measured with tools/call-harness, 2026-09-25: about
 * half the runs, "Failed to set remote answer sdp: Called in wrong state" in every
 * run). The orchestrator now forwards only the PEER's `call.signal`.
 *
 * WHO is polite is the server's to say (Dmitry, 2026-09-26): `politeUserId` on the
 * call record and on every `call.state` -- the callee. The client READS it and never
 * derives it from its own role: two clients each applying a rule need disagree only
 * once to be both polite or both impolite. So the specs below also have the server
 * name the CALLER, which only a client that reads the field follows.
 *
 * The second group runs two REAL parties -- each its own RtcCallService and its own
 * RtcMediaController over a real RTCPeerConnection in the test browser -- joined by
 * a fake server whose channel broadcasts to both, sender included, as Centrifugo
 * does. It holds the signals until both parties have offered and then releases
 * them with a chosen party's offer first, so the glare happens on every run instead
 * of half of them. What is asserted is the negotiation's END STATE: each connection's
 * remote description carries the ICE credentials the OTHER connection holds now, and
 * the side that ANSWERED is the one the server named polite. ICE itself is not
 * waited for -- the suite's Chrome hides host addresses behind mDNS names nothing in
 * the container resolves (the call harness turns that off for the same reason), so
 * connectivity here would measure the container, not the negotiation.
 *
 * Measured with the `from` check removed from RtcCallService.onCallNudge (every
 * signal forwarded, as before): the forwarding spec fails, and the glare specs fail
 * on connections ending on descriptions the other no longer holds and on "Failed to
 * set remote answer sdp: Called in wrong state: stable" three times per order.
 * Measured with the role computed again (`polite = role === 'callee'`): the specs in
 * which the server names the caller fail -- the callee starts polite, and under glare
 * the callee is the side that answers.
 */
describe('RtcCallService -- a call.signal is applied only when it is the peer\'s', () => {
    const CALL_ID = 'call-1';
    const CONVERSATION_ID = 'conv-1';
    const USER_A = 'user-a'; // the caller
    const USER_B = 'user-b'; // the callee

    function dto(state: RtcCallState, politeUserId: string | null = USER_B): RtcCallDto {
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
            politeUserId,
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
        /** What the server's record names as the polite peer, for answer() and the GET before media starts. */
        let named: string | null;

        beforeEach(() => {
            named = USER_B;
            channel = new Subject<RtcCallChannelNudge>();
            const ring = new Subject<RtcIncomingCallNudge>();
            media = jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'setPolite', 'stop']);
            media.start.and.returnValue(Promise.resolve());
            injector = createEnvironmentInjector([
                RtcCallService,
                { provide: RtcMediaController, useValue: media },
                { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
                {
                    provide: RtcService,
                    useValue: {
                        answer: () => of(dto('connected', named)),
                        get: () => of(dto('connected', named)),
                        hangup: () => of(dto('ended', named)),
                    },
                },
                {
                    provide: RtcLiveEventsService,
                    useValue: {
                        watchUserRing: () => ring.asObservable(),
                        watchCall: () => channel.asObservable(),
                        isConnected: signal(true),
                        connect: () => Promise.resolve(),
                    },
                },
                // This party is the CALLEE, B.
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

        it('starts the mesh polite when the server names this user', () => {
            named = USER_B;
            service.answer();

            expect(media.start).toHaveBeenCalledOnceWith(CALL_ID, true, 'audio');
        });

        it('starts the mesh impolite when the server names the other party -- even though this party is the callee', () => {
            named = USER_A;
            service.answer();

            expect(media.start).toHaveBeenCalledOnceWith(CALL_ID, false, 'audio');
        });

        it('reads the server\'s id whatever its letter case', () => {
            named = USER_B.toUpperCase();
            service.answer();

            expect(media.start).toHaveBeenCalledOnceWith(CALL_ID, true, 'audio');
        });

        it('starts the mesh impolite when the server names no one', () => {
            named = null;
            service.answer();

            expect(media.start).toHaveBeenCalledOnceWith(CALL_ID, false, 'audio');
        });

        it('passes on what every call.state says to the running media plane', () => {
            service.answer();
            media.setPolite.calls.reset();

            channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_A });
            channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B });

            expect(media.setPolite.calls.allArgs()).toEqual([[CALL_ID, false], [CALL_ID, true]]);
            expect(service.activeCall()?.politeUserId).toBe(USER_B);
        });
    });

    describe('two parties over a channel that echoes to its sender', () => {
        /**
         * The server: places, rings, answers, and relays signals on one broadcast
         * channel, one delivery at a time with a small gap (a network, not a
         * synchronous call). Signals are held until both parties have offered. It
         * names `politeUserId` on every record and every `call.state`.
         */
        class FakeServer {
            readonly channel = new Subject<RtcCallChannelNudge>();
            readonly rings = new Map<string, Subject<RtcIncomingCallNudge>>();
            private held: { from: string; signal: RtcSignal }[] | null = [];
            private tail: Promise<void> = Promise.resolve();
            private inFlight = 0;

            constructor(
                private readonly firstOffer: string,
                readonly politeUserId: string,
                private readonly candidatesFirst = false,
            ) {}

            get idle(): boolean {
                return this.held === null && this.inFlight === 0;
            }

            record(state: RtcCallState): RtcCallDto {
                return dto(state, this.politeUserId);
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
                this.publish({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: this.politeUserId });
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
                const rest = this.held.filter((_, i) => i !== first);
                const order = this.candidatesFirst
                    // Every candidate before any description -- the order a busy sender or a slow
                    // relay produces, and the one that lost candidates before they were queued.
                    ? [...rest.filter(h => h.signal.type === 'candidate'), this.held[first], ...rest.filter(h => h.signal.type !== 'candidate')]
                    : [this.held[first], ...rest];
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

        // A STUN that is not there, one address per party: host candidates only, nothing
        // leaves the box, and the address tells the parties' connections apart.
        const STUN: Record<string, string> = { [USER_A]: 'stun:127.0.0.1:9', [USER_B]: 'stun:127.0.0.2:9' };

        let server: FakeServer;
        let injectors: EnvironmentInjector[];
        let connections: Map<string, RTCPeerConnection>;
        let audio: AudioContext[];
        let sdpErrors: string[];
        let candidateErrors: string[];
        let sent: Map<string, number>;
        let added: Map<string, number>;
        const NativePeerConnection = window.RTCPeerConnection;

        function party(userId: string): RtcCallService {
            const rtc: Partial<RtcService> = {
                place: () => {
                    server.place();
                    return of(server.record('ringing'));
                },
                answer: () => {
                    server.answer();
                    return of(server.record('connected'));
                },
                get: () => of(server.record('connected')),
                hangup: () => of(server.record('ended')),
                getIceServers: () => of({ iceServers: [{ urls: STUN[userId] }], ttlSeconds: 0 }),
                sendSignal: (_callId: string, sig: RtcSignal): Observable<void> => {
                    if (sig.type === 'candidate') {
                        sent.set(userId, (sent.get(userId) ?? 0) + 1);
                    }
                    server.signal(userId, sig);
                    return of(undefined);
                },
            };
            const live: Partial<RtcLiveEventsService> = {
                watchUserRing: (id: string) => server.ringOf(id).asObservable(),
                watchCall: () => server.channel.asObservable(),
                isConnected: signal(true),
                connect: () => Promise.resolve(),
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
        async function callAndNegotiate(firstOffer: string, politeUserId: string, candidatesFirst = false): Promise<void> {
            server = new FakeServer(firstOffer, politeUserId, candidatesFirst);
            const a = party(USER_A);
            const b = party(USER_B);
            a.place(CONVERSATION_ID, 'audio');
            b.answer();
            const settled = (): boolean => server.idle
                && connections.size === 2
                && [...connections.values()].every(pc => pc.signalingState === 'stable' && pc.remoteDescription !== null);
            const until = Date.now() + 4000;
            while (Date.now() < until && !settled()) {
                await sleep(25);
            }
            await sleep(200); // whatever the last delivery set off
        }

        beforeEach(() => {
            injectors = [];
            connections = new Map<string, RTCPeerConnection>();
            audio = [];
            sdpErrors = [];
            candidateErrors = [];
            sent = new Map<string, number>();
            added = new Map<string, number>();
            // Every connection the controllers make, as the browser made it, by party.
            const Recording = function (config?: RTCConfiguration): RTCPeerConnection {
                const pc = new NativePeerConnection(config);
                const urls = config?.iceServers?.[0]?.urls;
                const owner = Object.keys(STUN).find(user => STUN[user] === urls) ?? 'unknown';
                connections.set(owner, pc);
                // Count the candidates this connection actually took in.
                const add = pc.addIceCandidate.bind(pc) as (c?: RTCIceCandidateInit) => Promise<void>;
                (pc as unknown as { addIceCandidate: (c?: RTCIceCandidateInit) => Promise<void> }).addIceCandidate =
                    async (c?: RTCIceCandidateInit): Promise<void> => {
                        await add(c);
                        added.set(owner, (added.get(owner) ?? 0) + 1);
                    };
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
                if (typeof args[0] === 'string' && args[0].startsWith('[rtc] addIceCandidate failed')) {
                    candidateErrors.push(String(args[1]));
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

        const CASES: { polite: string; first: string }[] = [
            { polite: USER_B, first: USER_A },
            { polite: USER_B, first: USER_B },
            { polite: USER_A, first: USER_A },
            { polite: USER_A, first: USER_B },
        ];
        for (const { polite, first } of CASES) {
            const named = polite === USER_B ? 'the callee (as the server rules)' : 'the caller';
            const lands = first === USER_A ? 'the caller\'s' : 'the callee\'s';
            const impolite = polite === USER_A ? USER_B : USER_A;

            it(`with ${named} named polite and ${lands} offer landing first, each side ends holding the other's description`, async () => {
                await callAndNegotiate(first, polite);

                const mine = connections.get(polite);
                const theirs = connections.get(impolite);
                expect(connections.size).withContext('one peer connection per party').toBe(2);
                expect(mine).withContext('the polite party\'s connection').toBeDefined();
                expect(theirs).withContext('the impolite party\'s connection').toBeDefined();
                if (mine === undefined || theirs === undefined) {
                    return;
                }
                expect(mine.signalingState).withContext('polite connection settled').toBe('stable');
                expect(theirs.signalingState).withContext('impolite connection settled').toBe('stable');
                expect(ufrag(mine.localDescription)).withContext('polite connection has a description of its own').not.toBeNull();
                expect(ufrag(theirs.localDescription)).withContext('impolite connection has a description of its own').not.toBeNull();
                expect(ufrag(mine.remoteDescription)).withContext('polite connection holds the other one\'s description')
                    .toBe(ufrag(theirs.localDescription));
                expect(ufrag(theirs.remoteDescription)).withContext('impolite connection holds the other one\'s description')
                    .toBe(ufrag(mine.localDescription));
                // Under glare the polite side yields: it rolls its offer back and answers.
                expect(mine.localDescription?.type).withContext('the side the server named polite is the one that answered').toBe('answer');
                expect(theirs.localDescription?.type).withContext('the impolite side kept its offer').toBe('offer');
                expect(sdpErrors).withContext('no description was applied in the wrong state').toEqual([]);
            }, 10000);
        }

        // A candidate that reaches a connection before the peer's description must be kept
        // and applied once the description is in -- not refused and lost. Measured with the
        // call harness in a container (one network interface): a dropped candidate was the
        // only path, and the call never connected.
        for (const first of [USER_A, USER_B]) {
            const lands = first === USER_A ? 'the caller\'s' : 'the callee\'s';
            it(`with every candidate delivered before the descriptions (${lands} offer first), each side applies every candidate the other sent`, async () => {
                await callAndNegotiate(first, USER_B, true);

                expect(connections.size).withContext('one peer connection per party').toBe(2);
                expect(candidateErrors).withContext('a candidate refused (for arriving before the description, or at all)').toEqual([]);
                for (const [owner, other] of [[USER_A, USER_B], [USER_B, USER_A]]) {
                    expect(sent.get(other) ?? 0).withContext(`${other} sent candidates`).toBeGreaterThan(0);
                    expect(added.get(owner) ?? 0).withContext(`${owner}'s connection applied every candidate ${other} sent`)
                        .toBe(sent.get(other) ?? 0);
                }
                expect(sdpErrors).withContext('no description was applied in the wrong state').toEqual([]);
            }, 10000);
        }
    });
});

/**
 * The caller whose subscription to the call's channel became active AFTER the server
 * published `call.state connected` -- the answer landing while the caller was still
 * subscribing. The channel keeps no history, so that publication never reaches the caller.
 * Measured with tools/call-harness, 2026-09-27: in 1 of 60 runs the callee connected and
 * the caller never received `connected` and never started its media. The caller now reads
 * the call when its subscription becomes active (RtcLiveEventsService.watchCall's
 * `onSubscribed`), and every change after that arrives on the channel.
 */
describe('RtcCallService -- the caller who subscribed after the call connected', () => {
    const CALL_ID = 'call-1';
    const CONVERSATION_ID = 'conv-1';
    const USER_A = 'user-a'; // the caller, this party
    const USER_B = 'user-b';

    let channel: Subject<RtcCallChannelNudge>;
    let onSubscribed: (() => void) | null;
    /** What the server holds when this party reads the call. */
    let serverState: RtcCallState;
    let media: jasmine.SpyObj<RtcMediaController>;
    let service: RtcCallService;
    let injector: EnvironmentInjector;

    function record(state: RtcCallState): RtcCallDto {
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
            politeUserId: USER_B,
            createdAt: null,
            participants: [
                { userId: USER_A, state: 'joined', joinedAt: null, leftAt: null },
                { userId: USER_B, state: state === 'ringing' ? 'invited' : 'joined', joinedAt: null, leftAt: null },
            ],
        };
    }

    beforeEach(() => {
        channel = new Subject<RtcCallChannelNudge>();
        onSubscribed = null;
        serverState = 'ringing';
        media = jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'setPolite', 'stop']);
        media.start.and.returnValue(Promise.resolve());
        const live: Partial<RtcLiveEventsService> = {
            watchUserRing: () => new Subject<RtcIncomingCallNudge>().asObservable(),
            watchCall: (_callId: string, told?: () => void) => {
                onSubscribed = told ?? null;
                return channel.asObservable();
            },
            isConnected: signal(true),
            connect: () => Promise.resolve(),
        };
        injector = createEnvironmentInjector([
            RtcCallService,
            { provide: RtcMediaController, useValue: media },
            { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
            {
                provide: RtcService,
                useValue: {
                    place: () => of(record('ringing')),
                    get: () => of(record(serverState)),
                    hangup: () => of(record('ended')),
                },
            },
            { provide: RtcLiveEventsService, useValue: live },
            { provide: Store, useValue: { select: () => of({ id: USER_A }), selectSnapshot: () => ({ id: USER_A }) } },
            { provide: ToastService, useValue: { error: () => undefined } },
        ], TestBed.inject(EnvironmentInjector));
        service = injector.get(RtcCallService);
        service.place(CONVERSATION_ID, 'audio');
    });

    afterEach(() => injector.destroy());

    it('reads the call once its subscription is active, and starts its media on the connected it never received', () => {
        expect(service.activeCall()?.ui).withContext('placed: ringing out').toBe('ringing-out');
        expect(onSubscribed).withContext('the watch asks to be told when it is subscribed').not.toBeNull();
        serverState = 'connected'; // B answered while A was still subscribing: that publication is gone

        onSubscribed?.();

        expect(service.activeCall()?.ui).toBe('connected');
        expect(media.start).toHaveBeenCalledOnceWith(CALL_ID, false, 'audio');
    });

    it('still ringing when it subscribes: nothing starts until the channel says connected, then once', () => {
        onSubscribed?.();
        expect(service.activeCall()?.ui).toBe('ringing-out');
        expect(media.start).not.toHaveBeenCalled();

        serverState = 'connected';
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B });

        expect(service.activeCall()?.ui).toBe('connected');
        expect(media.start).toHaveBeenCalledTimes(1);
    });

    it('never starts its media twice: a resubscribe and the channel\'s connected after the read', () => {
        serverState = 'connected';

        onSubscribed?.();
        onSubscribed?.();
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B });

        expect(media.start).toHaveBeenCalledTimes(1);
    });

    it('a call declined before it subscribed is shown ended, with the reason', () => {
        serverState = 'declined';

        onSubscribed?.();

        expect(service.activeCall()?.ui).toBe('ended');
        expect(service.activeCall()?.endReason).toBe('declined');
        expect(media.start).not.toHaveBeenCalled();
    });
});

/**
 * The read made on subscribing and the channel race (Dmitry, 2026-09-28): between the
 * subscription becoming active and the read returning, a `call.state` can arrive, and the
 * read then carries a state OLDER than what the channel already said. Every record and every
 * `call.state` carries the state's `version` (assigned by the server's database); the client
 * keeps the highest it has seen and applies a record only when its version is not lower.
 *
 * Each read here stays pending until the spec answers it, so the order is the spec's.
 */
describe('RtcCallService -- a read older than the channel is not applied', () => {
    const CALL_ID = 'call-1';
    const CONVERSATION_ID = 'conv-1';
    const USER_A = 'user-a'; // the caller, this party
    const USER_B = 'user-b';

    let channel: Subject<RtcCallChannelNudge>;
    let onSubscribed: (() => void) | null;
    /** Every read, in the order it was made; each answers when the spec says. */
    let reads: Subject<RtcCallDto>[];
    let media: jasmine.SpyObj<RtcMediaController>;
    let service: RtcCallService;
    let injector: EnvironmentInjector;

    function record(state: RtcCallState, version?: number, recordingActive = false): RtcCallDto {
        return {
            id: CALL_ID,
            conversationId: CONVERSATION_ID,
            initiatorUserId: USER_A,
            mediaKind: 'audio',
            state,
            connectedAt: null,
            endedAt: null,
            endReason: null,
            recordingActive,
            politeUserId: USER_B,
            createdAt: null,
            participants: [
                { userId: USER_A, state: 'joined', joinedAt: null, leftAt: null },
                { userId: USER_B, state: state === 'ringing' ? 'invited' : 'joined', joinedAt: null, leftAt: null },
            ],
            ...(version === undefined ? {} : { version }),
        };
    }

    function answer(read: number, dto: RtcCallDto): void {
        reads[read].next(dto);
        reads[read].complete();
    }

    beforeEach(() => {
        channel = new Subject<RtcCallChannelNudge>();
        onSubscribed = null;
        reads = [];
        media = jasmine.createSpyObj<RtcMediaController>('RtcMediaController', ['start', 'handleSignal', 'setPolite', 'stop']);
        media.start.and.returnValue(Promise.resolve());
        const live: Partial<RtcLiveEventsService> = {
            watchUserRing: () => new Subject<RtcIncomingCallNudge>().asObservable(),
            watchCall: (_callId: string, told?: () => void) => {
                onSubscribed = told ?? null;
                return channel.asObservable();
            },
            isConnected: signal(true),
            connect: () => Promise.resolve(),
        };
        injector = createEnvironmentInjector([
            RtcCallService,
            { provide: RtcMediaController, useValue: media },
            { provide: RtcSfuMediaController, useValue: { start: () => Promise.resolve(), stop: () => undefined } },
            {
                provide: RtcService,
                useValue: {
                    place: () => of(record('ringing', 1)),
                    get: (): Observable<RtcCallDto> => {
                        const read = new Subject<RtcCallDto>();
                        reads.push(read);
                        return read.asObservable();
                    },
                    hangup: () => of(record('ended', 3)),
                },
            },
            { provide: RtcLiveEventsService, useValue: live },
            { provide: Store, useValue: { select: () => of({ id: USER_A }), selectSnapshot: () => ({ id: USER_A }) } },
            { provide: ToastService, useValue: { error: () => undefined } },
        ], TestBed.inject(EnvironmentInjector));
        service = injector.get(RtcCallService);
        service.place(CONVERSATION_ID, 'audio');
        subscribed(); // the catch-up read is made, and stays pending
    });

    /** The call's channel subscription became active. */
    function subscribed(): void {
        onSubscribed?.();
    }

    afterEach(() => injector.destroy());

    it('"connected" arrives on the channel before the read\'s "ringing" returns, and the client stays connected', () => {
        expect(reads.length).withContext('the catch-up read is in flight').toBe(1);

        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B, version: 2 });
        answer(1, record('connected', 2)); // the media plane's roster read
        answer(0, record('ringing', 1)); // the catch-up read, taken before the answer

        expect(service.activeCall()?.ui).toBe('connected');
        expect(service.activeCall()?.version).toBe(2);
        expect(media.setPolite).withContext('told once, by the channel; nothing of the older record was applied').toHaveBeenCalledTimes(1);
        expect(media.start).toHaveBeenCalledTimes(1);
        expect(media.stop).not.toHaveBeenCalled();
    });

    it('a read of "connected" older than the channel\'s "ended" does not bring the call back', () => {
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B, version: 2 });
        answer(1, record('connected', 2));
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'ended', politeUserId: USER_B, version: 3 });
        expect(service.activeCall()?.ui).withContext('the channel ended it').toBe('ended');

        answer(0, record('connected', 2)); // the catch-up read, taken before the hang-up

        expect(service.activeCall()?.ui).toBe('ended');
        expect(media.start).withContext('media is not started again').toHaveBeenCalledTimes(1);
    });

    it('a read at the version the client holds is applied: it is not older', () => {
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B, version: 2 });
        answer(1, record('connected', 2));

        answer(0, record('connected', 2, true));

        expect(service.activeCall()?.recording).toBe(true);
    });

    it('a call.state older than the record already applied is not applied either', () => {
        answer(0, record('ended', 3));
        expect(service.activeCall()?.ui).toBe('ended');

        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B, version: 2 });

        expect(service.activeCall()?.ui).toBe('ended');
        expect(media.start).not.toHaveBeenCalled();
    });

    it('a server that sends no version is applied as it arrives', () => {
        channel.next({ type: 'call.state', callId: CALL_ID, state: 'connected', politeUserId: USER_B });
        answer(1, record('connected'));
        answer(0, record('declined'));

        expect(service.activeCall()?.ui).withContext('nothing to order it by').toBe('ended');
    });
});
