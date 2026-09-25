import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { catchError, map, type Observable, of, switchMap, tap } from 'rxjs';
import { AppConfigState, Logout } from '@coolms/core-angular';
import { CallsEndWithTheSession } from '../features/rtc/calls-end-with-the-session.service';

/**
 * Signing out, on the server as well as in this browser (2026-09-25).
 *
 * Until then the admin's "Sign out" only dispatched `Logout`, which clears the tokens
 * in this browser and nothing else: the session, and its refresh token, stayed valid
 * on the server for their whole lifetime. Measured by reading the code; the API says
 * so itself -- "discarding the token in the client is not equivalent".
 *
 *   - `signOut()` -- `POST {apiBase}/auth/logout`: this session ends.
 *   - `signOut({ everywhere: true })` -- `...?everywhere=true`: every session of the
 *     account ends, on every device, and every device is forgotten (the one to use
 *     when a device or a token may be in someone else's hands).
 *
 * A call this browser is in is hung up first, while the session still holds
 * ({@see CallsEndWithTheSession}). Then this browser is signed out and sent to the
 * sign-in page whatever the server answered: a request the network refused must not
 * leave the person signed in here.
 */
@Injectable({ providedIn: 'root' })
export class SignOutService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly router = inject(Router);
    private readonly calls = inject(CallsEndWithTheSession);

    signOut(options: { everywhere?: boolean } = {}): Observable<void> {
        const params = options.everywhere === true ? new HttpParams().set('everywhere', 'true') : undefined;

        return this.calls.endBeforeSigningOut().pipe(
            switchMap(() => this.http.post(`${this.apiBase}/auth/logout`, null, { params })),
            catchError(() => of(null)),
            switchMap(() => this.store.dispatch(new Logout())),
            tap(() => void this.router.navigate(['/login'])),
            map(() => undefined),
        );
    }

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }
}
