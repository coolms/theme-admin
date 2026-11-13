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
    type EmailSearchHitDto,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';
/** The folder's total, as the folder tree gives it. */
const TOTAL = 5544;
/** The list's scroll region, in px: real layout, so what is drawn is what a person would see. */
const VIEW = 400;

const row = (n: number, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id: `m-${n}`, mailboxId: 'mb1', folder: FOLDER, subject: `Message ${n}`, fromAddress: 'a@example.test',
    seen: true, flagged: false, ...extra,
});
/** Rows `from` to `to`, newest first as the server lists them. */
const rows = (from: number, to: number): EmailMessageDto[] => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));
const page = (list: EmailMessageDto[], next: string | null = null, serverPages: string | null = null): EmailMessageList =>
    Object.assign([...list], { next, serverPages });
const failure = (status: number, retryAfter?: string): HttpErrorResponse => new HttpErrorResponse({
    status,
    headers: retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
});
const hit = (n: number): EmailSearchHitDto => ({ id: `h-${n}`, folder: FOLDER, subject: `Hit ${n}`, fromAddress: 'a@example.test' }) as EmailSearchHitDto;

/**
 * The message list loads more as the person scrolls: the next page is asked for with about one and a half screens of
 * rows left below the view, a Loading... row stands at the list's end while it reads, and a page not read says so on
 * that row only, with Retry. The list is virtualized at a fixed row height; new mail heard in real time never moves
 * the view, and a pill says how many came; Select all checks the rows loaded. Real layout in the browser.
 */
describe('EmailMailboxPageComponent -- the list loads more as it is scrolled', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let asked: Array<{ folder: string; page: number; cursor: string | null }>;
    let answers: Array<Subject<EmailMessageList>>;
    let searches: Array<{ page: number; reply: Subject<EmailSearchHitDto[]> }>;
    let olderAsked: number;
    let tree: EmailFolderTreeNodeDto[];
    let live: Subject<unknown>;

    beforeEach(() => {
        asked = [];
        answers = [];
        searches = [];
        olderAsked = 0;
        tree = [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: TOTAL, unseen: 0 }];
        live = new Subject<unknown>();
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: tree, canCreateTop: false, held: false }),
                        listMessages: (_id: string, folder: string, n: number, cursor: string | null = null): Observable<EmailMessageList> => {
                            asked.push({ folder, page: n, cursor });
                            const answer = new Subject<EmailMessageList>();
                            answers.push(answer);
                            return answer;
                        },
                        searchMessages: (query: { page?: number }): Observable<EmailSearchHitDto[]> => {
                            const reply = new Subject<EmailSearchHitDto[]>();
                            searches.push({ page: query.page ?? 1, reply });
                            return reply;
                        },
                        serverSearch: () => NEVER,
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        olderMessages: () => {
                            olderAsked++;
                            return NEVER;
                        },
                        getMessage: (id: string): Observable<EmailMessageDetailDto> => of({ ...row(Number(id.slice(2))), id } as EmailMessageDetailDto),
                        listThread: () => of([]),
                        markSeen: (id: string) => of({ ids: [id] }),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {}, dismiss: (): void => {} } },
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
                { provide: EmailLiveEventsService, useValue: { watch: () => live } },
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
        // The region as tall as a screen of the list: the page's own height comes from the shell, absent here.
        region().style.height = `${VIEW}px`;
        region().style.flex = 'none';
        fixture.componentInstance.selectFolder(FOLDER);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const pageOf = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const region = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="list-scroll"]')!;
    const viewport = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="list-rows"]')!;
    const drawn = (): HTMLElement[] => Array.from(region().querySelectorAll<HTMLElement>('.mbx__row'));
    const subjectOf = (r: HTMLElement): string => r.querySelector('.mbx__row-subject')?.textContent?.trim() ?? '';
    const rowOf = (subject: string): HTMLElement | undefined => drawn().find(r => subjectOf(r) === subject);
    const endRow = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="list-end"]');
    const loadingRow = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="list-loading"]');
    const pill = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="new-messages"]');
    const last = (): Subject<EmailMessageList> => answers[answers.length - 1];
    const h = (): number => pageOf().rowHeight;

    /** Lets the virtual viewport draw: its own work runs after a microtask and a render. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));
        }
        fixture.detectChanges();
    }
    async function answer(list: EmailMessageList): Promise<void> {
        last().next(list);
        await settle();
    }
    /** The px left below the view to the rows' end, as the region lays them out. */
    const below = (): number => {
        const r = region();
        const rowsBottom = viewport().getBoundingClientRect().bottom - r.getBoundingClientRect().top + r.scrollTop;
        return rowsBottom - r.scrollTop - r.clientHeight;
    };
    /** Scrolls the region so that `px` are left below the view; the scroll event runs as a person's would. */
    async function leaveBelow(px: number): Promise<void> {
        region().scrollTop += below() - px;
        await settle();
    }
    async function scrollTo(top: number): Promise<void> {
        region().scrollTop = top;
        await settle();
    }
    /** The row at the view's top, and how far above the region's top it starts. */
    const atTop = (): { subject: string; above: number } => {
        const top = region().getBoundingClientRect().top;
        const first = drawn().find(r => {
            const rect = r.getBoundingClientRect();
            return rect.top <= top + 0.5 && rect.bottom > top + 0.5;
        })!;
        return { subject: subjectOf(first), above: Math.round(top - first.getBoundingClientRect().top) };
    };

    it('asks for the next page with about one and a half screens of rows left below the view, not before', async () => {
        await answer(page(rows(1, 50)));
        const first = asked.length;
        expect(region().clientHeight).withContext('real layout: the region is a screen tall').toBe(VIEW);

        await leaveBelow(1.6 * VIEW);
        expect(asked.length).withContext('1.6 screens left: not yet').toBe(first);

        await leaveBelow(1.4 * VIEW);
        expect(asked.length).withContext('1.4 screens left: the next page').toBe(first + 1);
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 2, cursor: null });

        await leaveBelow(1.0 * VIEW);
        expect(asked.length).withContext('one read at a time').toBe(first + 1);
    });

    it('a Loading... row stands at the list\'s end while the next page reads, and goes with its answer', async () => {
        await answer(page(rows(1, 50)));
        expect(loadingRow()).withContext('nothing read: no Loading row').toBeNull();

        await leaveBelow(VIEW);
        expect(loadingRow()?.textContent?.trim()).toBe('Loading...');
        expect(loadingRow()!.getBoundingClientRect().top).withContext('after the rows')
            .toBeGreaterThanOrEqual(viewport().getBoundingClientRect().bottom - 0.5);
        expect(endRow()).toBeNull();

        await answer(page(rows(51, 100)));
        expect(loadingRow()).toBeNull();
        expect(pageOf().messages().length).toBe(100);
    });

    it('a failed page shows Couldn\'t load with Retry on that row only; Retry asks for the same page', async () => {
        await answer(page(rows(1, 50)));
        await leaveBelow(VIEW);
        last().error(failure(500));
        await settle();

        expect(endRow()?.textContent).toContain('Couldn\'t load');
        const retry = endRow()!.querySelector<HTMLElement>('[data-test="list-end-retry"]')!;
        expect(retry.textContent?.trim()).toBe('Retry');
        expect(loadingRow()).toBeNull();
        expect(pageOf().messagesFailure()).withContext('not the whole list\'s failure').toBeNull();
        expect(pageOf().messages().length).withContext('the rows shown stay').toBe(50);
        expect(el().querySelectorAll('[data-test="list-end-retry"]').length).withContext('the only Retry').toBe(1);
        expect(el().querySelector('[data-test="load-older"]')).withContext('no Load older button').toBeNull();

        const count = asked.length;
        await leaveBelow(0);
        expect(asked.length).withContext('scrolling does not retry by itself').toBe(count);

        retry.click();
        await settle();
        expect(asked.at(-1)).withContext('the same page again').toEqual({ folder: FOLDER, page: 2, cursor: null });
        expect(endRow()).toBeNull();
        expect(loadingRow()).not.toBeNull();
    });

    it('a 429 counts down from Retry-After on that row, then offers Retry', fakeAsync(() => {
        last().next(page(rows(1, 50), 'c-2'));
        fixture.detectChanges();
        region().scrollTop = 50 * h();
        pageOf().onListScroll();
        fixture.detectChanges();
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });

        last().error(failure(429, '3'));
        fixture.detectChanges();
        expect(endRow()?.textContent?.trim()).toBe('Retry in 3 s');
        expect(endRow()!.querySelector('[data-test="list-end-retry"]')).withContext('no Retry while it counts').toBeNull();

        tick(1000);
        fixture.detectChanges();
        expect(endRow()?.textContent?.trim()).toBe('Retry in 2 s');
        tick(2000);
        fixture.detectChanges();
        const retry = endRow()!.querySelector<HTMLElement>('[data-test="list-end-retry"]');
        expect(retry?.textContent?.trim()).withContext('Retry once the wait ends').toBe('Retry');
        expect(endRow()!.textContent).not.toContain('Retry in');

        retry!.click();
        fixture.detectChanges();
        expect(asked.at(-1)).toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
        discardPeriodicTasks();
        flush();
    }));

    it('an answer with X-Server-Pages: unavailable shows Couldn\'t load with Retry, the rows shown kept', async () => {
        await answer(page(rows(1, 50), 'c-2'));
        await leaveBelow(VIEW);
        await answer(page([], null, 'unavailable'));

        expect(endRow()?.textContent).toContain('Couldn\'t load');
        expect(pageOf().messages().length).toBe(50);
        endRow()!.querySelector<HTMLElement>('[data-test="list-end-retry"]')!.click();
        await settle();
        expect(asked.at(-1)).withContext('the same cursor again').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });
    });

    it('pages by the cursor an answer gives, and by the next page number where none is given; the last page has none', async () => {
        await answer(page(rows(1, 50), 'c-2'));
        await leaveBelow(VIEW);
        expect(asked.at(-1)).withContext('the cursor given').toEqual({ folder: FOLDER, page: 1, cursor: 'c-2' });

        await answer(page(rows(51, 100)));
        expect(pageOf().hasMore()).withContext('no cursor on the last page').toBeFalse();
        const count = asked.length;
        await leaveBelow(0);
        expect(asked.length).withContext('nothing past the last page').toBe(count);

        pageOf().selectFolder(FOLDER);
        await answer(page(rows(1, 50)));
        await leaveBelow(VIEW);
        expect(asked.at(-1)).withContext('no cursor: the next page number').toEqual({ folder: FOLDER, page: 2, cursor: null });
        await answer(page(rows(51, 60)));
        expect(pageOf().hasMore()).withContext('a short page is the last').toBeFalse();
    });

    it('draws only a bounded number of rows for a 2,000-row list, each the same height, as the view moves', async () => {
        await answer(page(rows(1, 2000)));
        const bound = Math.ceil(VIEW / h()) + 2 * 8 + 2;

        expect(pageOf().messages().length).toBe(2000);
        expect(drawn().length).withContext('rows in the page at the top').toBeGreaterThan(0);
        expect(drawn().length).toBeLessThanOrEqual(bound);
        expect(drawn().every(r => Math.abs(r.getBoundingClientRect().height - h()) < 0.5)).withContext('one fixed height').toBeTrue();
        expect(viewport().getBoundingClientRect().height).withContext('the rows take their whole length').toBeCloseTo(2000 * h(), 0);

        await scrollTo(1000 * h());
        expect(drawn().length).toBeLessThanOrEqual(bound);
        expect(atTop().subject).withContext('the row the view reached').toBe('Message 1001');
        expect(rowOf('Message 1')).withContext('the top rows left the page').toBeUndefined();
    });

    it('each row carries aria-posinset and aria-setsize, the folder\'s total from the tree, or -1 when unknown', async () => {
        await answer(page(rows(1, 2000)));
        await scrollTo(700 * h());
        const r = rowOf('Message 701')!;
        expect(r.getAttribute('role')).toBe('listitem');
        expect(viewport().getAttribute('role')).toBe('list');
        expect(r.getAttribute('aria-posinset')).toBe('701');
        expect(r.getAttribute('aria-setsize')).toBe(String(TOTAL));

        tree = [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: 100, unseen: 0 }];
        pageOf().retryFolders();
        await answer(page(rows(1, 2000)));
        expect(drawn()[0].getAttribute('aria-setsize')).withContext('a total that cannot hold the rows: unknown').toBe('-1');
    });

    it('new mail heard while scrolled down keeps the view where it is, and the pill says how many came', async () => {
        await answer(page(rows(1, 50)));
        await scrollTo(20 * h() + 10);
        const before = atTop();
        expect(before).toEqual({ subject: 'Message 21', above: 10 });
        expect(pill()).toBeNull();

        live.next({ type: 'mail.received', mailboxId: 'mb1', folder: FOLDER, newCount: 3 });
        await settle();
        expect(asked.at(-1)).withContext('the first page read again').toEqual({ folder: FOLDER, page: 1, cursor: null });
        await answer(page([row(901), row(902), row(903), ...rows(1, 47)]));

        expect(pageOf().messages().length).withContext('nothing shown is dropped').toBe(53);
        expect(atTop()).withContext('the same row, at the same place').toEqual(before);
        expect(pill()?.textContent?.trim()).toBe('New messages: 3');
        expect(pill()!.getBoundingClientRect().top).withContext('at the list\'s top')
            .toBeLessThan(region().getBoundingClientRect().top + 40);

        pill()!.click();
        await settle();
        expect(region().scrollTop).withContext('the pill scrolls to the top').toBe(0);
        expect(atTop().subject).toBe('Message 901');
        expect(pill()).toBeNull();
    });

    it('new mail heard at the top simply appears, with no pill', async () => {
        await answer(page(rows(1, 50)));
        live.next({ type: 'mail.received', mailboxId: 'mb1', folder: FOLDER, newCount: 2 });
        await settle();
        await answer(page([row(901), row(902), ...rows(1, 48)]));

        expect(region().scrollTop).toBe(0);
        expect(atTop().subject).toBe('Message 901');
        expect(pill()).toBeNull();
    });

    it('Select all checks the rows loaded, and says how many; nothing more is read', async () => {
        await answer(page(rows(1, 50)));
        await leaveBelow(VIEW);
        await answer(page(rows(51, 100)));
        await leaveBelow(VIEW);
        await answer(page(rows(101, 150)));
        const count = asked.length;

        drawn()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        await settle();
        el().querySelector<HTMLElement>('[data-test="bulk-select-all"]')!.click();
        await settle();

        expect(pageOf().selectedCount()).toBe(150);
        expect(el().querySelector('[data-test="bulk-clear"]')?.getAttribute('aria-label')).toBe('Clear selection (150 selected)');
        expect(asked.length).withContext('no whole-folder selection, no page read for it').toBe(count);
    });

    it('keeps keyboard focus and the open message\'s row through scrolling out of view and back', async () => {
        await answer(page(rows(1, 200)));
        const main = rowOf('Message 2')!.querySelector<HTMLElement>('[data-part="main"]')!;
        main.click();
        main.focus();
        await settle();
        expect(pageOf().selectedMessage()?.id).toBe('m-2');

        await scrollTo(120 * h());
        expect(rowOf('Message 2')).withContext('scrolled out of the page').toBeUndefined();
        expect(document.activeElement).withContext('focus stays in the list, not lost to the body').toBe(region());

        await scrollTo(0);
        const back = rowOf('Message 2')!;
        expect(document.activeElement).withContext('focus back on the same control').toBe(back.querySelector('[data-part="main"]'));
        expect(back.classList.contains('mbx__row--active')).withContext('still the open message').toBeTrue();
        expect(back.getAttribute('aria-current')).toBe('true');
    });

    it('once the folder\'s pages are read, scrolling on asks nothing more: no Older section, no button', async () => {
        await answer(page(rows(1, 50)));
        await leaveBelow(VIEW);
        await answer(page(rows(51, 60)));
        expect(el().querySelector('[data-test="load-older"]')).toBeNull();

        const count = asked.length;
        await leaveBelow(0);
        expect(asked.length).withContext('the last page was read').toBe(count);
        expect(olderAsked).withContext('the older mail is the cursor\'s, not a second read').toBe(0);
        expect(el().querySelector('app-mail-server-search')).toBeNull();
    });

    it('the search results load more as they are scrolled, with the same end row', async () => {
        pageOf().runSearch('report');
        await settle();
        searches[0].reply.next(Array.from({ length: 20 }, (_, i) => hit(i + 1)));
        await settle();
        region().scrollTop = region().scrollHeight;
        await settle();

        expect(searches.map(s => s.page)).toEqual([1, 2]);
        expect(loadingRow()?.textContent?.trim()).toBe('Loading...');
        searches[1].reply.error(failure(500));
        await settle();
        expect(endRow()?.textContent).toContain('Couldn\'t load');
        endRow()!.querySelector<HTMLElement>('[data-test="list-end-retry"]')!.click();
        await settle();
        expect(searches.map(s => s.page)).withContext('the same page again').toEqual([1, 2, 2]);
    });
});
