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
import { encodedBytes, readyAttachment, type ComposeAttachment } from './compose-attachments';
import type { OutgoingEmailRequest } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * Sending a new message with files: the ids of the attached files go in the send, a file still uploading or refused
 * holds the send back, a 422 naming a file no longer there marks that file's chip, and a 413 keeps both sizes for the
 * composer to show. A reply carries its files the same way. The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- sending with attachments', () => {
    let sent: OutgoingEmailRequest[];
    let sendAnswer: () => Observable<unknown>;
    let toasts: string[];
    let replied: string[];

    function build(): EmailMailboxPageComponent {
        sent = [];
        replied = [];
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([]),
                        listFolders: () => of([]),
                        listMessages: () => of([]),
                        send: (_id: string, request: OutgoingEmailRequest) => { sent.push(request); return sendAnswer(); },
                        reply: (id: string, request: OutgoingEmailRequest) => { replied.push(id); sent.push(request); return sendAnswer(); },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast, info: recordToast } },
                { provide: Router, useValue: { events: NEVER } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: { clear: (): void => {}, save: (): void => {}, load: () => null } },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: NaviGraphService, useValue: {} },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.selectedMailboxId.set('mb1');
        page.composeMode.set('compose');
        page.composeTo = ['ada@example.com'];
        page.composeRich.set(false);
        page.composeText = 'Here are the files.';

        return page;
    }

    const file = (id: string, name: string): ComposeAttachment =>
        readyAttachment({ id, filename: name, sizeBytes: 10, mimeType: 'text/plain', encodedBytes: encodedBytes(10) }, 'upload');

    it('sends the ids of the attached files', () => {
        sendAnswer = () => NEVER;
        const page = build();
        page.composeAttachments.set([file('a1', 'one.txt'), file('a2', 'two.txt')]);
        page.sendCompose();
        expect(sent.length).toBe(1);
        expect(sent[0].attachments).toEqual(['a1', 'a2']);
    });

    it('marks the file a 422 names as no longer there to send, and leaves the others', () => {
        sendAnswer = () => throwError(() => new HttpErrorResponse({
            status: 422,
            error: {
                type: '/errors/email/attachment-not-found',
                detail: 'This attachment has expired, attach it again: "a2".',
                attachmentId: 'a2',
            },
        }));
        const page = build();
        page.composeAttachments.set([file('a1', 'one.txt'), file('a2', 'two.txt')]);
        page.sendCompose();
        const [one, two] = page.composeAttachments();
        expect(one.status).toBe('ready');
        expect(two.status).toBe('refused');
        expect(two.refusal).toContain('no longer there to send');
        expect(toasts).toContain('A file is no longer there to send. Attach it again.');
    });

    it('marks the file named only in the sentence, from a server without attachmentId', () => {
        sendAnswer = () => throwError(() => new HttpErrorResponse({
            status: 422,
            error: { detail: 'This attachment has expired, attach it again: "a1".' },
        }));
        const page = build();
        page.composeAttachments.set([file('a1', 'one.txt')]);
        page.sendCompose();
        expect(page.composeAttachments()[0].status).toBe('refused');
    });

    it('keeps the measured size and the limit of a send refused as too large', () => {
        sendAnswer = () => throwError(() => new HttpErrorResponse({
            status: 413,
            error: { type: '/errors/email/message-too-large', limitBytes: 25_000_000, sizeBytes: 26_100_000 },
        }));
        const page = build();
        page.composeAttachments.set([file('a1', 'one.txt')]);
        page.sendCompose();
        expect(page.composeSendRefused()).toEqual({ limitBytes: 25_000_000, sizeBytes: 26_100_000 });
        expect(page.composeAttachments()[0].status).toBe('ready');
    });

    it('holds the send while a file is uploading, or one was refused', () => {
        sendAnswer = () => NEVER;
        const page = build();
        page.composeAttachments.set([{ ...file('a1', 'one.txt'), id: null, status: 'uploading' }]);
        page.sendCompose();
        page.composeAttachments.set([{ ...file('a1', 'one.txt'), status: 'refused', refusal: 'x' }]);
        page.sendCompose();
        expect(sent.length).toBe(0);
        expect(toasts).toEqual([
            'Wait for the files to finish attaching.',
            'Remove the files that could not be attached, then send.',
        ]);
    });

    /** The page as a reply to message m1 leaves it: the reply endpoint, for that message. */
    const asReply = (page: EmailMailboxPageComponent): void => {
        page.composeMode.set('reply');
        (page as unknown as { replyTargetId: { set(v: string | null): void } }).replyTargetId.set('m1');
    };

    it('sends the ids of the attached files with a reply, through the reply endpoint', () => {
        sendAnswer = () => NEVER;
        const page = build();
        asReply(page);
        page.composeAttachments.set([file('a1', 'one.txt'), file('a2', 'two.txt')]);
        page.sendCompose();
        expect(replied).toEqual(['m1']);
        expect(sent[0].attachments).toEqual(['a1', 'a2']);
    });

    it('marks the file a 422 names on a reply', () => {
        sendAnswer = () => throwError(() => new HttpErrorResponse({
            status: 422,
            error: { type: '/errors/email/attachment-not-found', detail: 'This attachment has expired, attach it again: "a1".', attachmentId: 'a1' },
        }));
        const page = build();
        asReply(page);
        page.composeAttachments.set([file('a1', 'one.txt'), file('a2', 'two.txt')]);
        page.sendCompose();
        expect(replied).toEqual(['m1']);
        expect(page.composeAttachments().map((a) => a.status)).toEqual(['refused', 'ready']);
    });
});
