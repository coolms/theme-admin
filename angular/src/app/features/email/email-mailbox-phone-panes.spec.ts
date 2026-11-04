import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of, Subject } from 'rxjs';
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
import { type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * On a phone the mail page shows one pane at a time. Choosing a folder puts the folders away; Back closes the open
 * message, and a message still loading when Back is pressed does not open when its answer comes. The page is built
 * directly, not rendered.
 */
describe('EmailMailboxPageComponent -- one pane at a time on a phone', () => {
    let details: Subject<EmailMessageDetailDto>;

    function build(): EmailMailboxPageComponent {
        details = new Subject<EmailMessageDetailDto>();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        listMessages: () => of([]),
                        getMessage: () => details,
                        listThread: () => of([]),
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS },
                },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER } },
                { provide: ActivatedRoute, useValue: {} },
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

        return TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
    }

    const message = { id: 'm1', seen: true, folder: 'INBOX' } as EmailMessageDto;
    const detail = { id: 'm1', subject: 'Hello' } as EmailMessageDetailDto;

    it('choosing a folder puts the folders away', () => {
        const page = build();
        page.phoneFolders.set(true);

        page.selectFolder('Archive');

        expect(page.phoneFolders()).toBe(false);
        expect(page.selectedFolder()).toBe('Archive');
    });

    it('Back closes the open message', () => {
        const page = build();
        page.openMessage(message);
        details.next(detail);
        expect(page.selectedMessage()).toEqual(detail);

        page.closeMessage();

        expect(page.selectedMessage()).toBeNull();
        expect(page.loadingDetail()).toBe(false);
    });

    it('a message still loading when Back is pressed does not open when it answers', () => {
        const page = build();
        page.openMessage(message);
        expect(page.loadingDetail()).toBe(true);

        page.closeMessage();
        details.next(detail);

        expect(page.loadingDetail()).toBe(false);
        expect(page.selectedMessage()).toBeNull();
    });
});
