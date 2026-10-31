import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, Observable, of, throwError } from 'rxjs';
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
import { type EmailMailboxDto, type EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * The mail page reads two lists, each shown in its own pane: the mailboxes and the selected folder's messages. A
 * failed read of either is held for the error banner in that pane, never a toast; each banner's Retry reads its own
 * list again, a read that then succeeds clears that failure, and one list failing leaves the other's failure alone.
 * The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- a failed read of the mailboxes or the messages', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;

    let mailboxAnswers: Array<() => Observable<EmailMailboxDto[]>>;
    let messageAnswers: Array<() => Observable<EmailMessageDto[]>>;
    let mailboxesAsked: number;
    let messagesAsked: number[];
    let toasts: string[];

    function build(): EmailMailboxPageComponent {
        mailboxesAsked = 0;
        messagesAsked = [];
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => mailboxAnswers[Math.min(mailboxesAsked++, mailboxAnswers.length - 1)](),
                        listFolders: () => of([]),
                        listMessages: (_id: string, _folder: string, page: number) => {
                            const n = messagesAsked.push(page) - 1;
                            return messageAnswers[Math.min(n, messageAnswers.length - 1)]();
                        },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast, info: recordToast } },
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

    const rows = (n: number): EmailMessageDto[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));

    it('mailboxes: the failure is held for the mailbox pane, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        mailboxAnswers = [() => throwError(() => failure), () => of([MAILBOX])];
        messageAnswers = [() => of(rows(1))];
        const page = build();

        page.loadMailboxes();

        expect(mailboxesAsked).withContext('the load asked the API').toBe(1);
        expect(page.mailboxesFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(page.loadingMailboxes()).toBeFalse();
        expect(page.messagesFailure()).withContext('the message pane is not touched').toBeNull();
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        page.loadMailboxes();

        expect(mailboxesAsked).withContext('Retry asked the API again').toBe(2);
        expect(page.mailboxesFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(page.mailboxes().map(m => m.id)).toEqual(['mb1']);
        expect(page.messagesFailure()).toBeNull();
        expect(toasts).toEqual([]);
    });

    it('messages: the failure is held for the message pane, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        mailboxAnswers = [() => of([MAILBOX])];
        messageAnswers = [() => throwError(() => failure), () => of(rows(2))];
        const page = build();

        // The mailboxes read opens the first mailbox, and its folder's messages are read.
        page.loadMailboxes();

        expect(messagesAsked).withContext('the load asked the API').toEqual([1]);
        expect(page.messagesFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(page.messagesFailedOnAppend()).toBeFalse();
        expect(page.mailboxesFailure()).withContext('the mailbox pane is not touched').toBeNull();
        expect(page.mailboxes().map(m => m.id)).toEqual(['mb1']);
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        page.retryMessages();

        expect(messagesAsked).withContext('Retry asked the API again').toEqual([1, 1]);
        expect(page.messagesFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(page.messages().length).toBe(2);
        expect(page.mailboxesFailure()).toBeNull();
        expect(toasts).toEqual([]);
    });

    it('messages: a failed next page keeps the rows, and Retry asks for that page again', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        mailboxAnswers = [() => of([MAILBOX])];
        messageAnswers = [() => of(rows(50)), () => throwError(() => failure), () => of(rows(1))];
        const page = build();
        page.loadMailboxes();
        expect(page.hasMore()).withContext('a full first page offers more').toBeTrue();

        page.loadMore();

        expect(messagesAsked).toEqual([1, 2]);
        expect(page.messagesFailure()).toBe(failure);
        expect(page.messagesFailedOnAppend()).toBeTrue();
        expect(page.messages().length).withContext('the rows read so far stay').toBe(50);
        expect(toasts).toEqual([]);

        page.retryMessages();

        expect(messagesAsked).withContext('the same page asked again').toEqual([1, 2, 2]);
        expect(page.messagesFailure()).toBeNull();
        expect(page.messages().length).toBe(51);
    });
});
