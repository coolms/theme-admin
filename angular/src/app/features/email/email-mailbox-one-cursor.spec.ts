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
    DraftStoreService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailFolderTreeNodeDto, type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto, type EmailMessageList,
    type ServerOlderMessagesDto, type ServerSearchHitDto,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';

/** A row the inbox stores: an id, fromServer false. */
const stored = (id: string, subject: string): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null,
});

/** A row of the server's older mail, past the stored rows: fromServer, a ref, and no id key at all. */
const server = (ref: string, subject: string): EmailMessageDto => ({
    mailboxId: 'mb1', folder: FOLDER, uid: 7, subject, fromAddress: 'b@example.test', seen: true, flagged: false,
    fromServer: true, ref,
}) as unknown as EmailMessageDto;

/** One answer of the list, with the headers it came with. */
const page = (rows: EmailMessageDto[], next: string | null = null, serverPages: string | null = null): EmailMessageList =>
    Object.assign([...rows], { next, serverPages });

/** A refused page, as the server answers it: a problem type, and a Retry-After with a rate limit. */
const problem = (status: number, reason: string, retryAfter?: string): HttpErrorResponse => new HttpErrorResponse({
    status,
    error: { type: `/errors/email/server-search/${reason}` },
    headers: retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
});

/** The inbox is a stored folder (its sync has not reached the bottom yet): the tree says it is not listed from the server. */
const TREE: EmailFolderTreeNodeDto[] = [
    { folder: FOLDER, name: 'Inbox', selectable: true, total: 3, unseen: 0, children: [], listedFromServer: false },
];

/** The older mail the server holds, as its older-mail read would give it: the same messages the cursor runs into. */
const OLDER_HITS: ServerSearchHitDto[] = [
    ['r-5', 'Older notice'], ['r-6', 'Old receipt'], ['r-7', 'Oldest letter'],
].map(([ref, subject], i) => ({
    ref, folder: FOLDER, uid: 5 + i, from: { name: null, address: 'b@example.test' }, subject,
    date: null, sizeBytes: null, seen: true, flagged: false, local: false, localId: null,
}));

/**
 * One cursor for every folder: an inbox whose sync has not reached its bottom pages on by the X-Next-Cursor header
 * (given from its first page on) past its stored rows into the server's older mail, which comes as server rows in the
 * same list. No separate section lists that mail a second time. A page empty but for its cursor is followed on, one
 * read per drawn list. A stale cursor (409) starts the list again from its top; a rate limit (429) and a server that
 * could not be read keep the cursor sent for Retry.
 */
describe('EmailMailboxPageComponent -- one cursor, the inbox\'s older mail included', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let asked: Array<{ folder: string; page: number; cursor: string | null }>;
    let answers: Array<Subject<EmailMessageList>>;
    let olderAsked: number;

    beforeEach(() => {
        asked = [];
        answers = [];
        olderAsked = 0;
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: TREE, canCreateTop: false, held: false }),
                        listMessages: (_id: string, folder: string, n: number, cursor: string | null = null): Observable<EmailMessageList> => {
                            asked.push({ folder, page: n, cursor });
                            const answer = new Subject<EmailMessageList>();
                            answers.push(answer);
                            return answer;
                        },
                        openServerMessage: () => NEVER,
                        olderMessages: (): Observable<ServerOlderMessagesDto> => {
                            olderAsked++;
                            return of({ id: 'mb1', folder: FOLDER, hits: OLDER_HITS, next: null });
                        },
                        getMessage: (id: string): Observable<EmailMessageDetailDto> => of(stored(id, 'x') as EmailMessageDetailDto),
                        listThread: () => of([]),
                        markSeen: (id: string) => of({ ids: [id] }),
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
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
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
        // The list's region a little shorter than four rows: real layout, and a first page that does not read on.
        const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.style.height = '100px';
        region.style.flex = 'none';
        fixture.componentInstance.folderTree.set(TREE);
        fixture.componentInstance.selectFolder(FOLDER);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const pageOf = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const rows = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[data-test="list-scroll"] .mbx__row'));
    const rowOf = (subject: string): HTMLElement | undefined =>
        rows().find(r => r.querySelector('.mbx__row-subject')?.textContent?.trim() === subject);
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
    const click = (target: HTMLElement): void => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        draw();
    };
    const endLine = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="list-end"]');
    const scrollToEnd = (): void => {
        const region = el().querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.scrollTop = region.scrollHeight;
        region.dispatchEvent(new Event('scroll'));
        draw();
    };
    /** How many times `text` is found in what the page shows. */
    const shown = (text: string): number => (el().textContent ?? '').split(text).length - 1;

    it('the cursor runs past the stored rows into the server\'s older mail: each message listed once, no Older section', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note'), stored('m-2', 'Second note'), stored('m-3', 'Third note')], 'c-2'));
        expect(pageOf().serverListed()).withContext('the inbox is a stored folder').toBeFalse();

        scrollToEnd();
        expect(asked.at(-1)).withContext('the cursor sent back unchanged').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        answer(page([server('r-5', 'Older notice'), server('r-6', 'Old receipt')], 'c-3'));

        scrollToEnd();
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: 'c-3' });
        answer(page([server('r-7', 'Oldest letter')]));

        // The last page: no header. Scrolling on past it asks nothing more, of the list or of any other read.
        const count = asked.length;
        scrollToEnd();
        scrollToEnd();
        expect(asked.length).withContext('nothing past the last page').toBe(count);
        expect(pageOf().hasMore()).toBeFalse();
        expect(olderAsked).withContext('the older mail is not read a second way').toBe(0);
        expect(el().querySelector('app-mail-server-search')).withContext('no Older section').toBeNull();

        const keys = pageOf().messages().map(m => pageOf().rowKeyOf(m));
        expect(keys).toEqual(['id:m-1', 'id:m-2', 'id:m-3', 'ref:r-5', 'ref:r-6', 'ref:r-7']);
        for (const subject of ['Older notice', 'Old receipt', 'Oldest letter']) {
            expect(shown(subject)).withContext(`"${subject}" shown at most once`).toBeLessThanOrEqual(1);
        }

        // The server rows are server rows, as in a folder listed from the server: keyed by ref, Open only, the room kept.
        const oldest = rowOf('Oldest letter')!;
        expect(oldest).withContext('the last row is drawn').toBeDefined();
        expect(shown('Oldest letter')).toBe(1);
        expect(oldest.getAttribute('data-ref')).toBe('r-7');
        expect(oldest.querySelector('input[type="checkbox"]')).withContext('no checkbox').toBeNull();
        expect(oldest.querySelector('button.mbx__row-star')).withContext('no star').toBeNull();
        expect(oldest.querySelector('.mbx__row-check--none')).withContext('the checkbox\'s room').not.toBeNull();
        flush();
    }));

    it('a stale cursor (409) on the inbox\'s cursor starts the list again from its top, without a cursor', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note'), stored('m-2', 'Second note')], 'c-2'));
        scrollToEnd();
        expect(asked.at(-1)?.cursor).toBe('c-2');

        last().error(problem(409, 'stale-cursor'));
        draw();

        expect(asked.at(-1)).withContext('from the top, no cursor').toEqual({ folder: FOLDER, page: 1, cursor: null });
        expect(pageOf().messages()).withContext('nothing of the old pages is kept').toEqual([]);
        expect(pageOf().messagesFailure()).toBeNull();
        answer(page([stored('m-0', 'Brand new'), stored('m-1', 'Newest note')], 'c-9'));
        expect(pageOf().messages().map(m => m.id)).toEqual(['m-0', 'm-1']);
        flush();
    }));

    it('a server page empty but for its cursor is followed on, one read per drawn list, until rows come', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note'), stored('m-2', 'Second note')], 'c-2'));
        scrollToEnd();
        expect(asked.at(-1)?.cursor).toBe('c-2');

        // Every hit on these pages was stored already and left out: no rows, and a cursor on.
        for (const [sent, next] of [['c-2', 'c-3'], ['c-3', 'c-4'], ['c-4', 'c-5']]) {
            const count = asked.length;
            last().next(page([], next));
            expect(asked.length).withContext(`after the empty page of ${sent}: nothing asked before the list is drawn`).toBe(count);
            draw();
            expect(asked.length).withContext(`after the empty page of ${sent}: one read`).toBe(count + 1);
            expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: next });
        }
        expect(endLine()).withContext('an empty page is not the end').toBeNull();

        answer(page([server('r-5', 'Older notice')]));
        const count = asked.length;
        scrollToEnd();
        expect(asked.length).withContext('no cursor: the end').toBe(count);
        expect(pageOf().messages().map(m => pageOf().rowKeyOf(m))).toEqual(['id:m-1', 'id:m-2', 'ref:r-5']);
        flush();
    }));

    it('no page numbers once each page carries a cursor', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note')], 'c-2'));
        scrollToEnd();
        answer(page([stored('m-2', 'Second note')], 'c-3'));
        scrollToEnd();
        answer(page([server('r-5', 'Older notice')]));

        expect(asked.filter(a => a.cursor !== null).map(a => a.cursor)).toEqual(['c-2', 'c-3']);
        expect(asked.every(a => a.page === 1)).withContext('page 2 is never asked').toBeTrue();
        flush();
    }));

    it('a 429 keeps the cursor: Retry in N s, then Retry asks the same cursor', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note'), stored('m-2', 'Second note')], 'c-2'));
        scrollToEnd();
        last().error(problem(429, 'rate-limited', '2'));
        draw();

        expect(endLine()?.textContent).toContain('Retry in 2 s');
        expect(pageOf().messages().length).withContext('the rows shown stay').toBe(2);
        tick(2000);
        fixture.detectChanges();
        const retry = el().querySelector<HTMLElement>('[data-test="list-end-retry"]');
        expect(retry).withContext('Retry once the wait ends').not.toBeNull();
        click(retry!);
        expect(asked.at(-1)).withContext('the same cursor').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        discardPeriodicTasks();
        flush();
    }));

    it('server pages unavailable (no rows, no next cursor): Retry asks again by the cursor sent', fakeAsync(() => {
        answer(page([stored('m-1', 'Newest note'), stored('m-2', 'Second note')], 'c-2'));
        scrollToEnd();
        answer(page([], null, 'unavailable'));

        expect(pageOf().messages().length).withContext('the rows shown stay').toBe(2);
        const retry = el().querySelector<HTMLElement>('[data-test="list-end-retry"]');
        expect(retry?.textContent?.trim()).toBe('Retry');
        click(retry!);
        expect(asked.at(-1)).withContext('the same cursor').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        answer(page([server('r-5', 'Older notice')]));
        expect(endLine()).toBeNull();
        expect(pageOf().messages().map(m => pageOf().rowKeyOf(m))).toEqual(['id:m-1', 'id:m-2', 'ref:r-5']);
        flush();
    }));
});
