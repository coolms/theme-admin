import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';

/** How remote images in a message are treated: the installation's rule, always blocked, or always loaded. */
export type RemoteImages = 'inherit' | 'block' | 'allow';

/** A rule as the server resolved it: remote images blocked or loaded. */
export type RemoteImagesRule = 'block' | 'allow';

/** The person's own mail settings: the profile section `mail`. */
export interface MailPreferences {
    /** The mailbox the mail page opens on and new mail is sent from; null: none chosen. */
    readonly defaultMailboxId: string | null;
    readonly remoteImages: RemoteImages;
    /** Announce new mail as it arrives. */
    readonly notifyNewMail: boolean;
    /**
     * Read-only, the server's: the rule that applies to this person, `remoteImages` resolved against the
     * installation's. Blocked unless the server says "allow". Never sent on a save.
     */
    readonly remoteImagesEffective: RemoteImagesRule;
    /** Read-only, the server's: the installation's own rule, which `inherit` follows; null when not answered. */
    readonly remoteImagesInstallation: RemoteImagesRule | null;
}

/** The fields the server answers and never stores: a save leaves them out. */
export const MAIL_PREFERENCES_READ_ONLY: ReadonlyArray<keyof MailPreferences> = [
    'remoteImagesEffective',
    'remoteImagesInstallation',
];

/** The section as the server answers it for someone who never saved it. */
export const MAIL_PREFERENCE_DEFAULTS: MailPreferences = {
    defaultMailboxId: null,
    remoteImages: 'inherit',
    notifyNewMail: true,
    remoteImagesEffective: 'block',
    remoteImagesInstallation: null,
};

/** The section as read or saved, and the version it is at (the answer's ETag): what a save names. */
export interface MailPreferencesRead {
    readonly prefs: MailPreferences;
    readonly version: string | null;
}

/** A save refused because the section was saved since it was read (412), or because it was read with no version. */
export class MailPreferencesChangedError extends Error {
    constructor() {
        super('Your mail settings were saved somewhere else since they were read.');
        this.name = 'MailPreferencesChangedError';
    }
}

function versionOf(etag: string | null): string | null {
    const v = (etag ?? '').replace(/^W\//, '').replace(/"/g, '').trim();
    return v === '' ? null : v;
}

function prefsOf(body: unknown): MailPreferences {
    const b = (body ?? {}) as Partial<Record<keyof MailPreferences, unknown>>;
    const images = b.remoteImages;
    return {
        defaultMailboxId: typeof b.defaultMailboxId === 'string' && b.defaultMailboxId !== '' ? b.defaultMailboxId : null,
        remoteImages: images === 'block' || images === 'allow' ? images : 'inherit',
        notifyNewMail: typeof b.notifyNewMail === 'boolean' ? b.notifyNewMail : MAIL_PREFERENCE_DEFAULTS.notifyNewMail,
        // Anything but an explicit "allow" -- a missing value included -- is blocked.
        remoteImagesEffective: b.remoteImagesEffective === 'allow' ? 'allow' : 'block',
        remoteImagesInstallation: b.remoteImagesInstallation === 'allow' || b.remoteImagesInstallation === 'block'
            ? b.remoteImagesInstallation
            : null,
    };
}

/**
 * The profile section `mail` (`/auth/me/settings/mail`), read with its version and saved naming it.
 *
 * The read answers the section over its defaults with the section's version as the ETag; a save names that version
 * (If-Match) and is refused when the section was saved since (412), never when another section was. The server keeps
 * only what it may: a mailbox the person may not send from, or a value outside the choices, is not stored while the
 * rest of the save is -- the answer is what stood. `current` is the section as last read or saved, for the mail page.
 */
@Injectable({ providedIn: 'root' })
export class MailPreferencesService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    /** The section as last read or saved; the defaults until the first read lands. */
    readonly current = signal<MailPreferences>(MAIL_PREFERENCE_DEFAULTS);

    private get url(): string {
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        return `${base}/auth/me/settings/mail`;
    }

    /** The section and its version, from one read. */
    read(): Observable<MailPreferencesRead> {
        return this.http.get<unknown>(this.url, { observe: 'response', headers: new HttpHeaders({ Accept: 'application/json' }) })
            .pipe(
                map(r => ({ prefs: prefsOf(r.body), version: versionOf(r.headers.get('ETag')) })),
                tap(read => this.current.set(read.prefs)),
            );
    }

    /** The section for a reader that only needs it, never failing: the defaults when it cannot be read. */
    readOrDefaults(): Observable<MailPreferences> {
        return this.read().pipe(map(r => r.prefs), catchError(() => of(MAIL_PREFERENCE_DEFAULTS)));
    }

    /**
     * Saves the fields changed over the version they were read at; answers the section as it stood after the save,
     * and its new version. A section saved since is refused ({@link MailPreferencesChangedError}); one read without a
     * version is never saved over.
     */
    save(changes: Partial<MailPreferences>, version: string | null): Observable<MailPreferencesRead> {
        if (version === null) {
            return throwError(() => new MailPreferencesChangedError());
        }
        const body: Record<string, unknown> = { ...changes };
        for (const key of MAIL_PREFERENCES_READ_ONLY) {
            delete body[key];
        }
        return this.http.patch<unknown>(this.url, body, {
            observe: 'response',
            headers: new HttpHeaders({
                'Content-Type': 'application/merge-patch+json',
                Accept: 'application/json',
                'If-Match': `"${version}"`,
            }),
        }).pipe(
            map(r => ({ prefs: prefsOf(r.body), version: versionOf(r.headers.get('ETag')) })),
            tap(saved => this.current.set(saved.prefs)),
            catchError((err: unknown) => throwError(() =>
                err instanceof HttpErrorResponse && err.status === 412 ? new MailPreferencesChangedError() : err)),
        );
    }
}
