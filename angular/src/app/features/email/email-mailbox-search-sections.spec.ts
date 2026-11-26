import { type ComponentFixture, TestBed } from '@angular/core/testing';
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
import type { EmailMailboxDto, EmailMessageDetailDto, EmailMessageList, ServerSearchAnswerDto, ServerSearchHitDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';
/** The list's scroll region, in px: real layout, so an end is in view only where a person would see it. */
const VIEW = 300;
const MAILBOXES: EmailMailboxDto[] = [
    { id: 'mb1', label: 'Work', oauthProvider: 'google', serverSearch: { state: 'supported' } },
    { id: 'mb2', label: 'Home', serverSearch: { state: 'supported' } },
];
const hits = (mailbox: string, from: number, n: number): ServerSearchHitDto[] => Array.from({ length: n }, (_, i) => ({
    ref: `${mailbox}-${from + i}`, folder: FOLDER, uid: from + i, from: { name: `Sender ${from + i}`, address: 's@example.test' },
    subject: `Subject ${from + i}`, date: '2019-03-04T10:00:00+03:00', sizeBytes: 2048, seen: true, flagged: false, local: false, localId: null,
}));

/**
 * The search's sections as a person scrolls them: the open mailbox's results go on by themselves when their end is
 * reached, and the other mailboxes', once pressed for, each go on at their own end. And what the page says of mail
 * that is gone or no longer kept: in the person's mailbox's words.
 */
describe('EmailMailboxPageComponent -- the search sections and the notes', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let asked: string[];
    let replies: Map<string, Subject<ServerSearchAnswerDto>>;
    /** A mailbox's folder tree still to come; with none, it is there at once. */
    let trees: Map<string, Subject<unknown>>;

    beforeEach(() => {
        asked = [];
        replies = new Map();
        trees = new Map();
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of(MAILBOXES),
                        listFolders: () => of([]),
                        folderTree: (mailboxId: string) => trees.get(mailboxId) ?? of({ folders: [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: 1, unseen: 0 }], canCreateTop: false, held: false }),
                        listMessages: (): Observable<EmailMessageList> => of(Object.assign([], { next: null, serverPages: null })),
                        searchMessages: () => of([]),
                        serverSearch: (mailboxId: string, _q: string, cursor: string | null): Observable<ServerSearchAnswerDto> => {
                            asked.push(`${mailboxId} ${cursor ?? 'first'}`);
                            const reply = new Subject<ServerSearchAnswerDto>();
                            replies.set(mailboxId, reply);
                            return reply;
                        },
                        openServerMessage: () => null,
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        getMessage: (id: string): Observable<EmailMessageDetailDto> => of({ id, folder: FOLDER, subject: 'Open' } as EmailMessageDetailDto),
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
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
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
        (fixture.nativeElement as HTMLElement).style.cssText = 'position: fixed; top: 0; left: 0; right: 0; height: 1400px;';
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        region().style.height = `${VIEW}px`;
        region().style.flex = 'none';
        pageOf().selectMailbox('mb1');
        fixture.detectChanges();
        // The region at the window's top, whatever the window's height: what is in its view is in the window's.
        el().style.top = `${-region().getBoundingClientRect().top}px`;
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const pageOf = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const region = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="list-scroll"]')!;
    const sections = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[data-test="server-search"]'));
    const ends = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[data-test="server-search-end"]'));
    const loading = (): string[] => Array.from(el().querySelectorAll('[data-test="server-search-loading"]')).map(p => p.textContent?.trim() ?? '');
    const said = (test: string): string | undefined => el().querySelector(`[data-test="${test}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

    async function frames(until: () => boolean = () => false, most = 120): Promise<void> {
        for (let i = 0; i < most && !until(); i++) {
            fixture.detectChanges();
            await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));
        }
        fixture.detectChanges();
    }
    const reply = async (mailbox: string, n: number, next: string | null, from = 0): Promise<void> => {
        replies.get(mailbox)!.next({ q: 'report', state: 'supported', hits: hits(mailbox, from, n), next, capped: false });
        await frames(() => false, 10);
    };
    /** Scrolls so that `target` is the last thing in the region's view. */
    const scrollTo = (target: HTMLElement): void => {
        const r = region();
        r.scrollTop += target.getBoundingClientRect().bottom - r.getBoundingClientRect().bottom;
    };

    it('the open mailbox\'s results go on at their end, with a row saying so, until they end', async () => {
        pageOf().runSearch('report');
        await reply('mb1', 20, 'c1');
        expect(sections().map(s => s.getAttribute('aria-label'))).toEqual(['More results']);
        expect(asked).withContext('the end is below the view').toEqual(['mb1 first']);

        scrollTo(ends()[0]);
        const seen = { region: region().getBoundingClientRect(), end: ends()[0].getBoundingClientRect() };
        expect(seen.end.bottom).withContext('the end is inside the region, and that inside the window').toBeLessThanOrEqual(seen.region.bottom + 1);
        expect(seen.end.top).toBeGreaterThanOrEqual(seen.region.top);
        expect(seen.region.bottom).toBeLessThanOrEqual(window.innerHeight);
        await frames(() => asked.length > 1);
        expect(asked).toEqual(['mb1 first', 'mb1 c1']);
        expect(loading()).toEqual(['Loading more results…']);
        await frames(() => false, 10);
        expect(asked.length).withContext('one call for the page').toBe(2);

        await reply('mb1', 20, null, 20);
        expect(loading()).toEqual([]);
        expect(ends()).toEqual([]);
        expect(el().querySelectorAll('[data-test="server-hit"]').length).toBe(40);
        region().scrollTop = region().scrollHeight;
        await frames(() => false, 10);
        expect(asked.length).withContext('nothing after the last page').toBe(2);
        pageOf().clearSearch();
    });

    it('the other mailboxes start on a press, and each section goes on at its own end', async () => {
        pageOf().runSearch('report');
        await reply('mb1', 20, 'a1');
        const press = el().querySelector<HTMLButtonElement>('[data-test="server-search-others"]')!;
        expect(press.textContent?.trim()).toBe('Search other mailboxes');
        expect(asked).withContext('not before the press').toEqual(['mb1 first']);
        const head = sections()[0].querySelector<HTMLElement>('.mss__head')!;
        const firstHit = sections()[0].querySelector<HTMLElement>('[data-test="server-hit"]')!;
        expect(Math.abs(press.getBoundingClientRect().top - head.getBoundingClientRect().bottom)).withContext('right under the head').toBeLessThanOrEqual(1);
        expect(firstHit.getBoundingClientRect().top).withContext('above every hit').toBeGreaterThanOrEqual(press.getBoundingClientRect().bottom);

        press.click();
        await frames(() => sections().length > 1);
        await frames(() => false, 5);
        expect(el().querySelector('[data-test="server-search-others"]')).withContext('one press').toBeNull();
        const other = sections()[0].getBoundingClientRect();
        const view = region().getBoundingClientRect();
        expect(other.top).withContext('its section is in view').toBeGreaterThanOrEqual(view.top - 1);
        expect(other.top).toBeLessThan(view.bottom);
        await reply('mb2', 20, 'b1');
        expect(sections().map(s => s.getAttribute('aria-label'))).toEqual(['More results: Home', 'More results']);
        expect(asked).toEqual(['mb1 first', 'mb2 first']);

        // Straight to the open mailbox's end: the other's is above the view, and asks nothing.
        scrollTo(ends()[1]);
        await frames(() => asked.length > 2);
        expect(asked).withContext('the open mailbox\'s own').toEqual(['mb1 first', 'mb2 first', 'mb1 a1']);

        scrollTo(ends()[0]);
        await frames(() => asked.length > 3);
        expect(asked).withContext('the other\'s own').toEqual(['mb1 first', 'mb2 first', 'mb1 a1', 'mb2 b1']);
        pageOf().clearSearch();
    });

    it('a hit of another mailbox names its folder as that mailbox does, never by its path; Inbox before that is known', async () => {
        pageOf().runSearch('report');
        await reply('mb1', 1, null);
        trees.set('mb2', new Subject());
        pageOf().searchOtherMailboxes();
        await reply('mb2', 1, null);
        const chip = (): string => sections()[0].querySelector('[data-test="server-hit"]')!.textContent!.replace(/\s+/g, ' ');
        expect(chip()).withContext('before the names are read').toContain('Inbox');
        expect(chip()).not.toContain('INBOX');
        trees.get('mb2')!.next({ folders: [{ folder: FOLDER, name: 'Entrada', selectable: true, children: [], total: 1, unseen: 0 }], canCreateTop: false, held: false });
        await frames(() => false, 5);
        expect(chip()).toContain('Entrada');
        expect(chip()).not.toContain('INBOX');
        pageOf().clearSearch();
    });

    it('pressed with the head above the view, the other mailbox\'s section is brought into it', async () => {
        pageOf().runSearch('report');
        await reply('mb1', 20, 'a1');
        const press = el().querySelector<HTMLButtonElement>('[data-test="server-search-others"]')!;
        region().scrollTop += press.getBoundingClientRect().top - region().getBoundingClientRect().top;
        await frames(() => false, 3);
        expect(sections()[0].getBoundingClientRect().top).withContext('the head is above the view').toBeLessThan(region().getBoundingClientRect().top - 5);

        press.click();
        await frames(() => sections().length > 1);
        await frames(() => false, 5);
        expect(sections()[0].getAttribute('aria-label')).toBe('More results: Home');
        expect(sections()[0].getBoundingClientRect().top).toBeGreaterThanOrEqual(region().getBoundingClientRect().top - 1);
        pageOf().clearSearch();
    });

    it('a message gone is said deleted in its own mailbox, by the provider the mailbox carries', async () => {
        pageOf().runSearch('report');
        await reply('mb1', 1, null);
        pageOf().searchOtherMailboxes();
        await reply('mb2', 1, null);

        expect(pageOf().mailboxWords('mb1')).toBe('your Gmail mailbox');
        expect(pageOf().mailboxWords('mb2')).toBe('your mailbox');
        expect(pageOf().mailboxWords(null)).toBe('your mailbox');
        expect(pageOf().messageDeletedText()).toBe('This message was deleted in your Gmail mailbox.');
        pageOf().clearSearch();
    });

    it('a copy no longer kept says it is still in the mailbox, and how to open it again', () => {
        pageOf().selectedMessage.set({ id: 'm1', folder: FOLDER, subject: 'Old invoice' } as EmailMessageDetailDto);
        pageOf().openEvicted.set(true);
        fixture.detectChanges();

        expect(said('reader-evicted')).toBe('This message is no longer kept here. It is still in your mailbox: '
            + 'search for it, or scroll to the end of its folder\'s list, to open it again.');
    });
});
