import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
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

    function build(mailboxes: EmailMailboxDto[]): EmailMailboxPageComponent {
        foldersAsked = [];
        const folders: Record<string, EmailFolderDto[]> = { mb1: GMAIL, mb2: NOT_COUNTED };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of(mailboxes),
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

    function changed(page: EmailMailboxPageComponent, event: Partial<MailMessagesChangedEvent>): void {
        const full: MailMessagesChangedEvent = {
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'sync', seq: 1, changes: [], counts: {}, mailboxUnseen: 0,
            ...event,
        };
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(full);
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

    it('a change event updates the number from the inbox\'s entry, not the mailbox-wide unseen', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();

        changed(page, {
            seq: 2,
            counts: {
                'INBOX': { total: 20, unseen: 1, serverTotal: 20, serverUnseen: 1 },
                '[Gmail]/All Mail': { total: 60, unseen: 5, serverTotal: 60, serverUnseen: 5 },
            },
            mailboxUnseen: 9,
        });

        expect(page.mailboxUnread()['mb1']).toBe(1);
    });

    it('a change event with counts for Archive only leaves the number unchanged', () => {
        const page = build([WORK, HOME]);
        page.loadMailboxes();

        changed(page, { mailboxId: 'mb2', seq: 3, counts: { Archive: { total: 30, unseen: 0, serverTotal: null, serverUnseen: null } }, mailboxUnseen: 0 });

        expect(page.mailboxUnread()['mb2']).toBe(2);
    });
});
