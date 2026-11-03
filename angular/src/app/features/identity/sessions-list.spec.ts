import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthState, ELEVATION_REQUIRED_PROBLEM_TYPE, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, PageTitleService, RELOAD_PAGE, ToastService } from '@coolms/ui-angular';
import { SessionsListComponent } from './sessions-list.component';
import { IdentityApiService } from './identity-api.service';
import { type ActiveSessionDto } from './identity.types';

/**
 * The signed-in sessions page. The list is people's data, read in an elevated session only: refused for want of
 * elevation, the Elevate state stands in place of it, never a toast. A row is keyed by its session and names its
 * person. Ending one sign-in sends that session's id; ending all of a person's sends the person's id; each only after
 * the confirmation, and the list reloads on success. The page is built directly, not rendered.
 */
describe('SessionsListComponent', () => {
    const FIRST = { offset: 0, sort: null, reset: true, columnFilters: [] as string[] };
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });
    const ROW: ActiveSessionDto = {
        sessionId: 's-1',
        person:    { id: 'p-1', primaryIdentifier: 'ann@example.test', displayName: null },
        audience:  'admin',
        startedAt: '2026-11-03T05:00:00+00:00',
    };

    let answers: Array<() => Observable<{ members: ActiveSessionDto[]; total: number }>>;
    let asked: Array<Record<string, unknown>>;
    let ended: string[];
    let endedAll: string[];
    let confirmed: boolean;
    let asking: string[];
    let me: string;
    let toasts: string[];
    let reloaded: number;

    function build(withShell = false): SessionsListComponent {
        asked = [];
        ended = [];
        endedAll = [];
        toasts = [];
        reloaded = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (s: unknown) => (s === AuthState.currentUser ? { id: me } : { apiBase: '/api/v1' }),
                    },
                },
                {
                    provide: ConfirmDialogService,
                    useValue: { open: (o: { message: string }) => { asking.push(o.message); return of(confirmed); } },
                },
                {
                    provide: ToastService,
                    useValue: { error: (m: string) => toasts.push('error: ' + m), success: (m: string) => toasts.push(m) },
                },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
                {
                    provide: IdentityApiService,
                    useValue: {
                        listSessions: (p: Record<string, unknown>) => {
                            asked.push(p);
                            return answers[Math.min(asked.length - 1, answers.length - 1)]();
                        },
                        endSession: (id: string) => { ended.push(id); return of(undefined); },
                        endAllSessions: (id: string) => { endedAll.push(id); return of(undefined); },
                    },
                },
                ...(withShell ? [{ provide: RELOAD_PAGE, useValue: () => { reloaded++; } }] : []),
            ],
        });

        return TestBed.runInInjectionContext(() => new SessionsListComponent());
    }

    beforeEach(() => {
        confirmed = true;
        asking = [];
        me = 'p-admin';
        answers = [() => of({ members: [ROW], total: 1 })];
    });

    it('shows the Elevate state in place of the list, not a toast', () => {
        answers = [() => throwError(stamped)];
        const page = build();
        page.onLoadMore(FIRST);

        expect(page.elevationRequired()).toBeTrue();
        expect(toasts).toEqual([]);
    });

    it('reads the list again after Elevate, and shows it', () => {
        answers = [() => throwError(stamped), () => of({ members: [ROW], total: 1 })];
        const page = build();
        page.onLoadMore(FIRST);

        page.loadAgain();

        expect(asked.length).toBe(2);
        expect(page.elevationRequired()).toBeFalse();
        expect(page.rows()).toEqual([ROW]);
    });

    it('makes the page anew after Elevate where the shell provides that', () => {
        answers = [() => throwError(stamped)];
        const page = build(true);
        page.onLoadMore(FIRST);

        page.loadAgain();

        expect(reloaded).toBe(1);
        expect(asked.length).toBe(1);
    });

    it('shows any other failure as a toast', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 }))];
        const page = build();
        page.onLoadMore(FIRST);

        expect(page.elevationRequired()).toBeFalse();
        expect(toasts).toEqual(['error: failed']);
    });

    it('keys each row by its session and names its person', () => {
        const page = build();
        page.onLoadMore(FIRST);

        const item = page.gridData().items[0];
        expect(item['id']).toBe('s-1');
        expect(item['person']).toBe('ann@example.test');
        expect(page.footerLabel()).toBe('1 session');
    });

    it('asks for the next page by its number, thirty at a time', () => {
        answers = [() => of({ members: [ROW], total: 45 })];
        const page = build();
        page.onLoadMore(FIRST);
        page.onLoadMore({ ...FIRST, reset: false, offset: 30 });

        expect(asked).toEqual([{ page: 1, itemsPerPage: 30 }, { page: 2, itemsPerPage: 30 }]);
        expect(page.footerLabel()).toBe('2 of 45 sessions');
        expect(page.hasMore()).toBeTrue();
    });

    it('ends the selected sign-in by its session id, after the confirmation', () => {
        const page = build();
        page.onLoadMore(FIRST);
        page.onRowSelected({ id: 's-1' });

        page.onToolbarAction('end-session');

        expect(ended).toEqual(['s-1']);
        expect(endedAll).toEqual([]);
        expect(toasts).toEqual(['Sign-in ended']);
    });

    it('ends every sign-in of the selected row\'s person by the person\'s id', () => {
        const page = build();
        page.onLoadMore(FIRST);
        page.onRowSelected({ id: 's-1' });

        page.onToolbarAction('end-all-sessions');

        expect(endedAll).toEqual(['p-1']);
        expect(ended).toEqual([]);
    });

    it('drops a page asked before a reset, so a row just ended does not come back', () => {
        const late = new Subject<{ members: ActiveSessionDto[]; total: number }>();
        const fresh = new Subject<{ members: ActiveSessionDto[]; total: number }>();
        answers = [() => of({ members: [ROW], total: 45 }), () => late, () => fresh];
        const page = build();
        page.onLoadMore(FIRST);
        page.onLoadMore({ ...FIRST, reset: false, offset: 30 });
        page.onLoadMore(FIRST);

        fresh.next({ members: [], total: 0 });
        late.next({ members: [ROW], total: 45 });

        expect(page.rows()).toEqual([]);
        expect(page.total()).toBe(0);
    });

    it('drops a refusal of a page asked before a reset, so it does not cover the list since loaded', () => {
        const late = new Subject<{ members: ActiveSessionDto[]; total: number }>();
        answers = [() => of({ members: [ROW], total: 45 }), () => late, () => of({ members: [ROW], total: 1 })];
        const page = build();
        page.onLoadMore(FIRST);
        page.onLoadMore({ ...FIRST, reset: false, offset: 30 });
        page.onLoadMore(FIRST);

        late.error(stamped());

        expect(page.elevationRequired()).toBeFalse();
        expect(page.rows()).toEqual([ROW]);
        expect(toasts).toEqual([]);
    });

    it('says so when the sign-ins being ended are the administrator\'s own, and only then', () => {
        const page = build();
        page.onLoadMore(FIRST);
        // An ending that succeeds clears the selection, so the row is chosen again before each.
        page.onRowSelected({ id: 's-1' });
        page.onToolbarAction('end-session');
        me = 'p-1';
        page.onRowSelected({ id: 's-1' });
        page.onToolbarAction('end-session');
        page.onRowSelected({ id: 's-1' });
        page.onToolbarAction('end-all-sessions');

        const own = asking.map(m => m.includes('your own sign-ins'));
        expect(own).toEqual([false, true, true]);
    });

    it('ends nothing when the confirmation is declined, or no row is selected', () => {
        const page = build();
        page.onLoadMore(FIRST);
        page.onToolbarAction('end-session');
        confirmed = false;
        page.onRowSelected({ id: 's-1' });
        page.onToolbarAction('end-session');
        page.onToolbarAction('end-all-sessions');

        expect(ended).toEqual([]);
        expect(endedAll).toEqual([]);
    });
});

/** The three addresses come from the manifest, and the list sends only the parameters it was given. */
describe('IdentityApiService signed-in sessions', () => {
    let api: IdentityApiService;
    let http: HttpTestingController;

    const manifest = {
        identity: {
            sessionsUrl:     '/api/v1/auth/sessions',
            sessionUrl:      '/api/v1/auth/sessions/{sessionId}',
            userSessionsUrl: '/api/v1/auth/users/{id}/sessions',
        },
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [IdentityApiService, { provide: Store, useValue: { selectSnapshot: () => manifest } }],
        });
        api = TestBed.inject(IdentityApiService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('says the page exists only when all three addresses are sent', () => {
        expect(api.hasSessionsPage).toBeTrue();
    });

    it('lists with the page and its size, and reads the members and the total', () => {
        let got: unknown;
        api.listSessions({ page: 2, itemsPerPage: 30 }).subscribe(r => (got = r));

        const req = http.expectOne(r => r.url === '/api/v1/auth/sessions');
        expect(req.request.params.get('page')).toBe('2');
        expect(req.request.params.get('itemsPerPage')).toBe('30');
        expect(req.request.params.has('personId')).toBeFalse();
        req.flush({ member: [{ sessionId: 's-1' }], totalItems: 1 });
        expect(got).toEqual({ members: [{ sessionId: 's-1' } as ActiveSessionDto], total: 1 });
    });

    it('ends one sign-in at its own address', () => {
        api.endSession('s 1').subscribe();

        const req = http.expectOne('/api/v1/auth/sessions/s%201');
        expect(req.request.method).toBe('DELETE');
        req.flush(null);
    });

    it('ends every sign-in of an account at the account\'s address', () => {
        api.endAllSessions('p-1').subscribe();

        const req = http.expectOne('/api/v1/auth/users/p-1/sessions');
        expect(req.request.method).toBe('DELETE');
        req.flush(null);
    });
});
