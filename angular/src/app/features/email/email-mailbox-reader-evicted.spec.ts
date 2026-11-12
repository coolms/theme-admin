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
import type { EmailMailboxDto, EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * In the reader: an evicted message stays shown and says so; a deleted one does not. Either way its row leaves the
 * list. The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- an evicted message in the reader', () => {
    const MAILBOX = { id: 'mb1', label: 'Work', serverSearch: { state: 'supported' } } as EmailMailboxDto;
    const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'Archive' }, { id: 'm2', folder: 'Archive' }];

    function build(): EmailMailboxPageComponent {
        const noop = (): void => undefined;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(LISTED),
                        openServerMessage: () => null,
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: noop, success: noop, info: noop } },
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
                { provide: CrumbNamesService, useValue: { setTail: noop } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.mailboxes.set([MAILBOX]);
        page.selectedMailboxId.set('mb1');
        page.selectedFolder.set('Archive');
        page.retryMessages();

        return page;
    }

    const gone = (seq: number, extra: Record<string, unknown>): MailMessagesChangedEvent => readMessagesChanged({
        type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'sync', seq,
        changes: [{ id: 'm2', folder: 'Archive', gone: true, ...extra }], counts: {}, mailboxUnseen: 0,
    }) as MailMessagesChangedEvent;
    const apply = (page: EmailMailboxPageComponent, evt: MailMessagesChangedEvent): void =>
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(evt);

    it('evicted: the message stays open and says it is no longer kept here; its row leaves the list', () => {
        const page = build();
        page.selectedMessage.set({ id: 'm2', folder: 'Archive', subject: 'Old invoice' } as never);

        apply(page, gone(10, { reason: 'evicted' }));

        expect(page.selectedMessage()?.id).toBe('m2');
        expect(page.openEvicted()).toBeTrue();
        expect(page.messages().map(m => m.id)).toEqual(['m1']);
    });

    it('deleted: its row leaves the list, and the reader says nothing new', () => {
        const page = build();
        page.selectedMessage.set({ id: 'm2', folder: 'Archive', subject: 'Old invoice' } as never);

        apply(page, gone(10, {}));

        expect(page.openEvicted()).toBeFalse();
        expect(page.messages().map(m => m.id)).toEqual(['m1']);
    });
});
