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
import { EmailService, listOrderOf } from './email.service';
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
 * The mail list selects as a desktop file list does (the components contract's list `selection` part), as the
 * Workspace does: click, Ctrl/Cmd+click, Shift+click on a row or its checkbox, the list's keys, the count in the
 * reading pane from two checked rows, and a status line that says the count and a clear.
 */
describe('EmailMailboxPageComponent -- selecting as a desktop file list does', () => {
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
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
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
        // The list's region tall enough to draw every row of the page.
        const region = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="list-scroll"]')!;
        region.style.height = '600px';
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

    const FIVE = [stored('m-1', 'One'), stored('m-2', 'Two'), stored('m-3', 'Three'), stored('m-4', 'Four'), stored('m-5', 'Five')];
    const main = (subject: string): HTMLElement => rowOf(subject).querySelector<HTMLElement>('[data-part="main"]')!;
    const box = (subject: string): HTMLInputElement => rowOf(subject).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const checked = (): string[] => [...pageOf().selectedIds()].sort();
    const status = (): string => el().querySelector('[data-test="selection-status"]')?.textContent?.trim() ?? '';
    const paneCount = (): string | null => el().querySelector('[data-test="checked-count"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const press = (target: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
        const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(ev);
        draw();
        return ev;
    };

    it('Ctrl or Cmd+click toggles a row without opening it; a plain click clears the checks and opens', fakeAsync(() => {
        answer(page(FIVE));
        click(main('Two'), { ctrlKey: true });
        click(main('Four'), { metaKey: true });
        expect(checked()).toEqual(['m-2', 'm-4']);
        expect(detailsAsked).withContext('neither opened').toEqual([]);

        click(main('Three'));
        expect(checked()).withContext('a plain click clears every check').toEqual([]);
        expect(detailsAsked).toEqual(['m-3']);
        flush();
        discardPeriodicTasks();
    }));

    it('Shift+click checks the range from the anchor, on the row or its checkbox; the anchor stays for the next', fakeAsync(() => {
        answer(page(FIVE));
        click(main('Two'), { ctrlKey: true });
        click(main('Four'), { shiftKey: true });
        expect(checked()).toEqual(['m-2', 'm-3', 'm-4']);

        // From the same anchor the other way, on a checkbox: the range follows it, and the box shows its check.
        click(box('One'), { shiftKey: true });
        tick();
        draw();
        expect(checked()).toEqual(['m-1', 'm-2']);
        expect(box('One').checked).withContext('the shift-clicked box is checked').toBeTrue();
        expect(box('Four').checked).withContext('a row out of the range is not').toBeFalse();
        expect(detailsAsked).withContext('nothing opened').toEqual([]);
    }));

    it('keys: Space toggles, Shift+Down checks from the anchor, Shift+Up shrinks it, Ctrl+A checks all, Esc clears', fakeAsync(() => {
        answer(page(FIVE));
        main('Two').focus();
        const space = press(main('Two'), { key: ' ' });
        expect(space.defaultPrevented).withContext('Space does not also press the row').toBeTrue();
        expect(checked()).toEqual(['m-2']);
        expect(status()).toBe('1 selected');

        press(main('Two'), { key: 'ArrowDown', shiftKey: true });
        press(main('Three'), { key: 'ArrowDown', shiftKey: true });
        expect(checked()).toEqual(['m-2', 'm-3', 'm-4']);
        expect(document.activeElement).withContext('the focus moved with it').toBe(main('Four'));

        press(main('Four'), { key: 'ArrowUp', shiftKey: true });
        expect(checked()).withContext('going back shrinks the range').toEqual(['m-2', 'm-3']);

        press(main('Three'), { key: 'a', ctrlKey: true });
        expect(checked()).toEqual(['m-1', 'm-2', 'm-3', 'm-4', 'm-5']);
        expect(status()).toBe('5 selected');

        const esc = press(main('Three'), { key: 'Escape' });
        expect(esc.defaultPrevented).toBeTrue();
        expect(checked()).toEqual([]);
        expect(status()).withContext('a clear is said').toBe('Selection cleared');

        const second = press(main('Three'), { key: 'Escape' });
        expect(second.defaultPrevented).withContext('with none checked Esc is left as it was').toBeFalse();
        expect(detailsAsked).withContext('no key opened a row while shifting or checking').toEqual([]);
    }));

    it('Up/Down open the row as a click would, checks unchanged; from two checked they move the focus only and the pane says how many', fakeAsync(() => {
        answer(page(FIVE));
        click(main('One'), { ctrlKey: true });
        main('One').focus();
        press(main('One'), { key: 'ArrowDown' });
        expect(detailsAsked).withContext('one checked: the row opens').toEqual(['m-2']);
        expect(checked()).withContext('the check stays').toEqual(['m-1']);
        expect(paneCount()).toBeNull();

        click(main('Three'), { ctrlKey: true });
        expect(paneCount()).toContain('2 selected');

        main('Three').focus();
        press(main('Three'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(main('Four'));
        expect(detailsAsked).withContext('two checked: the focus moves only').toEqual(['m-2']);
        expect(paneCount()).toContain('2 selected');
        flush();
        discardPeriodicTasks();
    }));

    it('a server row is skipped by a range and never checked by a key', fakeAsync(() => {
        answer(page([stored('m-1', 'One'), server('r-2', 'On the server'), stored('m-3', 'Three')]));
        click(main('One'), { ctrlKey: true });
        click(main('Three'), { shiftKey: true });
        expect(checked()).toEqual(['m-1', 'm-3']);

        main('On the server').focus();
        const space = press(main('On the server'), { key: ' ' });
        expect(checked()).withContext('Space on a server row checks nothing').toEqual(['m-1', 'm-3']);
        expect(space.defaultPrevented).withContext('...and presses its button as ever').toBeFalse();
    }));
});
