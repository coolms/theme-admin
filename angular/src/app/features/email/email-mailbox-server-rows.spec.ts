import { type ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, Subject, of } from 'rxjs';
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
    type EmailFolderTreeNodeDto, type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto, type EmailMessageList,
    type ServerMessageOpenedDto,
    type ServerSearchHitDto,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { folderListedFromServer, listedFromServer } from './mail-server-rows';

const FOLDER = 'NPM';

/** A row the folder stores: an id, fromServer false. */
const stored = (id: string, subject: string, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null, ...extra,
});

/** A row only the mail server lists: fromServer, a ref, and no id key at all -- as the server answers it. */
const server = (ref: string, subject: string, extra: Record<string, unknown> = {}): EmailMessageDto => ({
    mailboxId: 'mb1', folder: FOLDER, uid: 7, subject, fromAddress: 'b@example.test', seen: false, flagged: false,
    fromServer: true, ref, ...extra,
}) as unknown as EmailMessageDto;

/** One answer of the list, with the headers it came with. */
const page = (rows: EmailMessageDto[], next: string | null = null, serverPages: string | null = null): EmailMessageList =>
    Object.assign([...rows], { next, serverPages });

const problem = (status: number, reason: string, retryAfter?: string): HttpErrorResponse => new HttpErrorResponse({
    status,
    error: { type: `/errors/email/server-search/${reason}` },
    headers: retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
});

/** The mixed first page, in the server's order: newest first, stored and server rows as they came. */
const MIXED = [
    server('r-9', 'Package published'),
    stored('m-8', 'Weekly digest'),
    server('r-7', 'Security advisory'),
    stored('m-6', 'Token created'),
];

/**
 * A folder the platform has not fully synced is listed from the mail server: rows only the server lists (fromServer,
 * a ref, no id) sit beside the stored ones in the server's order, keyed by their ref; they offer Open only; the list
 * pages by the X-Next-Cursor header; a stale cursor starts again, an unreachable server or a rate limit is said at the
 * list's end; a realtime change reads the first page only; and no Older section is offered, in any folder.
 */
describe('EmailMailboxPageComponent -- server rows in a folder not fully synced', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let asked: Array<{ folder: string; page: number; cursor: string | null }>;
    let answers: Array<Subject<EmailMessageList>>;
    let opens: Array<{ ref: string; reply: Subject<ServerMessageOpenedDto> }>;
    let detailsAsked: string[];
    let seenAsked: Array<{ id: string; seen: boolean }>;
    let menus: number;
    let olderAsked: number;
    let live: Subject<unknown>;

    beforeEach(() => {
        asked = [];
        answers = [];
        opens = [];
        detailsAsked = [];
        seenAsked = [];
        menus = 0;
        olderAsked = 0;
        live = new Subject<unknown>();
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        // The opened message's quick reply asks for its reply prefill; not answered here.
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: (_id: string, folder: string, n: number, cursor: string | null = null): Observable<EmailMessageList> => {
                            asked.push({ folder, page: n, cursor });
                            const answer = new Subject<EmailMessageList>();
                            answers.push(answer);
                            return answer;
                        },
                        openServerMessage: (_id: string, hit: ServerSearchHitDto): Observable<ServerMessageOpenedDto> => {
                            const reply = new Subject<ServerMessageOpenedDto>();
                            opens.push({ ref: hit.ref, reply });
                            return reply;
                        },
                        olderMessages: () => {
                            olderAsked++;
                            return NEVER;
                        },
                        getMessage: (id: string): Observable<EmailMessageDetailDto> => {
                            detailsAsked.push(id);
                            return of({ ...stored(id, 'Security advisory'), seen: false } as EmailMessageDetailDto);
                        },
                        listThread: () => of([]),
                        markSeen: (id: string, seen: boolean) => {
                            seenAsked.push({ id, seen });
                            return of({ ids: [id] });
                        },
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' } : null) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => live } },
                { provide: ContextMenuService, useValue: { openFromNodes: () => { menus++; } } },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        // The list's region a little shorter than four rows: real layout, and a first page that does not read on.
        const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.style.height = '100px';
        region.style.flex = 'none';
        fixture.componentInstance.selectFolder(FOLDER);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const pageOf = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const rows = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[data-test="list-scroll"] .mbx__row'));
    const subjects = (): string[] => rows().map(r => r.querySelector('.mbx__row-subject')?.textContent?.trim() ?? '');
    const rowOf = (subject: string): HTMLElement => rows().find(r => r.querySelector('.mbx__row-subject')?.textContent?.trim() === subject)!;
    const last = (): Subject<EmailMessageList> => answers[answers.length - 1];
    /** Lets the virtual viewport draw the rows: its own steps run after a microtask and a render. */
    const draw = (): void => {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            tick(20);
        }
        fixture.detectChanges();
    };
    const answer = (list: EmailMessageList): void => {
        last().next(list);
        draw();
    };
    const click = (target: HTMLElement, init: MouseEventInit = {}): void => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
        draw();
    };
    const endLine = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="list-end"]');
    const scrollToEnd = (): void => {
        const region = el().querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.scrollTop = region.scrollHeight;
        region.dispatchEvent(new Event('scroll'));
        draw();
    };

    it('shows a mixed page as the server ordered it, a server row keyed by its ref with no id key', fakeAsync(() => {
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: null });
        answer(page(MIXED, 'c-2'));

        expect(subjects()).withContext('the server\'s order, never sorted').toEqual(
            ['Package published', 'Weekly digest', 'Security advisory', 'Token created']);
        const serverRows = pageOf().messages().filter(m => m.fromServer === true);
        expect(serverRows.length).toBe(2);
        expect(serverRows.every(m => !('id' in m))).withContext('no id key on a server row').toBeTrue();
        expect(pageOf().messages().map(m => pageOf().rowKeyOf(m)))
            .toEqual(['ref:r-9', 'id:m-8', 'ref:r-7', 'id:m-6']);
        expect(rowOf('Package published').getAttribute('data-ref')).toBe('r-9');
        expect(rowOf('Weekly digest').getAttribute('data-ref')).toBeNull();
    }));

    it('a server row has no checkbox and no star, and no row menu, bar or select-all reaches it', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));

        expect(rowOf('Package published').querySelector('input[type="checkbox"]')).withContext('no checkbox').toBeNull();
        expect(rowOf('Package published').querySelector('button.mbx__row-star')).withContext('no star').toBeNull();
        expect(rowOf('Weekly digest').querySelector('input[type="checkbox"]')).withContext('a stored row has one').not.toBeNull();

        rowOf('Package published').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(menus).withContext('the row menu leaves a server row out').toBe(0);
        rowOf('Weekly digest').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(menus).withContext('a stored row has its menu').toBe(1);

        click(rowOf('Package published').querySelector<HTMLElement>('.mbx__row-main')!, { ctrlKey: true });
        expect(pageOf().selectedIds().size).withContext('Ctrl on a server row checks nothing').toBe(0);

        pageOf().selectAllLoaded();
        draw();
        expect([...pageOf().selectedIds()]).withContext('select all checks the stored rows only').toEqual(['m-8', 'm-6']);
        expect(pageOf().selectedCount()).toBe(2);
    }));

    it('a server row keeps the checkbox\'s and the star\'s room empty: its sender, subject and date line up with a stored row\'s', fakeAsync(() => {
        answer(page([
            server('r-9', 'Package published', { sentAt: '2026-11-11T09:00:00+00:00' }),
            stored('m-8', 'Weekly digest', { sentAt: '2026-11-11T08:00:00+00:00' }),
        ]));
        const serverRow = rowOf('Package published');
        const storedRow = rowOf('Weekly digest');
        const box = (row: HTMLElement, selector: string): DOMRect => row.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

        expect(box(storedRow, '.mbx__row-from').width).withContext('the list is laid out').toBeGreaterThan(0);
        expect(box(serverRow, '.mbx__row-from').left).withContext('the sender').toBe(box(storedRow, '.mbx__row-from').left);
        expect(box(serverRow, '.mbx__row-subject').left).withContext('the subject').toBe(box(storedRow, '.mbx__row-subject').left);
        expect(box(serverRow, '.mbx__row-date').right).withContext('the date').toBe(box(storedRow, '.mbx__row-date').right);

        // The room is empty and hidden from assistive technology, and nothing in it can take focus.
        const room = Array.from(serverRow.querySelectorAll<HTMLElement>('.mbx__row-check, .mbx__row-star'));
        expect(room.length).toBe(2);
        for (const part of room) {
            expect(part.getAttribute('aria-hidden')).toBe('true');
            expect(part.tagName).toBe('SPAN');
            expect(part.querySelector('input, button, a, [tabindex]')).toBeNull();
            expect(part.textContent?.trim()).toBe('');
        }
    }));

    it('opening a server row: the opener by its ref, then the stored message by its id, then the usual seen request', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));

        click(rowOf('Security advisory').querySelector<HTMLElement>('.mbx__row-main')!);
        expect(opens.map(o => o.ref)).toEqual(['r-7']);
        expect(detailsAsked).withContext('nothing opened before the opener answers').toEqual([]);

        opens[0].reply.next({ id: 'm-7', folder: FOLDER });
        draw();

        expect(detailsAsked).toEqual(['m-7']);
        expect(seenAsked).withContext('the host marks it read, as on any open').toEqual([{ id: 'm-7', seen: true }]);
        expect(pageOf().selectedMessage()?.id).toBe('m-7');
        expect(subjects()).withContext('in its place').toEqual(
            ['Package published', 'Weekly digest', 'Security advisory', 'Token created']);
        const opened = rowOf('Security advisory');
        expect(opened.getAttribute('data-ref')).toBeNull();
        expect(opened.querySelector('input[type="checkbox"]')).withContext('now an ordinary row').not.toBeNull();
        expect(opened.classList.contains('mbx__row--active')).toBeTrue();
        expect(rowOf('Package published').classList.contains('mbx__row--active')).withContext('a server row is never the open one').toBeFalse();
    }));

    it('a ref the server no longer has takes the row out, saying it is no longer on the mail server', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));

        click(rowOf('Package published').querySelector<HTMLElement>('.mbx__row-main')!);
        opens[0].reply.error(problem(404, 'gone'));
        draw();

        expect(subjects()).toEqual(['Weekly digest', 'Security advisory', 'Token created']);
        expect(el().querySelector('[data-test="server-row-gone"]')?.textContent?.trim())
            .toBe('That message is no longer on the mail server.');
        expect(detailsAsked).toEqual([]);
    }));

    it('reads the next page by the X-Next-Cursor header as the list is scrolled to its end, without a page number', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));

        scrollToEnd();
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        answer(page([server('r-5', 'Older notice'), stored('m-4', 'Old receipt')]));

        expect(subjects()).toEqual(
            ['Package published', 'Weekly digest', 'Security advisory', 'Token created', 'Older notice', 'Old receipt']);
        expect(pageOf().hasMore()).withContext('no cursor: the last page').toBeFalse();
        const count = asked.length;
        scrollToEnd();
        expect(asked.length).withContext('nothing past the last page').toBe(count);
    }));

    it('a stale cursor (409) starts the list again from the top, keeping nothing of the old pages', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));
        scrollToEnd();
        last().error(problem(409, 'stale-cursor'));
        draw();

        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: null });
        expect(pageOf().messages()).withContext('nothing of the old pages is kept').toEqual([]);

        answer(page([server('r-10', 'Brand new'), stored('m-8', 'Weekly digest')], 'c-3'));
        expect(subjects()).toEqual(['Brand new', 'Weekly digest']);
    }));

    it('a server that could not be read keeps the rows shown and says Couldn\'t load at the list\'s end, with Retry', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));
        scrollToEnd();
        answer(page([], null, 'unavailable'));

        expect(subjects().length).withContext('the rows shown stay').toBe(4);
        expect(endLine()?.textContent).toContain('Couldn\'t load');
        const retry = el().querySelector<HTMLElement>('[data-test="list-end-retry"]')!;
        expect(retry.textContent?.trim()).toBe('Retry');

        click(retry);
        expect(asked.at(-1)).withContext('the same page asked again').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        answer(page([stored('m-4', 'Old receipt')]));
        expect(endLine()).toBeNull();
        expect(subjects().at(-1)).toBe('Old receipt');
    }));

    it('a rate limit (429) says how long to wait, then offers Retry', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));
        scrollToEnd();
        last().error(problem(429, 'rate-limited', '3'));
        draw();

        expect(subjects().length).withContext('the rows shown stay').toBe(4);
        expect(endLine()?.textContent).toContain('Retry in 3 s');
        expect(el().querySelector('[data-test="list-end-retry"]')).withContext('not before the wait ends').toBeNull();

        tick(3000);
        fixture.detectChanges();
        const retry = el().querySelector<HTMLElement>('[data-test="list-end-retry"]');
        expect(retry).withContext('Retry once the wait ends').not.toBeNull();
        click(retry!);
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        discardPeriodicTasks();
        flush();
    }));

    it('a realtime change reads the first page only, and the rows of later pages stay as they are', fakeAsync(() => {
        answer(page(MIXED, 'c-2'));
        scrollToEnd();
        answer(page([server('r-5', 'Older notice'), stored('m-4', 'Old receipt')], 'c-3'));
        const count = asked.length;

        // A message moved into the folder from another device: the list is read again once the burst settles.
        live.next(readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'action', seq: 5,
            changes: [{ id: 'm-11', threadId: null, folder: 'INBOX', movedTo: FOLDER, seen: true, flagged: false }],
            counts: {}, mailboxUnseen: 0,
        }) as MailMessagesChangedEvent);
        tick(400);
        draw();

        expect(asked.length).withContext('one read').toBe(count + 1);
        expect(asked.at(-1)).withContext('the first page only').toEqual({ folder: FOLDER, page: 1, cursor: null });
        answer(page([stored('m-11', 'Moved in'), ...MIXED.slice(0, 3)], 'c-2b'));

        expect(subjects()).toEqual(
            ['Moved in', 'Package published', 'Weekly digest', 'Security advisory', 'Older notice', 'Old receipt']);
        scrollToEnd();
        expect(asked.at(-1)?.cursor).withContext('the later pages\' cursor is kept').toBe('c-3');
        flush();
    }));

    it('offers no Older on the mail server section for such a folder', fakeAsync(() => {
        answer(page(MIXED));

        expect(pageOf().hasMore()).toBeFalse();
        expect(el().querySelector('[data-test="load-older"]')).toBeNull();
        expect(olderAsked).toBe(0);
    }));

    it('a folder paged by number reads nothing more past its own pages: its cursor carries any older mail', fakeAsync(() => {
        answer(page([stored('m-1', 'Hello')]));

        expect(el().querySelector('[data-test="load-older"]')).toBeNull();
        const count = asked.length;
        scrollToEnd();
        expect(asked.length).toBe(count);
        expect(olderAsked).toBe(0);
        expect(el().querySelector('app-mail-server-search')).toBeNull();
    }));

    /**
     * Whether a folder is listed from the mail server is the server's word, as the folder tree and the folder list
     * carry it (`listedFromServer`); the first answer is read only when neither carries the field. Neither kind reads
     * older mail of its own on scrolling past its pages: the cursor carries it.
     */
    describe('whether the folder is listed from the mail server', () => {
        const node = (folder: string, extra: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto => ({
            folder, name: folder, selectable: true, total: 0, unseen: 0, children: [], ...extra,
        });

        it('the tree node\'s word, found at any level, before the list entry\'s; null when neither says', () => {
            const tree = [node('Projects', { selectable: false, children: [node(FOLDER, { listedFromServer: true })] })];
            expect(folderListedFromServer(FOLDER, tree, [{ folder: FOLDER, total: 0, unseen: 0, listedFromServer: false }])).toBeTrue();
            expect(folderListedFromServer(FOLDER, [node(FOLDER)], [{ folder: FOLDER, total: 0, unseen: 0, listedFromServer: false }])).toBeFalse();
            expect(folderListedFromServer(FOLDER, null, [{ folder: FOLDER, total: 0, unseen: 0, listedFromServer: true }])).toBeTrue();
            expect(folderListedFromServer(FOLDER, [node(FOLDER)], [{ folder: FOLDER, total: 0, unseen: 0 }])).toBeNull();
            expect(folderListedFromServer(FOLDER, null, [])).toBeNull();
        });

        it('the tree says listed from the server: an answer with no server sign is still paged by cursor, and reads no older mail', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER, { listedFromServer: true })]);
            answer(page([stored('m-2', 'Weekly digest'), stored('m-1', 'Hello')]));

            expect(pageOf().serverListed()).toBeTrue();
            expect(pageOf().hasMore()).withContext('no cursor: nothing more').toBeFalse();
            scrollToEnd();
            expect(olderAsked).toBe(0);
        }));

        it('the tree says it is not: an answer that looks like one is a stored folder, its server rows still server rows', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER, { listedFromServer: false })]);
            answer(page(MIXED));

            expect(pageOf().serverListed()).toBeFalse();
            expect(rowOf('Package published').getAttribute('data-ref')).toBe('r-9');
            expect(rowOf('Package published').querySelector('input[type="checkbox"]')).toBeNull();
            scrollToEnd();
            expect(olderAsked).toBe(0);
        }));

        it('the folder list says it when the tree does not', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER)]);
            pageOf().folders.set([{ folder: FOLDER, total: 0, unseen: 0, listedFromServer: true }]);
            answer(page([stored('m-1', 'Hello')]));

            expect(pageOf().serverListed()).toBeTrue();
        }));

        it('neither carries the field: the first answer decides, as before', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER)]);
            pageOf().folders.set([{ folder: FOLDER, total: 0, unseen: 0 }]);
            answer(page(MIXED, 'c-2'));
            expect(pageOf().serverListed()).withContext('server rows and a cursor').toBeTrue();

            pageOf().selectFolder('INBOX');
            draw();
            pageOf().selectFolder(FOLDER);
            draw();
            answer(page([stored('m-1', 'Hello')]));
            expect(pageOf().serverListed()).withContext('stored rows only').toBeFalse();
            discardPeriodicTasks();
        }));

        it('guessed from a server row or the server-pages word only, never from a cursor', () => {
            expect(listedFromServer(page([stored('m-1', 'Hello')], 'c-2'))).withContext('stored rows and a cursor').toBeFalse();
            expect(listedFromServer(page([stored('m-1', 'Hello')]))).withContext('stored rows only').toBeFalse();
            expect(listedFromServer(page([stored('m-1', 'Hello'), server('r-1', 'Notice')]))).withContext('a server row').toBeTrue();
            expect(listedFromServer(page([stored('m-1', 'Hello')], null, 'more'))).withContext('the server-pages word').toBeTrue();
        });

        it('neither carries the field: a stored folder whose page carries a cursor is not guessed as listed from the server', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER)]);
            pageOf().folders.set([{ folder: FOLDER, total: 0, unseen: 0 }]);
            answer(page([stored('m-2', 'Weekly digest'), stored('m-1', 'Hello')], 'c-2'));

            expect(pageOf().serverListed()).toBeFalse();
            expect(pageOf().hasMore()).withContext('the cursor still reads on').toBeTrue();
            discardPeriodicTasks();
        }));

        it('the tree\'s word still wins over a stored page with a cursor', fakeAsync(() => {
            pageOf().folderTree.set([node(FOLDER, { listedFromServer: true })]);
            answer(page([stored('m-1', 'Hello')], 'c-2'));

            expect(pageOf().serverListed()).toBeTrue();
            discardPeriodicTasks();
        }));
    });
});
