import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { catchError, firstValueFrom, map, Observable, of } from 'rxjs';
import { AppConfigState, AuthState, Logout, SetTokens } from '@coolms/core-angular';
import { ShellApiService } from '../../api/shell-api.service';
import { TerminalCompletions, TerminalCompleteResponse, TerminalExecuteEvent, TerminalRefusedError } from './terminal.types';

@Injectable({ providedIn: 'root' })
export class TerminalService {
    private readonly store = inject(Store);
    private readonly http  = inject(HttpClient);
    private readonly api   = inject(ShellApiService);
    private controller: AbortController | null = null;

    /**
     * Execute a command via SSE streaming.
     * Returns Observable that emits events as they arrive.
     *
     * On a 401 the service attempts one token refresh then retries.
     * If the refresh also fails the user is logged out.
     */
    /**
     * @param cwd the shell's working directory. The terminal is
     *            stateless server-side, so the location travels with each
     *            command -- which is also why two tabs behave as two shells.
     */
    execute(input: string, cwd = '/'): Observable<TerminalExecuteEvent> {
        this.controller?.abort();
        this.controller = new AbortController();

        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url      = manifest?.terminal?.executeUrl ?? '';

        return new Observable<TerminalExecuteEvent>(subscriber => {
            this.fetchStream(url, input, cwd, this.controller!.signal)
                .then(async res => {
                    // On 401: try one token refresh then retry
                    if (res.status === 401) {
                        const refreshed = await this.tryRefresh();
                        if (!refreshed) {
                            subscriber.error(new Error('HTTP 401'));
                            return;
                        }
                        // Abort the previous signal (already responded) and open a fresh one
                        this.controller = new AbortController();
                        res = await this.fetchStream(url, input, cwd, this.controller.signal);
                    }

                    if (!res.ok || !res.body) {
                        // A refusal is decided before the stream opens, and it says
                        // why: the problem detail is the line the terminal prints and
                        // the reason the elevation prompt shows.
                        subscriber.error(new TerminalRefusedError(res.status, await this.detailOf(res)));
                        return;
                    }

                    await this.readStream(res.body, subscriber);
                })
                .catch(err => {
                    if ((err as Error).name !== 'AbortError') {
                        subscriber.error(err);
                    } else {
                        subscriber.complete();
                    }
                });

            return () => this.controller?.abort();
        });
    }

    private fetchStream(url: string, input: string, cwd: string, signal: AbortSignal): Promise<Response> {
        const token = this.store.selectSnapshot(AuthState.accessToken) ?? '';
        return fetch(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept':        'text/event-stream',
            },
            body:   JSON.stringify({ input, cwd }),
            signal,
        });
    }

    /** The problem detail of a refused request, or the bare status when the body has none. */
    private async detailOf(res: Response): Promise<string> {
        try {
            const body = await res.json() as { detail?: unknown };
            if (typeof body.detail === 'string' && body.detail !== '') return body.detail;
        } catch { /* not a problem document */ }
        return `HTTP ${res.status}`;
    }

    /** Attempt a token refresh. Returns true and updates the store on success. */
    private async tryRefresh(): Promise<boolean> {
        const refreshToken = this.store.selectSnapshot(AuthState.refreshToken);
        if (!refreshToken) {
            this.store.dispatch(new Logout());
            return false;
        }
        try {
            const tokens = await firstValueFrom(this.api.refresh(refreshToken));
            this.store.dispatch(new SetTokens(tokens));
            return true;
        } catch {
            this.store.dispatch(new Logout());
            return false;
        }
    }

    private async readStream(
        body: ReadableStream<Uint8Array>,
        subscriber: { next: (v: TerminalExecuteEvent) => void; complete: () => void },
    ): Promise<void> {
        const reader  = body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6)) as TerminalExecuteEvent;
                    subscriber.next(data);
                    if (data.done) {
                        subscriber.complete();
                        return;
                    }
                } catch { /* skip malformed */ }
            }
        }
        subscriber.complete();
    }

    /**
     * Request tab completion suggestions.
     *
     * `cwd` and `home` travel with the question exactly as they do with a run:
     * a path argument is completed against the working directory, and without
     * them the server would answer about the root from wherever we stand.
     */
    complete(input: string, cursorPos: number, cwd = '/', home = '/'): Observable<TerminalCompletions> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url       = manifest?.terminal?.completeUrl ?? '';

        return this.http.post<TerminalCompleteResponse>(url, { input, cursorPos, cwd, home }).pipe(
            map(r => {
                const suggestions = r.suggestions ?? [];

                // An older server sends no `total`; then what arrived IS the
                // total, and nothing claims to be capped.
                return { suggestions, total: r.total ?? suggestions.length };
            }),
            catchError(() => of({ suggestions: [], total: 0 })),
        );
    }

    abort(): void {
        this.controller?.abort();
        this.controller = null;
    }
}
