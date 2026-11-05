import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AppConfigState } from '@coolms/core-angular';
import { Store } from '@ngxs/store';
import { type Observable } from 'rxjs';

/** One setting as the server declares it for this person. */
export interface DeclaredKey {
    readonly key: string;
    readonly type: string;
    readonly default: unknown;
    readonly label: string;
    readonly min: number | null;
    readonly max: number | null;
    readonly choices: ReadonlyArray<string> | null;
    readonly nullable: boolean;
    readonly readOnly: boolean;
    /** The value in force. */
    readonly value: unknown;
    /** The person's own, kept while locked; null when they have none. */
    readonly own: unknown;
    readonly locked: boolean;
}

export interface DeclaredSection {
    readonly section: string;
    readonly label: string;
    readonly icon: string;
    readonly version: string;
    readonly keys: ReadonlyArray<DeclaredKey>;
}

/** The declared settings a host renders: the shared sections and the console's, read and saved by section. */
@Injectable({ providedIn: 'root' })
export class DeclaredSettingsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get base(): string {
        const api = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        return `${api}/auth/me/settings`;
    }

    read(): Observable<ReadonlyArray<DeclaredSection>> {
        return this.http.get<ReadonlyArray<DeclaredSection>>(`${this.base}/declared?host=console`, {
            headers: new HttpHeaders({ Accept: 'application/json' }),
        });
    }

    /** Saves the keys given over the version read. A null removes the person's own, so the default applies. */
    save(section: string, changes: Readonly<Record<string, unknown>>, version: string): Observable<unknown> {
        return this.http.patch<unknown>(`${this.base}/${section}`, changes, {
            headers: new HttpHeaders({
                'Content-Type': 'application/merge-patch+json',
                Accept: 'application/json',
                'If-Match': `"${version}"`,
            }),
        });
    }
}
