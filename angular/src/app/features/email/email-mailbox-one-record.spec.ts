import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of, Subject } from 'rxjs';
import { type NaviGraphNode, NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    DraftStoreService,
    type PaneToolbarAction,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import type { EmailBulkResultDto, EmailMailboxDto, EmailMessageDetailDto, EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * One record per message: the open message's toolbar, a row's menu and the checked-rows bar read the same list row,
 * which takes the detail's state when it arrives and every realtime change. And an action pressed shows busy where it
 * was pressed, the row's others disabled, and is not run again until the server answers. Built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- one record per message, busy at once', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;
    /** The server's nodes, each shown when its facts say so, as the tree does. */
    const node = (action: string, showWhen: Record<string, unknown> = {}): NaviGraphNode =>
        ({ path: `navi.toolbar.email.message.${action}`, title: action, meta: { action, label: action, icon: 'star', group: 'g', showWhen } } as unknown as NaviGraphNode);
    const NODES = [
        node('reply-all', { _replyAll: true }),
        node('archive', { _anyCanArchive: true }),
        node('delete'),
        node('mark-read', { _anyUnread: true }),
        node('star', { _anyUnflagged: true }),
        node('unstar', { _anyFlagged: true }),
    ];
    const matches = (cond: Record<string, unknown> | null | undefined, rec: Record<string, unknown>): boolean =>
        Object.entries(cond ?? {}).every(([k, v]) => rec[k] === v);

    let listed: EmailMessageDto[];
    let detailOf: (id: string) => Partial<EmailMessageDetailDto>;
    let menuRecord: Record<string, unknown> | null;
    let archives: string[];
    let archiveAnswers: Subject<{ id: string; folder: string }>;
    let flags: string[];
    let flagAnswers: Subject<unknown>;

    function build(): EmailMailboxPageComponent {
        menuRecord = null;
        archives = [];
        flags = [];
        archiveAnswers = new Subject();
        flagAnswers = new Subject();
        const noop = (): void => undefined;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of(listed),
                        getMessage: (id: string) => of({ ...listed.find(m => m.id === id)!, ...detailOf(id), bodyText: 'Hello' }),
                        listThread: () => of([]),
                        markSeen: () => of(null),
                        markFlagged: (id: string) => {
                            flags.push(id);
                            return flagAnswers;
                        },
                        archiveMessage: (id: string): Observable<{ id: string; folder: string }> => {
                            archives.push(id);
                            return archiveAnswers;
                        },
                        archiveMessages: (): Observable<EmailBulkResultDto> => NEVER,
                        deleteMessages: (): Observable<EmailBulkResultDto> => NEVER,
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS },
                },
                { provide: ToastService, useValue: { error: noop, success: noop, info: noop, show: () => 1 } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                {
                    provide: NaviGraphService,
                    useValue: {
                        isVisible: (n: NaviGraphNode, rec: Record<string, unknown>) => matches(n.meta['showWhen'] as Record<string, unknown>, rec),
                        matchesShowWhen: matches,
                    },
                },
                {
                    provide: ContextMenuService,
                    useValue: {
                        openFromNodes: (_e: MouseEvent, _n: NaviGraphNode[], record: Record<string, unknown>) => {
                            menuRecord = record;
                        },
                    },
                },
                { provide: CrumbNamesService, useValue: { setTail: noop } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.mailboxes.set([MAILBOX]);
        page.selectedMailboxId.set('mb1');
        page.selectedFolder.set('INBOX');
        page.retryMessages();
        page.messageNodes.set(NODES);

        return page;
    }

    const open = (page: EmailMailboxPageComponent, id: string): void => page.openMessage(page.messages().find(m => m.id === id)!);
    const shown = (actions: readonly PaneToolbarAction[]): string[] => actions.map(a => a.id);
    const menuFor = (page: EmailMailboxPageComponent, id: string): Record<string, unknown> => {
        page.onMessageRowContextMenu(new MouseEvent('contextmenu'), page.messages().find(m => m.id === id)!);
        return menuRecord!;
    };

    beforeEach(() => {
        listed = [
            { id: 'm1', folder: 'INBOX', subject: 'One', seen: true, flagged: false, canArchive: false },
            { id: 'm2', folder: 'INBOX', subject: 'Two', seen: true, flagged: false, canArchive: true },
        ];
        detailOf = () => ({});
    });

    it('the list says it cannot be archived and the detail says it can: the toolbar and the menu both show Archive', () => {
        detailOf = id => (id === 'm1' ? { canArchive: true } : {});
        const page = build();

        open(page, 'm1');

        expect(page.messages().find(m => m.id === 'm1')?.canArchive).withContext('the row took the detail state').toBeTrue();
        expect(shown(page.detailActions())).toContain('archive');
        expect(menuFor(page, 'm1')['_anyCanArchive']).withContext('the row menu').toBeTrue();
        page.selectedIds.set(new Set(['m1']));
        expect(shown(page.bulkActions())).withContext('the checked-rows bar').toContain('archive');
    });

    it('the list says Reply all is of no use (null) and the detail says it is: the toolbar and the row menu both show it', () => {
        listed = listed.map(m => ({ ...m, replyAllUseful: null }));
        detailOf = id => (id === 'm2' ? { replyAllUseful: true } : {});
        const page = build();
        expect(menuFor(page, 'm2')['_replyAll']).withContext('the row menu before the detail').toBeFalse();

        open(page, 'm2');

        expect(page.messages().find(m => m.id === 'm2')?.replyAllUseful).withContext('the row took the detail state').toBeTrue();
        expect(shown(page.detailActions())).toContain('reply-all');
        expect(menuFor(page, 'm2')['_replyAll']).withContext('the row menu').toBeTrue();
    });

    it('the list says it can be archived and the detail says it cannot: neither shows Archive', () => {
        detailOf = id => (id === 'm2' ? { canArchive: false } : {});
        const page = build();

        open(page, 'm2');

        expect(shown(page.detailActions())).not.toContain('archive');
        expect(menuFor(page, 'm2')['_anyCanArchive']).withContext('the row menu').toBeFalse();
    });

    it('the toolbar reads the list row: a realtime flag change reaches the toolbar and the menu', () => {
        const page = build();
        open(page, 'm2');
        expect(shown(page.detailActions())).toContain('star');

        const evt = readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'sync', seq: 3,
            changes: [{ id: 'm2', threadId: 't2', folder: 'INBOX', seen: true, flagged: true }], counts: {}, mailboxUnseen: 0,
        }) as MailMessagesChangedEvent;
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(evt);

        expect(shown(page.detailActions())).toContain('unstar');
        expect(shown(page.detailActions())).not.toContain('star');
        expect(menuFor(page, 'm2')['_anyFlagged']).withContext('the row menu').toBeTrue();
    });

    it('Archive pressed is not run again on that message until the server answers; the next message opened is its own', () => {
        const page = build();
        open(page, 'm2');

        page.onDetailAction('archive');
        page.onMessageAction('archive', ['m2']);

        expect(archives).withContext('one call while it waits').toEqual(['m2']);
        expect(page.pending()?.action).toBe('archive');
        expect(page.selectedMessage()?.id).withContext('taken out at once: the next one opened').toBe('m1');
        expect(page.detailActions().some(a => a.busy || a.disabled)).withContext("the next message's row").toBeFalse();

        archiveAnswers.error(new Error('offline'));

        expect(page.pending()).toBeNull();
        expect(page.selectedMessage()?.id).withContext('refused: back and open again').toBe('m2');
        expect(page.detailActions().some(a => a.busy || a.disabled)).withContext('after the answer').toBeFalse();
    });

    it('star from the checked-rows bar is busy there and not run again until it is answered', () => {
        const page = build();
        page.selectedIds.set(new Set(['m1', 'm2']));

        page.onBulkAction('star');
        page.onBulkAction('star');

        expect(flags).toEqual(['m1', 'm2']);
        expect(page.bulkActions().filter(a => a.busy).map(a => a.id)).withContext('starred at once: its other state waits').toEqual(['unstar']);
        expect(page.bulkActions().filter(a => !a.busy).every(a => a.disabled === true)).toBeTrue();

        flagAnswers.next(null);
        flagAnswers.complete();

        expect(page.pending()).toBeNull();
    });

    it('a message not in the action pending keeps its row as it is', () => {
        const page = build();
        open(page, 'm1');

        page.onMessageAction('archive', ['m2']);

        expect(archives).toEqual(['m2']);
        expect(page.detailActions().some(a => a.busy || a.disabled)).toBeFalse();
    });
});
