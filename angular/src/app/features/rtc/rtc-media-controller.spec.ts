import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { RtcMediaController } from './rtc-media-controller';
import { RtcService } from './rtc.service';
import { RtcSignal } from './rtc.types';

/**
 * What the controller asks of its peer connection, in order. The next remote description
 * can be held open (`holdNext`), so a test can deliver a signal while it is being applied.
 */
class FakePeerConnection {
    static created: FakePeerConnection[] = [];
    static holdNext = false;

    onicecandidate: unknown = null;
    ontrack: unknown = null;
    onnegotiationneeded: unknown = null;
    remoteDescription: RTCSessionDescriptionInit | null = null;
    localDescription: RTCSessionDescriptionInit | null = null;
    readonly signalingState: RTCSignalingState = 'stable';
    readonly events: string[] = [];
    release: (() => void) | null = null;

    constructor() {
        FakePeerConnection.created.push(this);
    }

    setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this.events.push('remote ' + description.sdp + ' begins');
        const done = (): void => {
            this.remoteDescription = description;
            this.events.push('remote ' + description.sdp + ' set');
        };
        if (FakePeerConnection.holdNext) {
            FakePeerConnection.holdNext = false;
            return new Promise<void>(resolve => {
                this.release = (): void => {
                    done();
                    resolve();
                };
            });
        }
        done();
        return Promise.resolve();
    }

    setLocalDescription(): Promise<void> {
        this.localDescription = { type: 'answer', sdp: 'answer' };
        return Promise.resolve();
    }

    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        this.events.push('candidate ' + candidate.candidate);
        return Promise.resolve();
    }

    close(): void {
        this.events.push('closed');
    }
}

const offer = (sdp: string): RtcSignal => ({ type: 'offer', payload: { type: 'offer', sdp } });
const candidate = (n: number): RtcSignal => ({ type: 'candidate', payload: { candidate: 'c' + n, sdpMid: '0', sdpMLineIndex: 0 } });

/** A few turns of the event loop: time for a signal applied at once to have begun. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

async function until(what: string, condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    fail('never happened: ' + what);
}

/**
 * The signals the controller holds until its media is ready (theme-admin#56, the site's review):
 * applied for this call only, in the order they came -- with what arrives while they are being
 * applied queued behind them, not beside them -- and a full queue says so, once.
 */
describe('RtcMediaController -- the signals held until the media is ready', () => {
    const NativePeerConnection = window.RTCPeerConnection;
    let controller: RtcMediaController;

    beforeEach(() => {
        FakePeerConnection.created = [];
        FakePeerConnection.holdNext = false;
        window.RTCPeerConnection = FakePeerConnection as unknown as typeof RTCPeerConnection;
        spyOn(navigator.mediaDevices, 'getUserMedia').and.callFake(() => Promise.resolve(new MediaStream()));
        TestBed.configureTestingModule({
            providers: [
                { provide: RtcService, useValue: { getIceServers: () => of({ iceServers: [] }), sendSignal: () => of(null) } },
                { provide: ToastService, useValue: { error: () => undefined } },
            ],
        });
        controller = TestBed.inject(RtcMediaController);
    });

    afterEach(() => {
        controller.stop();
        window.RTCPeerConnection = NativePeerConnection;
    });

    it('applies only this call\'s held signals when its media starts: another call\'s are dropped', async () => {
        controller.handleSignal('call-x', offer('x'));
        controller.handleSignal('call-y', offer('y'));

        await controller.start('call-y', true, 'audio');

        expect(FakePeerConnection.created.length).toBe(1);
        expect(FakePeerConnection.created[0].events)
            .withContext('call-y\'s offer applied, call-x\'s never')
            .toEqual(['remote y begins', 'remote y set']);
    });

    it('queues an offer that arrives while the held ones are being applied behind them, not beside them', async () => {
        FakePeerConnection.holdNext = true;
        controller.handleSignal('call-y', offer('first'));
        const started = controller.start('call-y', true, 'audio');
        await until('the held offer is being applied', () => (FakePeerConnection.created[0]?.release ?? null) !== null);

        controller.handleSignal('call-y', offer('second'));
        await settle();
        FakePeerConnection.created[0].release!();
        await started;

        expect(FakePeerConnection.created[0].events)
            .withContext('the second offer began only once the first was set')
            .toEqual(['remote first begins', 'remote first set', 'remote second begins', 'remote second set']);
    });

    it('says once when the queue is full, and still applies everything it kept, first come first', async () => {
        const warn = spyOn(console, 'warn');
        controller.handleSignal('call-y', offer('y'));
        for (let n = 0; n < 201; n++) {
            controller.handleSignal('call-y', candidate(n));
        }

        expect(warn).withContext('two refused, one warning').toHaveBeenCalledTimes(1);
        expect(String(warn.calls.argsFor(0)[0])).toContain('200 signals are already held');

        await controller.start('call-y', true, 'audio');
        const events = FakePeerConnection.created[0].events;
        expect(events.slice(0, 2)).toEqual(['remote y begins', 'remote y set']);
        expect(events.filter(e => e.startsWith('candidate')).length).withContext('the 199 candidates kept').toBe(199);
        expect(events[events.length - 1]).toBe('candidate c198');
    });
});
