import { HttpErrorResponse } from '@angular/common/http';

/**
 * Each SIP call's relay credential, never the account's.
 *
 * Asterisk's pre-dial handler puts the backend's call id on every ringing leg's INVITE (docker/asterisk,
 * [coolms-leg]); `GET /call/webphone/ice-servers?callId=` answers that call's ICE servers to its parties only,
 * for 300 s. A call that rang without an id gets no credential and NO fallback to the account-wide
 * `/rtc/ice-servers` (ruled 2026-10-02) -- so it is answered without a relay, and the overlay says so, with
 * the reason logged: the ruling's cost made visible, not only correct.
 *
 * An existing allocation keeps working on an expired credential (measured 2026-10-02: 21 of 21 readings through
 * the stale nonce and the allocation's own refresh), so a stable call never refetches. A NEW allocation -- an ICE
 * restart -- would need a fresh one; the web phone has no ICE-restart path today (measured: no iceRestart and no
 * Inviter anywhere in the admin), and one added later must refetch first.
 */

/** The header Asterisk puts on every ringing leg. */
export const CALL_ID_HEADER = 'X-CoolMS-Call-Id';

/** How long Answer waits for the call's credential before answering without a relay. */
export const RELAY_ANSWER_BOUND_MS = 2000;

/** Why a call is answered without a relay: the refusals, a network error and the bound are told apart. */
export type NoRelayReason =
    | 'no call id'
    | 'none issued'
    | 'refused (403)'
    | 'refused (404)'
    | 'refused (409)'
    | 'network error'
    | 'answer bound (2 s)'
    | `failed (${number})`;

export interface CallRelay {
    readonly iceServers: RTCIceServer[];
    /** Null when the call has its relay credential. */
    readonly noRelay: NoRelayReason | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The call id an INVITE carries, or null: anything but a UUID is no id. */
export function callIdOf(header: string | null | undefined): string | null {
    const value = (header ?? '').trim();

    return UUID.test(value) ? value.toLowerCase() : null;
}

/** The relay a call gets: its own ICE servers, or none and why. Never throws. */
export async function resolveCallRelay(
    callId: string | null,
    fetchIceServers: (callId: string) => Promise<{ readonly iceServers?: RTCIceServer[] }>,
): Promise<CallRelay> {
    if (null === callId) {
        return { iceServers: [], noRelay: 'no call id' };
    }
    try {
        const answer = await fetchIceServers(callId);
        const iceServers = answer.iceServers ?? [];

        return { iceServers, noRelay: 0 === iceServers.length ? 'none issued' : null };
    } catch (error) {
        return { iceServers: [], noRelay: reasonOf(error) };
    }
}

export function reasonOf(error: unknown): NoRelayReason {
    if (!(error instanceof HttpErrorResponse) || 0 === error.status) {
        return 'network error';
    }
    switch (error.status) {
        case 403:
            return 'refused (403)';
        case 404:
            return 'refused (404)';
        case 409:
            return 'refused (409)';
        default:
            return `failed (${error.status})`;
    }
}

/** The relay, or none once the bound passes: Answer never waits longer than the bound. */
export function withinBound(relay: Promise<CallRelay>, boundMs: number = RELAY_ANSWER_BOUND_MS): Promise<CallRelay> {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ iceServers: [], noRelay: 'answer bound (2 s)' }), boundMs);
        void relay.then(result => {
            clearTimeout(timer);
            resolve(result);
        });
    });
}

/**
 * A session description handler factory that gives each session its OWN ICE servers -- SIP.js builds a
 * session's handler through the factory with the session itself, so the lookup is by the session's id. A
 * session with none recorded gets none: there is no account-wide fallback.
 */
export function withPerCallIceServers<
    S extends { readonly id: string },
    O extends { peerConnectionConfiguration?: RTCConfiguration },
    H,
>(
    base: (session: S, options?: O) => H,
    iceServersFor: (sessionId: string) => RTCIceServer[] | undefined,
): (session: S, options?: O) => H {
    return (session, options) =>
        base(session, {
            ...(options ?? {}),
            peerConnectionConfiguration: {
                ...(options?.peerConnectionConfiguration ?? {}),
                iceServers: iceServersFor(session.id) ?? [],
            },
        } as O);
}
