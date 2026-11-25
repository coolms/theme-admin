import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AuthState, ErrorHandlerService, type NaviGraphNode, NaviGraphService } from '@coolms/core-angular';
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

/** The list's filters as its tree serves them. */
const FILTER_NODES = [['all', 'All', true], ['unread', 'Unread', false], ['attachments', 'Attachments', false]].map(([value, label, isDefault], i) => ({
    id: 'n-' + String(value), path: '/filter-' + String(value), title: String(label), parentId: null, sortOrder: 20 + i, isActive: true, isVisible: true, children: [],
    meta: { action: 'filter', group: 'filters', value, label, ...(isDefault === true ? { default: true } : {}) },
})) as unknown as NaviGraphNode[];

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
        fixture.componentInstance.listNodes.set(FILTER_NODES);
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

    /** The filter's menu as the page opens it: its choices, and what choosing one does. */
    interface FilterMenu { items: { id: string; label: string; checked: boolean }[]; choose: (id: string) => Promise<void> }
    const filterButton = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-test="mail-filter"] button');
    function openFilter(): FilterMenu {
        const menu = Object.assign(TestBed.inject(ContextMenuService), {
            openFrom: jasmine.createSpy('openFrom'), menu: () => null, close: (): void => {},
        }) as unknown as { openFrom: jasmine.Spy };
        filterButton()!.click();
        const [, items, act] = menu.openFrom.calls.mostRecent().args as [unknown, FilterMenu['items'], (id: string) => void];
        return { items, choose: async id => { act(id); await settle(); } };
    }
    const LONG_FOLDER = 'A folder whose name is far longer than the list column is wide';
    /** The open folder's name, as the folder tree serves it. */
    async function nameFolder(name: string): Promise<void> {
        fixture.componentInstance.folderTree.update(list => (list ?? []).map(f => (f.folder === FOLDER ? { ...f, name } : f)));
        await settle();
    }

    it('the list\'s second row: the folder\'s name at the start, the filter at its end, over the search', async () => {
        await render(1440);
        const row = part('[data-test="list-name-row"]');
        const name = part('[data-test="list-name"]');
        expect(name.textContent!.trim()).toBe('Inbox');
        expect(name.getAttribute('title')).toBe('Inbox');
        expect(box(row).top).withContext('under the list\'s action row').toBeGreaterThanOrEqual(box(part('app-mailbox-sync')).bottom - 1);
        expect(box(part('.mbx__search')).top).withContext('the search under it').toBeGreaterThanOrEqual(box(row).bottom - 1);
        const b = filterButton()!;
        expect(row.contains(b)).toBeTrue();
        expect(el().querySelectorAll('[data-test="mail-filter"]').length).withContext('one filter').toBe(1);
        expect(b.getAttribute('aria-label')).toBe('Show: All');
        expect(b.querySelector('.bi-funnel')).not.toBeNull();
        expect(box(row).right - box(b).right).withContext('at the row\'s end').toBeLessThanOrEqual(12);
        expect(box(name).right).toBeLessThanOrEqual(box(b).left);
        expect(Math.abs((box(b).top + box(b).bottom) / 2 - (box(row).top + box(row).bottom) / 2)).toBeLessThanOrEqual(1);
    });

    it('a long folder name is cut with an ellipsis, its whole text as its title; the filter keeps its place and width', async () => {
        await render(1440);
        await openFilter().choose('attachments');
        const before = box(filterButton()!);
        await nameFolder(LONG_FOLDER);
        const name = part('[data-test="list-name"]');
        expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
        expect(name.scrollWidth).withContext('cut').toBeGreaterThan(name.clientWidth);
        expect(name.getAttribute('title')).toBe(LONG_FOLDER);
        const b = filterButton()!;
        expect(b.textContent!.trim()).toBe('Attachments');
        expect(box(b).right).toBeCloseTo(before.right, 0);
        expect(box(b).width).toBeCloseTo(before.width, 0);
        expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth + 1);
    });

    it('the filter\'s menu holds All, Unread and Attachments, the current one marked; another one is said on the button', async () => {
        await render(1440);
        expect(openFilter().items.map(i => [i.id, i.label, i.checked])).toEqual([
            ['all', 'All', true], ['unread', 'Unread', false], ['attachments', 'Attachments', false],
        ]);
        await openFilter().choose('unread');
        expect(filterButton()!.textContent!.trim()).toBe('Unread');
        expect(filterButton()!.getAttribute('aria-label')).toBe('Show: Unread');
        expect(openFilter().items.filter(i => i.checked).map(i => i.id)).toEqual(['unread']);
    });

    it('a filter keeps the rows it names: Unread the unseen, Attachments those with some, All every one', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        const subjects = (): string[] => rows().map(r => r.querySelector('.mbx__row-subject')!.textContent!.trim());
        expect(rows().length).toBe(3);

        await openFilter().choose('unread');
        expect(page.listFilter()).toBe('unread');
        expect(rows().length).withContext('the unseen server row only').toBe(1);
        expect(rows()[0].getAttribute('data-ref')).toBe('r-2');

        await openFilter().choose('attachments');
        expect(subjects()).toEqual(['Short']);

        await openFilter().choose('all');
        expect(rows().length).toBe(3);
    });

    it('a filter that keeps none of a read-to-its-end folder says so; checked rows are cleared on a choice, the list at its top', async () => {
        await render(1440);
        const page = fixture.componentInstance;
        page.selectAllLoaded();
        expect(page.selectedCount()).toBe(2);
        const top = spyOn(page, 'toListTop').and.callThrough();
        page.messages.update(list => list.map(m => ({ ...m, seen: true })));
        await openFilter().choose('unread');
        expect(top).toHaveBeenCalledTimes(1);
        expect(page.selectedCount()).toBe(0);
        expect(rows().length).toBe(0);
        expect(part('[data-test="mail-filter-empty"]').textContent).toContain('No unread messages');
    });

    it('over search results there is no filter, and the name row stays', async () => {
        await render(1440);
        fixture.componentInstance.searchActive.set(true);
        await settle();
        expect(filterButton()).toBeNull();
        expect(part('[data-test="list-name"]').textContent!.trim()).toBe('Inbox');
    });

    for (const width of [400, 760]) {
        it(`at ${width}px the folders bar names the folder: no second row, the filter an icon beside the search`, async () => {
            await render(width);
            expect(el().querySelector('[data-test="list-name-row"]')).toBeNull();
            expect(el().querySelectorAll('[data-test="mail-filter"]').length).withContext('one filter').toBe(1);
            const search = part('.mbx__search');
            const b = filterButton()!;
            expect(search.contains(b)).toBeTrue();
            expect(b.textContent!.trim()).toBe('');
            expect(box(b).left).toBeGreaterThanOrEqual(box(part('[data-test="mail-search"]')).right);
            expect(part('[data-test="phone-title"]').textContent!.trim()).toBe('Inbox');

            await openFilter().choose('unread');
            expect(filterButton()!.textContent!.trim()).withContext('still an icon').toBe('');
            expect(filterButton()!.classList).withContext('with the accent').toContain('cms-filter-menu--active');
            expect(part('[data-test="phone-title"]').textContent!.trim()).toBe('Inbox \u00b7 Unread');
            expect(part('[data-test="phone-title"]').getAttribute('title')).toBe('Inbox \u00b7 Unread');

            // A long name is cut first; the filter's name stays whole.
            await nameFolder(LONG_FOLDER);
            const label = part('[data-test="phone-title"] .mbx__phone-bar-label');
            const said = part('[data-test="phone-title"] .mbx__phone-bar-filter');
            expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
            expect(said.scrollWidth).toBeLessThanOrEqual(said.clientWidth + 1);
            expect(box(said).right).toBeLessThanOrEqual(box(part('[data-test="phone-folders"]')).right);

            // With a filter's name longer than the bar, the folder's name goes to nothing, then the filter's is cut.
            const long = 'Messages waiting for an answer from the supplier before Friday afternoon';
            fixture.componentInstance.listNodes.set(FILTER_NODES.map(n => (n.meta['value'] === 'unread' ? { ...n, meta: { ...n.meta, label: long } } : n)));
            await settle();
            expect(part('[data-test="phone-title"]').getAttribute('title')).toBe(LONG_FOLDER + ' \u00b7 ' + long);
            const cut = part('[data-test="phone-title"] .mbx__phone-bar-filter');
            expect(box(part('[data-test="phone-title"] .mbx__phone-bar-label')).width).withContext('no room for the name').toBeLessThan(1);
            expect(cut.scrollWidth).withContext('the filter cut').toBeGreaterThan(cut.clientWidth);
            expect(getComputedStyle(cut).textOverflow).toBe('ellipsis');
            expect(box(cut).width).toBeCloseTo(box(part('[data-test="phone-title"]')).width, 0);
            const bar = box(part('[data-test="phone-folders"]'));
            const icon = box(part('[data-test="phone-folders"] .bi-chevron-down'));
            expect(box(cut).right).toBeLessThanOrEqual(icon.left);
            expect(bar.right - icon.right).withContext('the chevron keeps its place').toBeCloseTo(12, 0);
            fixture.componentInstance.listNodes.set(FILTER_NODES);
            await settle();

            // Search results are not filtered, so the title does not say a filter.
            fixture.componentInstance.searchActive.set(true);
            await settle();
            expect(part('[data-test="phone-title"]').textContent!.trim()).toBe(LONG_FOLDER);
            expect(filterButton()).toBeNull();

            fixture.componentInstance.searchActive.set(false);
            await settle();
            await openFilter().choose('all');
            expect(part('[data-test="phone-title"]').textContent!.trim()).toBe(LONG_FOLDER);
        });
    }

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
