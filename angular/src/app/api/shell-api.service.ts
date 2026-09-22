import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, IdentityApiClient, type TokenResponse, type UserDto } from '@coolms/core-angular';

/**
 * What the SHELL owns of the API: the session and the application config.
 *
 * Until 2026-09-21 this was `ApiService`, 2,538 lines and 128 members, imported by
 * 33 of 47 features -- the single largest reason a feature could not leave the
 * shell. Every endpoint a module owns now lives in that module's feature
 * (`<feature>/<feature>-api.service.ts`), and this is what was left once they had
 * gone: authentication, delegated to core's `IdentityApiClient` because core owns
 * the session, and the manifest the shell loaded at start. Nothing here names a
 * module, and nothing a module needs is here.
 */
@Injectable({ providedIn: 'root' })
export class ShellApiService {
    private readonly identity = inject(IdentityApiClient);
    private readonly store = inject(Store);

    /** The API manifest `AppInitService.load()` fetched; throws before it did. */
    get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    login(identifier: string, password: string): Observable<TokenResponse> {
        return this.identity.login(identifier, password);
    }

    refresh(refreshToken: string): Observable<TokenResponse> {
        return this.identity.refresh(refreshToken);
    }

    logout(): Observable<void> {
        return this.identity.logout();
    }

    me(): Observable<UserDto> {
        return this.identity.me();
    }
}
