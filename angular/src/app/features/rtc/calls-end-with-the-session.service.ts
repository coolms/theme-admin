import { inject, Injectable } from '@angular/core';
import { Store } from '@ngxs/store';
import { catchError, map, type Observable, of, tap, timeout } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import { RtcCallService } from './rtc-call.service';
import { RtcService } from './rtc.service';

/**
 * When this browser's session ends, its calls end with it (coordinator, 2026-09-25).
 *
 * The server ends a 1:1 call by telling the OTHER party; the signed-out party's own
 * client never hears it -- its realtime connection is cut on the same message -- so it
 * kept its side of the call, its peer connection open and its media flowing, until the
 * other side had gone (measured by the call harness: +6.5 to +7.6 s, `disconnected`, never
 * closed). So a client whose session ends closes its calls itself:
 *
 *   - `start()`: the moment the signed-in state goes from true to false -- a refresh the
 *     server refused after a sign-out everywhere on another device, or any other end --
 *     the call is hung up here. The request that tells the server may be refused (the
 *     session is gone); `hangup()` ends the call locally whatever it answers.
 *   - `endBeforeSigningOut()`: this browser's own sign-out hangs up FIRST, while the
 *     session still holds, and waits (at most three seconds) for the server's answer:
 *     an ordinary sign-out ends only this session, so nothing else would tell the other
 *     party the call is over.
 */
@Injectable({ providedIn: 'root' })
export class CallsEndWithTheSession {
    private readonly store = inject(Store);
    private readonly calls = inject(RtcCallService);
    private readonly rtc = inject(RtcService);
    private started = false;

    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        let signedIn = false;
        this.store.select(AuthState.isAuthenticated).subscribe(now => {
            if (signedIn && !now) {
                this.calls.hangup();
            }
            signedIn = now;
        });
    }

    endBeforeSigningOut(): Observable<void> {
        const call = this.calls.activeCall();
        if (call === null) {
            return of(undefined);
        }

        return this.rtc.hangup(call.callId).pipe(
            timeout(3000),
            catchError(() => of(null)),
            tap(() => this.calls.hangup()),
            map(() => undefined),
        );
    }
}
