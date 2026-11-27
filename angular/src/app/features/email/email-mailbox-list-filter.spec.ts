import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of, Subject, throwError } from 'rxjs';
import { AppConfigState, AuthState, ErrorHandlerService, type NaviGraphNode, NaviGraphService } from '@coolms/core-angular';
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
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const row = (id: string, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: 'INBOX', subject: id, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null, sentAt: '2026-11-11T09:00:00+00:00', ...extra,
});
const ROWS = [row('read'), row('unread', { seen: false }), row('files', { hasAttachments: true })];
const node = (path: string, meta: Record<string, unknown>): NaviGraphNode => ({
    id: 'n' + path, path, title: String(meta['label'] ?? ''), parentId: null, sortOrder: 0, isActive: true, isVisible: true, children: [], meta,
}) as unknown as NaviGraphNode;
const REFRESH = node('/refresh', { action: 'refresh', label: 'Refresh', icon: 'arrow-clockwise', group: 'list' });
/** The list's tree with its filters, the default not the first. */
const FILTERS = [
    node('/filter-attachments', { label: 'With files', action: 'filter', group: 'filters', value: 'attachments' }),
    node('/filter-all', { label: 'Everything', action: 'filter', group: 'filters', value: 'all', default: true }),
    node('/filter-unread', { label: 'Not read', action: 'filter', group: 'filters', value: 'unread' }),
];

/** The message list's filter: its choices from the list's tree alone; none declared, no filter. */
describe('EmailMailboxPageComponent -- the list\'s filter from its tree', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let listTree: () => Observable<NaviGraphNode[]>;
    let hidden: string[];
    let menu: { openFrom: jasmine.Spy; openFromNodes: () => void; menu: () => null; close: () => void };
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const button = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-test="mail-filter"] button');
    const keys = (): string[] => fixture.componentInstance.shownMessages().map(m => m.id ?? '');
    const choices = (): { id: string; label: string; checked: boolean }[] => {
        button()!.click();
        return menu.openFrom.calls.mostRecent().args[1] as { id: string; label: string; checked: boolean }[];
    };
    const choose = async (id: string): Promise<void> => {
        choices();
        (menu.openFrom.calls.mostRecent().args[2] as (id: string) => void)(id);
        await settle();
    };
    const settle = async (): Promise<void> => {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await new Promise(r => setTimeout(r, 30));
        }
        fixture.detectChanges();
    };
    async function render(): Promise<void> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        el().style.cssText = 'display: flex; flex-direction: column; width: 1440px; height: 700px';
        document.body.appendChild(el());
        await settle();
        fixture.componentInstance.selectFolder('INBOX');
        await settle();
    }

    beforeEach(() => {
        listTree = () => of([REFRESH, ...FILTERS]);
        hidden = [];
        menu = { openFrom: jasmine.createSpy('openFrom'), openFromNodes: () => undefined, menu: () => null, close: () => undefined };
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [{ folder: 'INBOX', name: 'Inbox', selectable: true, children: [], total: 3, unseen: 1 }], canCreateTop: false, held: false }),
                        listMessages: (): Observable<EmailMessageList> => of(Object.assign([...ROWS], { next: null, serverPages: null })),
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
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' }
                            : sel === AppConfigState.manifest ? { navi: { graphBySlug: '/api/v1/navi/trees/{slug}/graph' } } : null),
                    },
                },
                {
                    provide: NaviGraphService,
                    useValue: {
                        loadTree: (url: string) => (url.includes('/navi.toolbar.email.list/') ? listTree() : of([])),
                        isVisible: (n: NaviGraphNode) => !hidden.includes(n.path),
                        matchesShowWhen: () => false,
                    },
                },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: menu },
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

    it('with filter nodes: the tree\'s choices by its labels, in its order, its default current', async () => {
        await render();
        expect(choices().map(c => [c.id, c.label, c.checked])).toEqual([
            ['attachments', 'With files', false], ['all', 'Everything', true], ['unread', 'Not read', false],
        ]);
        expect(button()!.getAttribute('aria-label')).toBe('Show: Everything');
        expect(button()!.querySelector('.bi-funnel')).withContext('the marked default, though not the first').not.toBeNull();
        expect(keys()).toEqual(['read', 'unread', 'files']);

        await choose('unread');
        expect(button()!.textContent!.trim()).toBe('Not read');
        expect(keys()).toEqual(['unread']);
        await choose('attachments');
        expect(keys()).toEqual(['files']);
    });

    it('with filter nodes the list\'s actions are as before: the filters are none of them', async () => {
        await render();
        expect(fixture.componentInstance.listActions().map(a => a.id)).toEqual(['refresh']);
    });

    /** No filter button, and every row whatever value the page kept. */
    async function unfiltered(): Promise<void> {
        expect(button()).toBeNull();
        expect(keys()).toEqual(['read', 'unread', 'files']);
        fixture.componentInstance.chosenListFilter.set('unread');
        await settle();
        expect(button()).toBeNull();
        expect(keys()).withContext('a kept value').toEqual(['read', 'unread', 'files']);
        expect(fixture.componentInstance.titleFilter()).toBe('');
        expect(el().querySelector('[data-test="list-name"]')!.textContent!.trim()).withContext('the row stays, with the name').toBe('Inbox');
    }

    it('without filter nodes: no button, and every row', async () => {
        listTree = () => of([REFRESH]);
        await render();
        await unfiltered();
    });

    it('with the tree not loading: no button, and every row', async () => {
        listTree = () => throwError(() => new Error('unavailable'));
        await render();
        await unfiltered();
        expect(fixture.componentInstance.listActions()).withContext('the tree serves no action').toEqual([]);
        const email = TestBed.inject(EmailService) as unknown as { syncMailbox: jasmine.Spy };
        email.syncMailbox = jasmine.createSpy('syncMailbox').and.returnValue(of({ syncId: 's1' }));
        const refresh = el().querySelector<HTMLButtonElement>('app-mailbox-sync [data-action="refresh"]')!;
        expect(refresh).withContext('the list keeps its own Refresh').not.toBeNull();
        refresh.click();
        expect(email.syncMailbox).toHaveBeenCalledOnceWith('mb1');
    });

    it('before the tree answers there is no button; once it has, its filters, and a value it does not have reads as the default', async () => {
        const late = new Subject<NaviGraphNode[]>();
        listTree = () => late;
        await render();
        expect(button()).toBeNull();
        late.next([REFRESH, ...FILTERS]);
        await settle();
        await choose('unread');
        expect(keys()).toEqual(['unread']);

        late.next([REFRESH, ...FILTERS.slice(0, 2)]);
        await settle();
        expect(fixture.componentInstance.listFilter()).toBe('all');
        expect(keys().length).toBe(3);
    });

    it('the chosen one stays while it is chosen, though its node is no longer shown', async () => {
        const answers = new Subject<NaviGraphNode[]>();
        listTree = () => answers;
        await render();
        answers.next([REFRESH, ...FILTERS]);
        await settle();
        await choose('unread');
        hidden = ['/filter-unread'];
        answers.next([REFRESH, ...FILTERS]);
        await settle();
        expect(choices().map(c => c.id)).toEqual(['attachments', 'all', 'unread']);
        expect(keys()).toEqual(['unread']);
        await choose('all');
        expect(choices().map(c => c.id)).toEqual(['attachments', 'all']);
    });

    it('a tree whose filters are all hidden but the default has no filter', async () => {
        hidden = FILTERS.map(n => n.path);
        await render();
        expect(button()).toBeNull();
        expect(keys().length).toBe(3);
    });

    it('a choice whose value the page cannot apply is not in the menu', async () => {
        listTree = () => of([node('/filter-x', { label: 'Pinned', action: 'filter', value: 'pinned' }), ...FILTERS]);
        await render();
        expect(choices().map(c => c.id)).toEqual(['attachments', 'all', 'unread']);
        fixture.componentInstance.chosenListFilter.set('pinned');
        await settle();
        expect(fixture.componentInstance.listFilter()).toBe('all');
        expect(keys().length).toBe(3);
    });

    it('a marked default the page cannot apply: no button, and every row, whatever value was kept', async () => {
        listTree = () => of([node('/filter-x', { label: 'Pinned', action: 'filter', value: 'pinned', default: true }), FILTERS[0], FILTERS[2]]);
        await render();
        await unfiltered();
    });

    it('a marked default that is not shown is still a choice and the default: the list is not filtered from the start', async () => {
        hidden = ['/filter-all'];
        await render();
        expect(choices().map(c => [c.id, c.checked])).toEqual([['attachments', false], ['all', true], ['unread', false]]);
        expect(keys()).toEqual(['read', 'unread', 'files']);
    });

    it('with fewer than two choices left there is no button, and every row, whatever value was kept', async () => {
        listTree = () => of([FILTERS[2], node('/filter-x', { label: 'Pinned', action: 'filter', value: 'pinned' })]);
        await render();
        await unfiltered();
    });
});
