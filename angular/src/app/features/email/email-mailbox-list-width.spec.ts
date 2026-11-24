import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
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
import { type EmailMailboxDto, type EmailMessageDto, type EmailMessageList } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MAIL_PANE_CACHE_KEYS } from './mail-panes.directive';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';
const LONG = 'A very long line that runs on and on '.repeat(12).trim();

const stored = (id: string, subject: string, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null, sentAt: '2026-11-11T09:00:00+00:00', ...extra,
});
const server = (ref: string, subject: string, extra: Record<string, unknown> = {}): EmailMessageDto => ({
    mailboxId: 'mb1', folder: FOLDER, uid: 7, subject, fromAddress: 'b@example.test', seen: false, flagged: false,
    fromServer: true, ref, sentAt: '2026-11-11T08:00:00+00:00', ...extra,
}) as unknown as EmailMessageDto;
const page = (rows: EmailMessageDto[]): EmailMessageList => Object.assign([...rows], { next: null, serverPages: null });

/**
 * A row of the message list is the list's width, however long its sender, subject and snippet: those end in an
 * ellipsis, the star and the date stay in view at the right, and the list never scrolls sideways. A server row lines
 * up with a stored one. Real layout in the browser, at the grid's widths with three panes and with two.
 */
describe('EmailMailboxPageComponent -- the list\'s rows fit the list', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;

    beforeEach(() => {
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: 3, unseen: 1 }], canCreateTop: false, held: false }),
                        listMessages: () => of(page([
                            stored('m-1', LONG, { fromName: LONG, snippet: LONG, flagged: true }),
                            server('r-2', LONG, { fromName: LONG, snippet: LONG }),
                            stored('m-3', 'Short', { snippet: 'Short', hasAttachments: true }),
                        ])),
                        olderMessages: () => NEVER,
                        listThread: () => of([]),
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
                {
                    provide: DateTimeFormatService,
                    useValue: { row: () => '11 Nov 2026, 09:00', auto: () => '11 Nov 2026, 09:00', date: () => '', time: () => '', dateTime: () => '' },
                },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {} } },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
    });
    afterEach(() => {
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const rows = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('.mbx__row'));
    const box = (e: Element): DOMRect => e.getBoundingClientRect();
    /** The ResizeObserver's answer, the virtual viewport's draw after a microtask and a frame, and the redraws. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 20)));
        }
        fixture.detectChanges();
    }
    /** The page in a box this wide (the grid takes its whole width), the folder's rows drawn. */
    async function render(width: number): Promise<void> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        el().style.cssText = `display: flex; flex-direction: column; width: ${width}px; height: 700px`;
        document.body.appendChild(el());
        await settle();
        fixture.componentInstance.selectFolder(FOLDER);
        await settle();
    }

    it('the page header spans the page: the envelope, Mail, Compose filled and More with the tree\'s other actions', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const opened = spyOn(page, 'openCompose');
        page.headerActions.set([
            { id: 'add-mailbox', icon: 'plus-lg', label: 'Add mailbox' },
            { id: 'module-settings', icon: 'gear', label: 'Mail settings' },
            { id: 'import', icon: 'upload', label: 'Import', title: 'Import a file', disabled: true, refusal: 'An import is running.' },
            { id: 'compose', icon: 'pencil-square', label: 'Compose', primary: true },
        ]);
        await settle();
        const header = part('[data-test="page-header"]');
        expect(header.parentElement!.classList).withContext('the header is the page\'s, above the grid').toContain('mbx');
        expect(el().querySelector('.mbx__rail [data-test="page-header"], .mbx__rail cms-section-head')).withContext('no head in the folder column').toBeNull();
        const band = header.querySelector<HTMLElement>('.page-header')!;
        expect(box(band).width).withContext('the page\'s width').toBeCloseTo(box(el()).width, 0);
        expect(box(band).bottom).withContext('the grid starts under the header').toBeLessThanOrEqual(box(part('.mbx__body')).top);
        expect(header.querySelector('.bi-envelope')).not.toBeNull();
        expect(header.querySelector('h1')!.textContent!.trim()).withContext('the section name before the tree answers').toBe('Mail');
        page.treeTitle.set('Mail (tree)');
        await settle();
        expect(header.querySelector('h1')!.textContent!.trim()).withContext('the title node of the tree').toBe('Mail (tree)');

        const compose = header.querySelector<HTMLElement>('[data-action="primary"]')!;
        expect(compose.textContent?.trim()).toBe('Compose');
        expect(compose.classList).withContext('filled').toContain('cms-btn-primary');
        expect(header.querySelectorAll('.cms-btn-primary').length).withContext('one filled button').toBe(1);
        compose.click();
        expect(opened).toHaveBeenCalledTimes(1);

        const menu = Object.assign(TestBed.inject(ContextMenuService), {
            openFrom: jasmine.createSpy('openFrom'), menu: () => null, close: (): void => {},
        }) as unknown as { openFrom: jasmine.Spy };
        header.querySelector<HTMLElement>('[data-action="more"]')!.click();
        const items = menu.openFrom.calls.mostRecent().args[1] as { id: string; label: string; disabled: boolean; refusal?: string }[];
        expect(items.map(i => i.label)).withContext('More holds the others, in the tree\'s order').toEqual(['Add mailbox', 'Mail settings', 'Import']);
        expect(items[2]).toEqual(jasmine.objectContaining({ disabled: true, refusal: 'An import is running.' }));

        // A tree that offers no Compose draws none.
        page.headerActions.set([{ id: 'add-mailbox', icon: 'plus-lg', label: 'Add mailbox' }]);
        await settle();
        expect(el().querySelector('[data-action="primary"]')).toBeNull();
    });

    it('the mailbox card heads the folder column, level with the list\'s first row', async () => {
        await render(1440);
        const card = part('.mbx__rail [data-test="rail-card"]');
        expect(card.querySelector('app-mailbox-switcher')).not.toBeNull();
        const rail = part('.mbx__rail');
        const first = [...rail.children].find(e => getComputedStyle(e).display !== 'none');
        expect(first).withContext('the card is the column\'s first element').toBe(card);
        expect(Math.round(box(card).top)).toBe(Math.round(box(part('.mbx__list')).top));
    });

    it('a disabled Compose stays filled in the header with the tree\'s reason', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const opened = spyOn(page, 'openCompose');
        page.headerActions.set([
            { id: 'compose', icon: 'pencil-square', label: 'Compose', primary: true, disabled: true, refusal: 'Sign in to this mailbox again.' },
        ]);
        await settle();
        const compose = part('[data-test="page-header"] [data-action="primary"]');
        expect(compose.getAttribute('aria-disabled')).toBe('true');
        expect(compose.getAttribute('title')).toBe('Sign in to this mailbox again.');
        compose.click();
        expect(opened).not.toHaveBeenCalled();
    });

    it('over the list: the search, then the chips All, Unread and Attachments, All chosen', async () => {
        await render(1440);
        const search = part('[data-test="mail-search"]');
        const chips = part('[data-test="mail-chips"]');
        expect(box(chips).top).withContext('the chips under the search').toBeGreaterThanOrEqual(box(search).bottom);
        expect(box(chips).bottom).withContext('the rows under the chips').toBeLessThanOrEqual(box(part('[data-test="list-scroll"]')).top + 1);
        const labels = [...chips.querySelectorAll('[role="radio"]')].map(c => c.textContent!.trim());
        expect(labels).toEqual(['All', 'Unread', 'Attachments']);
        expect(chips.querySelector('[data-chip="all"]')!.getAttribute('aria-checked')).toBe('true');
    });

    it('a chip keeps the rows it names: Unread the unseen, Attachments those with some, All every one', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const subjects = (): string[] => rows().map(r => r.querySelector('.mbx__row-subject')!.textContent!.trim());
        const choose = async (id: string): Promise<void> => {
            part(`[data-test="mail-chips"] [data-chip="${id}"]`).click();
            await settle();
        };
        expect(rows().length).toBe(3);

        await choose('unread');
        expect(page.listFilter()).toBe('unread');
        expect(rows().length).withContext('the unseen server row only').toBe(1);
        expect(rows()[0].getAttribute('data-ref')).toBe('r-2');

        await choose('attachments');
        expect(subjects()).toEqual(['Short']);

        await choose('all');
        expect(rows().length).toBe(3);
    });

    it('a chip that keeps none of a read-to-its-end folder says so; checked rows are cleared on a choice', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        page.selectAllLoaded();
        expect(page.selectedCount()).toBe(2);
        page.messages.update(list => list.map(m => ({ ...m, seen: true })));
        part('[data-test="mail-chips"] [data-chip="unread"]').click();
        await settle();
        expect(page.selectedCount()).toBe(0);
        expect(rows().length).toBe(0);
        expect(part('[data-test="mail-filter-empty"]').textContent).toContain('No unread messages');
    });

    it('the chips wrap onto a line below rather than scroll or cut', async () => {
        await render(1440);
        const chips = part('[data-test="mail-chips"]');
        const group = chips.querySelector<HTMLElement>('[role="radiogroup"]')!;
        expect(getComputedStyle(group).flexWrap).toBe('wrap');
        expect(getComputedStyle(group).overflowX).withContext('no scroller of their own').toBe('visible');
        expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
    });

    it('the message pane draws no empty row: with no message open no action row, its content at the top', async () => {
        await render(1440);
        expect(el().querySelector('[data-test="detail-header-row"]')).toBeNull();
        expect(el().querySelector('[data-test="detail-folders-bar-row"]')).toBeNull();
        expect(el().querySelector('[data-test="detail-row"]')).withContext('nothing to act on, no row').toBeNull();
        const scroll = part('[data-test="detail-scroll"]');
        const pane = scroll.parentElement!;
        const before = [...pane.children].slice(0, [...pane.children].indexOf(scroll))
            .filter(e => getComputedStyle(e).display !== 'none' && (e as HTMLElement).offsetHeight > 0);
        expect(before.map(e => e.className)).withContext('nothing drawn above the scroll region').toEqual([]);
    });

    it('the primary flag of the tree decides the primary; Compose stands in only while none is marked', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const primary = (): string | undefined => page.pageActions().find(a => a.primary === true)?.id;
        page.headerActions.set([
            { id: 'add-mailbox', icon: 'plus-lg', label: 'Add mailbox', primary: true },
            { id: 'compose', icon: 'pencil-square', label: 'Compose' },
        ]);
        expect(primary()).toBe('add-mailbox');
        await settle();
        expect(part('[data-test="page-header"] [data-action="primary"]').textContent?.trim()).toBe('Add mailbox');
        page.headerActions.set([
            { id: 'add-mailbox', icon: 'plus-lg', label: 'Add mailbox' },
            { id: 'compose', icon: 'pencil-square', label: 'Compose' },
        ]);
        expect(primary()).toBe('compose');
    });

    it('tells the tree when the selected mailbox needs a new sign-in, so Compose is declared disabled', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const id = page.selectedMailboxId()!;
        expect(page.toolbarContext()['_mailboxNeedsReconnect']).toBeFalse();
        page.mailboxes.update(list => list.map(m => (m.id === id ? { ...m, connectionNeedsSignIn: true } : m)));
        expect(page.toolbarContext()['_mailboxNeedsReconnect']).toBeTrue();
    });

    it('with two panes the page header still spans the page, Compose in it', async () => {
        await render(760);
        const page = fixture.componentInstance;
        page.headerActions.set([{ id: 'compose', icon: 'pencil-square', label: 'Compose', primary: true }]);
        await settle();
        const header = part('[data-test="page-header"]');
        expect(header.querySelector('[data-action="primary"]')!.textContent?.trim()).toBe('Compose');
        expect(box(header).width).toBeCloseTo(box(el()).width, 0);
    });

    it('the empty reading pane says what the message tree declares for it, and its own words until then', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const pane = (): string => (part('[data-test="empty-pane"]').textContent ?? '').replace(/\s+/g, ' ').trim();
        expect(pane()).toContain('No message selected');
        expect(pane()).toContain('Pick a message from the list to read it.');

        // Shown only while the pane states _empty: the tree's condition names it.
        const graph = TestBed.inject(NaviGraphService) as unknown as { matchesShowWhen: (when: unknown, facts: Record<string, unknown>) => boolean };
        graph.matchesShowWhen = (_when, facts) => facts['_empty'] === true;
        const empty = {
            id: '/empty', path: '/empty', title: 'Empty', parentId: null, sortOrder: 0, isActive: true, isVisible: true, children: [],
            meta: { action: 'empty', label: 'Nothing open', description: 'Choose a message on the left.', icon: 'envelope-open',
                showWhen: { field: '_empty', op: 'eq', value: true } },
        };
        page.messageNodes.set([empty as never]);
        await settle();
        expect(pane()).toContain('Nothing open');
        expect(pane()).toContain('Choose a message on the left.');
        expect(pane()).not.toContain('No message selected');

        // A condition that does not hold keeps the pane's own words.
        graph.matchesShowWhen = () => false;
        page.messageNodes.set([{ ...empty } as never]);
        await settle();
        expect(pane()).toContain('No message selected');
    });

    for (const width of [1440, 760]) {
        it(`at ${width}px a row with a very long sender, subject and snippet is the list's width, nothing scrolls sideways`, async () => {
            await render(width);
            const list = part('.mbx__list');
            const region = part('[data-test="list-scroll"]');
            const viewport = part('[data-test="list-rows"]');
            const listBox = box(list);
            expect(rows().length).withContext('the rows are drawn').toBe(3);
            expect(listBox.width).withContext('the list is laid out').toBeGreaterThan(200);

            expect(viewport.scrollWidth).withContext('the rows viewport overflows nothing sideways').toBe(viewport.clientWidth);
            expect(region.scrollWidth).withContext('the list\'s scroll region has no sideways scroll').toBe(region.clientWidth);

            const [long, fromServer] = rows();
            expect(box(long).width).withContext('the row is the list\'s width').toBe(region.clientWidth);
            expect(box(long).right).withContext('the row\'s right edge is within the list').toBeLessThanOrEqual(listBox.right);

            const inside = (e: HTMLElement, what: string): void => {
                const b = box(e);
                expect(b.width).withContext(`${what} has a size`).toBeGreaterThan(0);
                expect(b.left).withContext(`${what}'s left`).toBeGreaterThanOrEqual(listBox.left);
                expect(b.right).withContext(`${what}'s right`).toBeLessThanOrEqual(listBox.right);
            };
            inside(long.querySelector<HTMLElement>('[data-part="star"]')!, 'the star');
            inside(long.querySelector<HTMLElement>('.mbx__row-date')!, 'the date');

            for (const cls of ['.mbx__row-from', '.mbx__row-subject', '.mbx__row-snippet']) {
                const text = long.querySelector<HTMLElement>(cls)!;
                const style = getComputedStyle(text);
                expect(style.textOverflow).withContext(`${cls} ends in an ellipsis`).toBe('ellipsis');
                expect(text.scrollWidth).withContext(`${cls} is clipped`).toBeGreaterThan(text.clientWidth);
                inside(text, cls);
            }

            // The server row's empty room keeps its sender, subject and date in line with the stored row's.
            const at = (r: HTMLElement, cls: string): DOMRect => box(r.querySelector(cls)!);
            // Three lines at every width: the preview on a line of its own, under the subject; the row the three-line height.
            expect(at(long, '.mbx__row-snippet').top).withContext('the preview under the subject')
                .toBeGreaterThanOrEqual(at(long, '.mbx__row-subject').bottom - 1);
            expect(at(long, '.mbx__row-snippet').left).withContext('starting where it starts').toBe(at(long, '.mbx__row-subject').left);
            expect(box(long).height).withContext('the three-line row').toBe(84);

            expect(box(fromServer).width).withContext('the server row is the list\'s width').toBe(region.clientWidth);
            expect(at(fromServer, '.mbx__row-from').left).toBe(at(long, '.mbx__row-from').left);
            expect(at(fromServer, '.mbx__row-subject').left).toBe(at(long, '.mbx__row-subject').left);
            expect(at(fromServer, '.mbx__row-subject').right).toBe(at(long, '.mbx__row-subject').right);
            expect(at(fromServer, '.mbx__row-date').right).toBe(at(long, '.mbx__row-date').right);
        });
    }
});
