import { HttpClient, HttpContext, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { EMPTY, Observable, Subject, catchError, concatMap, debounceTime, map, of, switchMap } from 'rxjs';
import { AppConfigState, BACKGROUND_REQUEST } from '@coolms/core-angular';

/** The person settings section that keeps Chat's last conversation. */
export const LAST_OPENED_SECTION = 'chat';

/** The key in it: the last conversation's id, null once the person may no longer read it. */
export const LAST_OPENED_KEY = 'lastConversationId';

/** How long the last opened conversation waits before it is saved: a quick run of switches saves once. */
export const LAST_OPENED_DEBOUNCE_MS = 1000;

/** Read and saved on the way, not a step the person waits on: a failure opens no dialog. */
const quietly = (): HttpContext => new HttpContext().set(BACKGROUND_REQUEST, true);

/** The last conversation's id in a read of the section, or null where none is stored. */
export function lastOpenedChat(body: unknown): string | null {
    const value = (body as Record<string, unknown> | null | undefined)?.[LAST_OPENED_KEY];
    return typeof value === 'string' && value !== '' ? value : null;
}

/** One read of the section: the last conversation's id, and the ETag as the server sent it (null without one). */
interface SectionRead {
    readonly id: string | null;
    readonly etag: string | null;
}

/**
 * The conversation the person last opened in Chat, kept once per person in their settings section `chat`
 * (`/auth/me/settings/chat`, key `lastConversationId`): read with the section's ETag, saved a second after the last of
 * a quick run of opens, only that key, naming the ETag read (If-Match). A section saved since (412) is read again and
 * the save tried once more; a refusal (422, a conversation the person does not take part in) is dropped. A section
 * not served (404) is none stored; any failure is no conversation and no notice.
 */
@Injectable({ providedIn: 'root' })
export class ChatLastOpenedService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly opens = new Subject<string>();

    constructor() {
        this.opens.pipe(
            debounceTime(LAST_OPENED_DEBOUNCE_MS),
            concatMap(id => this.save(id, true)),
        ).subscribe();
    }

    private get url(): string {
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        return `${base}/auth/me/settings/${LAST_OPENED_SECTION}`;
    }

    /** The last conversation's id, or null: none stored, the section not served, or the read failed. */
    read(): Observable<string | null> {
        return this.readSection().pipe(
            map(read => read.id),
            catchError(() => of(null)),
        );
    }

    /** This conversation was opened: saved once the opens settle. */
    remember(conversationId: string): void {
        this.opens.next(conversationId);
    }

    private readSection(): Observable<SectionRead> {
        return this.http.get<unknown>(this.url, {
            observe: 'response',
            headers: new HttpHeaders({ Accept: 'application/json' }),
            context: quietly(),
        }).pipe(map(r => ({ id: lastOpenedChat(r.body), etag: r.headers.get('ETag') })));
    }

    /** Reads the section's ETag, then saves the one key naming it; a 412 reads and tries once more when allowed. */
    private save(conversationId: string, mayRetry: boolean): Observable<unknown> {
        return this.readSection().pipe(
            switchMap(read => read.etag === null || read.etag === ''
                ? EMPTY
                : this.http.patch<unknown>(this.url, { [LAST_OPENED_KEY]: conversationId }, {
                    headers: new HttpHeaders({
                        'Content-Type': 'application/merge-patch+json',
                        Accept: 'application/json',
                        'If-Match': read.etag,
                    }),
                    context: quietly(),
                })),
            catchError((err: unknown) => (mayRetry && err instanceof HttpErrorResponse && err.status === 412
                ? this.save(conversationId, false)
                : EMPTY)),
        );
    }
}
