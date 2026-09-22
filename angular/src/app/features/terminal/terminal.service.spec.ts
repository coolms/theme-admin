import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { Store } from '@ngxs/store';
import { ShellApiService } from '../../api/shell-api.service';
import { TerminalService } from './terminal.service';
import { TerminalRefusedError } from './terminal.types';

/**
 * A refused execute request is a STATUS, decided before any stream, and it
 * says why: the problem detail is what the terminal prints and what the
 * elevation prompt shows. The service keeps it instead of flattening the
 * answer to `HTTP 403`.
 */
describe('TerminalService -- a refusal keeps its reason', () => {
    let service: TerminalService;
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TerminalService,
                { provide: Store, useValue: { selectSnapshot: () => ({ terminal: { executeUrl: '/api/v1/terminal/execute' } }) } },
                { provide: ShellApiService, useValue: {} },
            ],
        });
        service = TestBed.inject(TerminalService);
        fetchSpy = spyOn(globalThis, 'fetch');
    });

    function answer(status: number, body: string, type = 'application/problem+json'): Response {
        return new Response(body, { status, headers: { 'Content-Type': type } });
    }

    it('turns a 403 with a problem detail into a refusal carrying that detail', async () => {
        fetchSpy.and.resolveTo(answer(403, JSON.stringify({ detail: '"sudo" needs an elevated session: elevate, then run it again.', status: 403 })));

        const failure = await new Promise<unknown>(resolve => {
            service.execute('sudo pwd', '/').subscribe({ next: () => fail('no event was expected'), error: resolve });
        });

        expect(failure).toBeInstanceOf(TerminalRefusedError);
        const refused = failure as TerminalRefusedError;
        expect(refused.status).toBe(403);
        expect(refused.detail).toBe('"sudo" needs an elevated session: elevate, then run it again.');
        expect(refused.message).toBe(refused.detail);
    });

    it('falls back to the bare status when the body is not a problem document', async () => {
        fetchSpy.and.resolveTo(answer(500, 'not json', 'text/plain'));

        const failure = await new Promise<unknown>(resolve => {
            service.execute('pwd', '/').subscribe({ next: () => fail('no event was expected'), error: resolve });
        });

        expect(failure).toBeInstanceOf(TerminalRefusedError);
        expect((failure as TerminalRefusedError).detail).toBe('HTTP 500');
    });

    it('sends the line once per execute, with the stream accepted and the shell location aboard', async () => {
        fetchSpy.and.resolveTo(answer(403, JSON.stringify({ detail: 'no' })));

        await new Promise<unknown>(resolve => {
            service.execute('sudo pwd', '/docs').subscribe({ error: resolve });
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
        expect(url).toBe('/api/v1/terminal/execute');
        expect((init.headers as Record<string, string>)['Accept']).toBe('text/event-stream');
        expect(JSON.parse(init.body as string)).toEqual({ input: 'sudo pwd', cwd: '/docs' });
    });
});

/**
 * A path argument is completed against the WORKING DIRECTORY, which only the
 * client knows: the shell's place is client-held state, and a completion
 * request that did not carry it would ask the server about the root from
 * wherever the person stands.
 */
describe('TerminalService -- completion carries the shell location', () => {
    let service: TerminalService;
    let posted: { url: string; body: unknown } | null;

    beforeEach(() => {
        posted = null;
        TestBed.configureTestingModule({
            providers: [
                TerminalService,
                { provide: Store, useValue: { selectSnapshot: () => ({ terminal: { completeUrl: '/api/v1/terminal/complete' } }) } },
                { provide: ShellApiService, useValue: {} },
                {
                    provide: HttpClient,
                    useValue: {
                        post: (url: string, body: unknown) => {
                            posted = { url, body };
                            return of({ suggestions: ['default/'] });
                        },
                    },
                },
            ],
        });
        service = TestBed.inject(TerminalService);
    });

    it('sends the working directory and the home directory with the line', async () => {
        const suggestions = await firstValueFrom(service.complete('cat def', 7, '/content', '/home/ada'));

        expect(posted).not.toBeNull();
        expect(posted!.url).toBe('/api/v1/terminal/complete');
        expect(posted!.body).toEqual({ input: 'cat def', cursorPos: 7, cwd: '/content', home: '/home/ada' });
        expect(suggestions).toEqual(['default/']);
    });

    it('falls back to the root when the caller names no place', async () => {
        await firstValueFrom(service.complete('ls', 2));

        expect(posted!.body).toEqual({ input: 'ls', cursorPos: 2, cwd: '/', home: '/' });
    });
});
