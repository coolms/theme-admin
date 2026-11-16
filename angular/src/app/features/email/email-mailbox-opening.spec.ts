import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, Observable, Subject, of } from 'rxjs';
import { AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto, type EmailMessageList, type ServerMessageOpenedDto,
    type ServerSearchHitDto,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { openFailureOf, openingHeader, serverNeighbours, storedNeighbours } from './message-opening';

const FOLDER = 'INBOX';

const stored = (id: string, subject: string, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromName: `Sender ${id}`, fromAddress: `${id}@example.test`,
    sentAt: '2026-11-14T09:30:00+00:00', seen: false, flagged: false, fromServer: false, ref: null, ...extra,
});

const server = (ref: string, subject: string): EmailMessageDto => ({
    mailboxId: 'mb1', folder: FOLDER, uid: 7, subject, fromName: 'Far Away', fromAddress: 'far@example.test',
    sentAt: '2026-11-13T08:00:00+00:00', seen: false, flagged: false, fromServer: true, ref,
}) as unknown as EmailMessageDto;

const page = (rows: EmailMessageDto[]): EmailMessageList => Object.assign([...rows], { next: null, serverPages: null });

/** One request the page made: its answer, and whether it was aborted (unsubscribed) before answering. */
interface Asked<T> {
    readonly id: string;
    readonly reply: Subject<T>;
    aborted: boolean;
}

/** A request the test answers by hand, which records an unsubscribe before its answer as an abort. */
function held<T>(id: string, into: Asked<T>[]): Observable<T> {
    return new Observable<T>(subscriber => {
        const asked: Asked<T> = { id, reply: new Subject<T>(), aborted: false };
        into.push(asked);
        let answered = false;
        const inner = asked.reply.subscribe({
            next: v => {
                answered = true;
                subscriber.next(v);
                subscriber.complete();
            },
            error: e => {
                answered = true;
                subscriber.error(e);
            },
        });

        return () => {
            if (!answered) {
                asked.aborted = true;
            }
            inner.unsubscribe();
        };
    });
}

/**
 * Opening a message never waits on its body: the pane opens at once with the row's subject, sender and date and the
 * loading line where the body goes; nothing is disabled; another choice, Back or leaving the folder or the mailbox
 * aborts the pending load, whose answer is never shown; a failed load says why in the pane, with Try again; the one 404
 * takes the row out; a message is marked read only once it has loaded.
 */
describe('EmailMailboxPageComponent -- opening a message never waits on its body', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let lists: Array<Subject<EmailMessageList>>;
    let details: Asked<EmailMessageDetailDto>[];
    let stores: Asked<ServerMessageOpenedDto>[];
    let seenAsked: string[];
    let toasts: string[];
    let prefetched: string[][];
    let detailPrefetch: string[][];

    beforeEach(() => {
        lists = [];
        details = [];
        stores = [];
        seenAsked = [];
        toasts = [];
        prefetched = [];
        detailPrefetch = [];
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto, { id: 'mb2', label: 'Home' } as EmailMailboxDto]),
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: (): Observable<EmailMessageList> => {
                            const answer = new Subject<EmailMessageList>();
                            lists.push(answer);
                            return answer;
                        },
                        openServerMessage: (_id: string, hit: ServerSearchHitDto, prefetch: readonly string[] = []) => {
                            prefetched.push([...prefetch]);
                            return held(hit.ref, stores);
                        },
                        olderMessages: () => NEVER,
                        getMessage: (id: string, prefetch: readonly string[] = []) => {
                            detailPrefetch.push([...prefetch]);
                            return held(id, details);
                        },
                        listThread: () => of([]),
                        markSeen: (id: string) => {
                            seenAsked.push(id);
                            return of({ ids: [id] });
                        },
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (t: string): void => { toasts.push(t); }, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' } : null) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: (v: unknown) => String(v ?? ''), date: () => '', time: () => '', dateTime: (v: unknown) => String(v ?? '') } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {} } },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.style.height = '400px';
        region.style.flex = 'none';
        fixture.componentInstance.selectFolder(FOLDER);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const pageOf = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const draw = (): void => {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            tick(20);
        }
        fixture.detectChanges();
    };
    const rows = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[data-test="list-scroll"] .mbx__row'));
    const rowOf = (subject: string): HTMLElement =>
        rows().find(r => r.querySelector('.mbx__row-subject')?.textContent?.trim() === subject)!;
    const choose = (subject: string): void => {
        rowOf(subject).querySelector<HTMLElement>('.mbx__row-main')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        draw();
    };
    const pane = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-scroll"]')!;
    const paneText = (): string => (pane().textContent ?? '').replace(/\s+/g, ' ').trim();
    const list = (rowsShown: EmailMessageDto[]): void => {
        lists[lists.length - 1].next(page(rowsShown));
        draw();
    };
    const detail = (m: EmailMessageDto, body: string): EmailMessageDetailDto =>
        ({ ...m, bodyHtml: null, bodyText: body, hasAttachments: false } as unknown as EmailMessageDetailDto);
    const ROWS = [stored('m1', 'First'), stored('m2', 'Second'), server('r-3', 'Third')];

    it('the pane opens at once with the row\'s subject, sender and date and Loading message..., nothing disabled', fakeAsync(() => {
        list(ROWS);
        choose('First');

        expect(details.map(d => d.id)).toEqual(['m1']);
        const loading = pane().querySelector('[data-test="message-loading"]');
        expect(loading?.textContent?.trim()).toBe('Loading message…');
        expect(loading?.getAttribute('role')).toBe('status');
        const head = pane().querySelector('[data-test="opening-head"]')!;
        expect(head.querySelector('.mbx__detail-subject')?.textContent?.trim()).toBe('First');
        expect(head.textContent).toContain('Sender m1 · m1@example.test');
        expect(head.textContent).toContain('2026-11-14T09:30:00+00:00');
        expect(el().querySelectorAll('button:disabled, input:disabled').length).withContext('no control is disabled while it loads').toBe(0);
        expect(seenAsked).withContext('not read before it has loaded').toEqual([]);

        details[0].reply.next(detail(ROWS[0], 'The body of the first'));
        draw();

        expect(pane().querySelector('[data-test="message-loading"]')).toBeNull();
        expect(paneText()).toContain('The body of the first');
        expect(seenAsked).toEqual(['m1']);
    }));

    it('choosing another message aborts the pending load and switches at once; the first never shows', fakeAsync(() => {
        list(ROWS);
        choose('First');
        choose('Second');

        expect(details.map(d => [d.id, d.aborted])).toEqual([['m1', true], ['m2', false]]);
        expect(pane().querySelector('.mbx__detail-subject')?.textContent?.trim()).toBe('Second');

        details[1].reply.next(detail(ROWS[1], 'The body of the second'));
        draw();
        expect(pageOf().selectedMessage()?.id).toBe('m2');
        expect(seenAsked).withContext('the message left before it loaded stays unread').toEqual(['m2']);
    }));

    it('a server row opens the pane at once while it is stored, and a row chosen after it is never overridden', fakeAsync(() => {
        list(ROWS);
        choose('Third');

        expect(stores.map(s => s.id)).toEqual(['r-3']);
        expect(prefetched).withContext('the server row before or after it, only server rows').toEqual([[]]);
        expect(pane().querySelector('.mbx__detail-subject')?.textContent?.trim()).toBe('Third');
        expect(pane().textContent).toContain('Far Away · far@example.test');
        expect(pane().querySelector('[data-test="message-loading"]')).not.toBeNull();

        choose('First');
        expect(stores[0].aborted).withContext('the store is aborted').toBeTrue();
        details[0].reply.next(detail(ROWS[0], 'The body of the first'));
        draw();
        expect(pageOf().selectedMessage()?.id).toBe('m1');
        expect(details.map(d => d.id)).withContext('the stored message is never opened over the later choice').toEqual(['m1']);
    }));

    it('Back and leaving the folder or the mailbox abort the pending load', fakeAsync(() => {
        list(ROWS);
        choose('First');
        pageOf().closeMessage();
        draw();
        expect(details[0].aborted).toBeTrue();
        expect(pane().querySelector('[data-test="message-loading"]')).toBeNull();

        choose('Second');
        pageOf().selectFolder('Archive');
        draw();
        expect(details[1].aborted).withContext('leaving the folder').toBeTrue();
        expect(pane().querySelector('[data-test="message-loading"]')).toBeNull();

        list(ROWS);
        choose('First');
        pageOf().selectMailbox('mb2');
        draw();
        expect(details[2].aborted).withContext('leaving the mailbox').toBeTrue();
        expect(pageOf().selectedMessage()).toBeNull();
    }));

    it('a failed load says why in the pane, never only in a notice, and Try again loads it again', fakeAsync(() => {
        list(ROWS);
        choose('First');
        details[0].reply.error(new HttpErrorResponse({ status: 502, error: { type: '/errors/email/body-unavailable' } }));
        draw();

        const failed = pane().querySelector('[data-test="open-failed"]')!;
        expect(failed.getAttribute('role')).toBe('alert');
        expect(failed.textContent).withContext('a fault: the generic sentence').toContain('Something went wrong. Try again.');
        expect(pane().querySelector('.mbx__detail-subject')?.textContent?.trim()).withContext('the header stays').toBe('First');
        expect(toasts).toEqual([]);
        expect(seenAsked).toEqual([]);

        pane().querySelector<HTMLElement>('[data-test="open-retry"]')!.click();
        draw();
        expect(details.map(d => d.id)).toEqual(['m1', 'm1']);
        expect(pane().querySelector('[data-test="message-loading"]')).not.toBeNull();
        details[1].reply.next(detail(ROWS[0], 'At last'));
        draw();
        expect(paneText()).toContain('At last');
    }));

    it('the one 404 says the message is no longer here and takes its row out, with no Try again', fakeAsync(() => {
        list(ROWS);
        choose('Second');
        details[0].reply.error(new HttpErrorResponse({ status: 404, error: { type: '/errors/not-found', detail: 'This message is not there any more.' } }));
        draw();

        expect(pane().querySelector('[data-test="open-failed"]')?.textContent).toContain('This message is not there any more.');
        expect(pane().querySelector('[data-test="open-retry"]')).toBeNull();
        expect(rowOf('Second')).toBeUndefined();
        expect(rowOf('First')).toBeDefined();
    }));

    it('a server row\'s open names the server rows just before and after it for the server to store', fakeAsync(() => {
        list([server('r-1', 'One'), server('r-2', 'Two'), stored('m3', 'Three'), server('r-4', 'Four'), server('r-5', 'Five')]);
        choose('Two');
        choose('Four');
        expect(prefetched).toEqual([['r-1'], ['r-5']]);
        choose('Five');
        expect(prefetched.at(-1)).toEqual(['r-4']);
    }));

    it('a stored row\'s open names the stored rows just above and below it for their bodies', fakeAsync(() => {
        list(ROWS);
        choose('First');
        choose('Second');
        expect(detailPrefetch).withContext('the server row below Second is not named').toEqual([['m2'], ['m1']]);
    }));

    describe('the words', () => {
        it('the header from the row: name and address, either alone, nothing', () => {
            expect(openingHeader({ subject: ' Hi ', fromName: 'Ann', fromAddress: 'a@x.test', sentAt: 'd' }))
                .toEqual({ subject: 'Hi', from: 'Ann · a@x.test', sentAt: 'd' });
            expect(openingHeader({ fromAddress: 'a@x.test' }).from).toBe('a@x.test');
            expect(openingHeader({ fromName: 'Ann' }).from).toBe('Ann');
            expect(openingHeader({})).toEqual({ subject: '', from: '', sentAt: null });
        });

        it('the neighbours: server rows only, before and after, none for a ref not listed', () => {
            const rows = [{ fromServer: true, ref: 'a' }, { fromServer: true, ref: 'b' }, { fromServer: true, ref: 'c' }, { fromServer: false, ref: null }];
            expect(serverNeighbours(rows, 'b')).toEqual(['a', 'c']);
            expect(serverNeighbours(rows, 'c')).toEqual(['b']);
            expect(serverNeighbours(rows, 'a')).toEqual(['b']);
            expect(serverNeighbours(rows, 'x')).toEqual([]);
        });

        it('stored neighbours: stored rows only, above and below', () => {
            const rows = [{ fromServer: false, id: 'a' }, { fromServer: true, ref: 'r' } as { fromServer: boolean; id?: string }, { fromServer: false, id: 'b' }, { fromServer: false, id: 'c' }];
            expect(storedNeighbours(rows, 'b')).toEqual(['c']);
            expect(storedNeighbours(rows, 'a')).toEqual([]);
            expect(storedNeighbours(rows, 'c')).toEqual(['b']);
            expect(storedNeighbours(rows, 'x')).toEqual([]);
        });

        it('the server\'s detail for a refusal, the generic sentence for a fault; the one 404 is gone', () => {
            expect(openFailureOf(new HttpErrorResponse({ status: 404, error: { detail: 'Said by the server.' } }))).toEqual({ text: 'Said by the server.', gone: true });
            expect(openFailureOf(new HttpErrorResponse({ status: 404 }))).toEqual({ text: 'Not available right now', gone: true });
            expect(openFailureOf(new HttpErrorResponse({ status: 0 })).text).toBe('Something went wrong. Try again.');
            expect(openFailureOf(new HttpErrorResponse({ status: 502, error: JSON.stringify({ type: '/errors/email/body-unavailable', detail: 'internals' }) })).text)
                .toBe('Something went wrong. Try again.');
            expect(openFailureOf(new Error('x'))).toEqual({ text: 'Something went wrong. Try again.', gone: false });
        });
    });
});
