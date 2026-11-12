import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
import {
    CentrifugoClientService,
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    DraftStoreService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { type EmailLiveEvent, EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import { type EmailFolderDto, type EmailFolderTreeNodeDto, type EmailMailboxDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/** A Gmail-like mailbox: one unread message counts in the inbox, Important and All mail. */
const GMAIL: EmailFolderDto[] = [
    { folder: 'INBOX', role: 'inbox', total: 20, unseen: 4, serverTotal: 20, serverUnseen: 5 },
    { folder: '[Gmail]/Important', role: 'system', total: 8, unseen: 3, serverTotal: 8, serverUnseen: 3 },
    { folder: '[Gmail]/All Mail', role: 'all', total: 60, unseen: 9, serverTotal: 60, serverUnseen: 9 },
];

/** Another mailbox whose server counts have not been read: serverUnseen is absent, not null. */
const NOT_COUNTED: EmailFolderDto[] = [
    { folder: 'INBOX', total: 7, unseen: 2 },
    { folder: 'Archive', role: 'archive', total: 30, unseen: 6 },
];

function nodes(folders: EmailFolderDto[]): EmailFolderTreeNodeDto[] {
    return folders.map(f => ({ ...f, name: f.folder, selectable: true, children: [] }));
}

/**
 * The switcher's numbers: a mailbox's unread is its inbox's alone, never a sum of folders. The list's `unread` wins
 * where served; until then the inbox's serverUnseen, else its unseen; a change event moves it by its inbox entry only.
 */
describe('EmailMailboxPageComponent -- a mailbox\'s unread number is its inbox\'s', () => {
    let foldersAsked: string[];
    /** Every request for the mailbox list (GET /api/v1/email/mailboxes). */
    let mailboxesAsked: number;

    function build(mailboxes: EmailMailboxDto[]): EmailMailboxPageComponent {
        foldersAsked = [];
        mailboxesAsked = 0;
        const folders: Record<string, EmailFolderDto[]> = { mb1: GMAIL, mb2: NOT_COUNTED };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => {
                            mailboxesAsked++;
                            return of(mailboxes);
                        },
                        listFolders: (id: string) => {
                            foldersAsked.push(id);
                            return of(folders[id]);
                        },
                        folderTree: (id: string) => of(nodes(folders[id])),
                        listMessages: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: NaviGraphService, useValue: {} },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        localStorage.removeItem('coolms.email.lastMailboxId');

        return TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
    }

    /** An event as an older server sends it: without `mailboxUnseen` unless the test gives one. */
    function changed(page: EmailMailboxPageComponent, event: Partial<MailMessagesChangedEvent>): void {
        const full: MailMessagesChangedEvent = {
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'sync', seq: 1, changes: [], counts: {},
            ...event,
        };
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(full);
    }

    /** New mail announced for a mailbox: mail.received. */
    function received(page: EmailMailboxPageComponent, event: Partial<EmailLiveEvent>): void {
        const full: EmailLiveEvent = { type: 'mail.received', mailboxId: 'mb2', folder: 'INBOX', newCount: 1, ...event };
        (page as unknown as { onMailReceived(e: EmailLiveEvent): void }).onMailReceived(full);
    }

    const WORK: EmailMailboxDto = { id: 'mb1', label: 'Work' };
    const HOME: EmailMailboxDto = { id: 'mb2', label: 'Home' };

    it('a Gmail-like mailbox with unread in Inbox 5, Important 3 and All mail 9 shows 5, not 17', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();

        expect(page.selectedMailboxId()).toBe('mb1');
        expect(page.mailboxUnread()['mb1']).withContext('the inbox alone, after the list and the open mailbox\'s folders').toBe(5);
    });

    it('the fallback is the inbox\'s serverUnseen when present, else its unseen', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();

        expect(page.mailboxUnread()['mb1']).withContext('serverUnseen 5 over unseen 4').toBe(5);
        expect(page.mailboxUnread()['mb2']).withContext('no serverUnseen: the INBOX path\'s unseen, Archive not added').toBe(2);
    });

    it('the unread the mailbox list serves wins when present, and its mailbox\'s folders are not read for it', () => {
        const page = build([{ ...WORK, unread: 11 }, { ...HOME, unread: 0 }]);
        page.loadMailboxes();

        expect(page.mailboxUnread()).toEqual({ mb1: 11, mb2: 0 });
        expect(foldersAsked.filter(id => id === 'mb2')).withContext('no folder read for a served number').toEqual([]);
    });

    it('an event carrying mailboxUnseen 7 sets a served mailbox to 7, with no request for the mailbox list', () => {
        const page = build([{ ...WORK, unread: 11 }, { ...HOME, unread: 2 }]);
        page.loadMailboxes();
        const before = mailboxesAsked;
        expect(before).withContext('the subject: the list was read once, on load').toBe(1);
        expect(page.mailboxUnread()['mb2']).toBe(2);

        changed(page, {
            mailboxId: 'mb2', seq: 2, mailboxUnseen: 7,
            counts: { Archive: { total: 30, unseen: 0, serverTotal: null, serverUnseen: null } },
        });

        expect(page.mailboxUnread()['mb2']).toBe(7);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on the event').toBe(0);
    });

    it('an event carrying mailboxUnseen sets the open mailbox\'s number over its inbox entry, with no request', () => {
        const page = build([{ ...WORK, unread: 11 }, HOME]);
        page.loadMailboxes();
        const before = mailboxesAsked;

        changed(page, {
            seq: 2, mailboxUnseen: 3,
            counts: { 'INBOX': { total: 20, unseen: 1, serverTotal: 20, serverUnseen: 1 } },
        });

        expect(page.mailboxUnread()['mb1']).toBe(3);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on the event').toBe(0);
    });

    it('without mailboxUnseen, a change event updates the number from the inbox\'s entry, never a sum', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();
        const before = mailboxesAsked;

        changed(page, {
            seq: 2,
            counts: {
                'INBOX': { total: 20, unseen: 1, serverTotal: 20, serverUnseen: 1 },
                '[Gmail]/All Mail': { total: 60, unseen: 5, serverTotal: 60, serverUnseen: 5 },
            },
        });

        expect(page.mailboxUnread()['mb1']).toBe(1);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on the event').toBe(0);
    });

    it('without mailboxUnseen, a change event with counts for Archive only leaves the number unchanged', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();

        const before = mailboxesAsked;

        changed(page, { mailboxId: 'mb2', seq: 3, counts: { Archive: { total: 30, unseen: 0, serverTotal: null, serverUnseen: null } } });

        expect(page.mailboxUnread()['mb2']).toBe(2);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on the event').toBe(0);
    });

    it('new mail carrying mailboxUnseen 4 sets that mailbox to 4, with no request for the mailbox list', () => {
        const page = build([{ ...WORK, unread: 11 }, { ...HOME, unread: 2 }]);
        page.loadMailboxes();
        const before = mailboxesAsked;
        const foldersBefore = foldersAsked.length;
        expect(before).withContext('the subject: the list was read once, on load').toBe(1);

        received(page, { mailboxId: 'mb2', mailboxUnseen: 4 });

        expect(page.mailboxUnread()['mb2']).toBe(4);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on new mail').toBe(0);
        expect(foldersAsked.length - foldersBefore).withContext('folder reads on new mail').toBe(0);
    });

    it('new mail without mailboxUnseen reads the mailbox list again for a mailbox it serves', () => {
        const page = build([{ ...WORK, unread: 11 }, { ...HOME, unread: 2 }]);
        page.loadMailboxes();
        const before = mailboxesAsked;

        received(page, { mailboxId: 'mb2' });

        expect(mailboxesAsked - before).withContext('requests to /mailboxes on new mail').toBe(1);
        expect(page.mailboxUnread()['mb2']).withContext('the list\'s number').toBe(2);
    });

    it('new mail for the open mailbox takes the number it carries and still reads its folders', () => {
        const page = build([{ ...WORK, unread: 11 }, { ...HOME, unread: 2 }]);
        page.loadMailboxes();
        const before = mailboxesAsked;
        const foldersBefore = foldersAsked.length;

        received(page, { mailboxId: 'mb1', mailboxUnseen: 12 });

        expect(page.mailboxUnread()['mb1']).toBe(12);
        expect(mailboxesAsked - before).withContext('requests to /mailboxes on new mail').toBe(0);
        expect(foldersAsked.length - foldersBefore).withContext('the open mailbox\'s folders, for its new mail').toBeGreaterThan(0);
    });
});

/** The mail.received reader: mailboxUnseen kept when it is a count, dropped otherwise, the nudge kept either way. */
describe('EmailLiveEventsService -- mail.received carries its mailbox\'s unread number', () => {
    function read(raw: unknown): unknown {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: CentrifugoClientService, useValue: {} }] });
        const service = TestBed.inject(EmailLiveEventsService);
        return (service as unknown as { tryParse(r: unknown): unknown }).tryParse(raw);
    }

    const BASE = { type: 'mail.received', mailboxId: 'mb2', folder: 'INBOX', newCount: 1 };

    it('keeps a count', () => {
        expect(read({ ...BASE, mailboxUnseen: 4 })).toEqual({ ...BASE, mailboxUnseen: 4 });
    });

    it('reads a nudge without it, or with one that is not a count, as one without a number', () => {
        expect(read(BASE)).toEqual(BASE);
        expect(read({ ...BASE, mailboxUnseen: null })).toEqual(BASE);
        expect(read({ ...BASE, mailboxUnseen: '4' })).toEqual(BASE);
        expect(read({ ...BASE, mailboxUnseen: -1 })).toEqual(BASE);
    });
});
