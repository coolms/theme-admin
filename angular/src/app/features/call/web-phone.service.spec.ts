import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Invitation } from 'sip.js';

import { CallApiService } from './call-api.service';
import { CALL_ID_HEADER } from './sip-call-relay';
import { WebPhoneService } from './web-phone.service';

/**
 * The wiring: an INVITE's call id is asked for its relay while it rings, Answer builds the call's
 * media with exactly that relay, and a call without one is answered without -- never with an account-wide set.
 */
describe('WebPhoneService (each SIP call its own relay)', () => {
    const ID = '01a10000-0000-7000-8000-000000000042';
    const TURN: RTCIceServer[] = [{ urls: ['turn:turn.test:3478'], username: '1700000000:call', credential: 'x' }];

    interface Fake {
        invitation: Invitation;
        accepted: jasmine.Spy;
    }

    /** An Invitation as the service sees it: SIP.js's own prototype, so `instanceof Invitation` holds. */
    function invite(sessionId: string, header: string | undefined): Fake {
        const accepted = jasmine.createSpy('accept').and.resolveTo();
        const invitation = Object.create(Invitation.prototype) as Invitation;
        Object.defineProperty(invitation, 'id', { value: sessionId });
        Object.defineProperty(invitation, 'request', {
            value: { getHeader: (name: string) => (name === CALL_ID_HEADER ? header : undefined) },
        });
        Object.defineProperty(invitation, 'remoteIdentity', {
            value: { displayName: 'Caller', uri: { user: '1001' } },
        });
        Object.defineProperty(invitation, 'stateChange', { value: { addListener: () => undefined } });
        Object.defineProperty(invitation, 'accept', { value: accepted });

        return { invitation, accepted };
    }

    function setup(api: Partial<Record<keyof CallApiService, unknown>>): WebPhoneService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                WebPhoneService,
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: CallApiService, useValue: api },
            ],
        });

        return TestBed.inject(WebPhoneService);
    }

    type Internals = {
        onInvite(invitation: Invitation): void;
        iceServersBySession: Map<string, RTCIceServer[]>;
    };

    it('asks for the ringing call\'s relay by its id and answers with exactly that relay', async () => {
        const asked = jasmine.createSpy('getSipCallIceServers').and.returnValue(
            of({ callId: ID, iceServers: TURN, ttlSeconds: 300 }),
        );
        const phone = setup({ getSipCallIceServers: asked });
        const { invitation, accepted } = invite('s1', ID);

        (phone as unknown as Internals).onInvite(invitation);
        await phone.answer();

        expect(asked).toHaveBeenCalledOnceWith(ID);
        expect(accepted).toHaveBeenCalled();
        expect((phone as unknown as Internals).iceServersBySession.get('s1')).toEqual(TURN);
        expect(phone.noRelay()).toBeNull();
    });

    it('answers a call without an id without a relay, asks for none, and says so', async () => {
        const asked = jasmine.createSpy('getSipCallIceServers');
        const phone = setup({ getSipCallIceServers: asked });
        const { invitation, accepted } = invite('s2', undefined);

        (phone as unknown as Internals).onInvite(invitation);
        await phone.answer();

        expect(asked).not.toHaveBeenCalled();
        expect(accepted).toHaveBeenCalled();
        expect((phone as unknown as Internals).iceServersBySession.get('s2')).toEqual([]);
        expect(phone.noRelay()).toBe('no call id');
    });

    it('answers a call the backend refuses without a relay, the refusal named', async () => {
        const asked = jasmine.createSpy('getSipCallIceServers').and.returnValue(
            throwError(() => new HttpErrorResponse({ status: 409 })),
        );
        const phone = setup({ getSipCallIceServers: asked });
        const { invitation, accepted } = invite('s3', ID);

        (phone as unknown as Internals).onInvite(invitation);
        await phone.answer();

        expect(accepted).toHaveBeenCalled();
        expect((phone as unknown as Internals).iceServersBySession.get('s3')).toEqual([]);
        expect(phone.noRelay()).toBe('refused (409)');
    });
});
