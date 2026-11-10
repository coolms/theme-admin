import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';
import { NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    DraftStoreService,
    ToastService,
    type ToastInput,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import type { EmailArchiveResultDto, EmailBulkResultDto, EmailMailboxDto, EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * Archive on the mailbox page: one message by its own call, several checked by one bulk call; a row leaves the list
 * unless the folder shown is the one the server answered; the reader is left as Delete leaves it; a refusal is said;
 * and a change from elsewhere that moved a row moves it here too. The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- archive', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;
    const LISTED: EmailMessageDto[] = [
        { id: 'm1', folder: 'INBOX', subject: 'One', canArchive: true },
        { id: 'm2', folder: 'INBOX', subject: 'Two', canArchive: true },
        { id: 'm3', folder: 'INBOX', subject: 'Three', canArchive: false },
    ];

    let movedTo: Map<string, string>;
    let singles: string[];
    let bulks: (readonly string[])[];
    let listReads: number;
    let errors: string[];
    let shown: ToastInput[];

    function build(answers: {
        one?: (id: string) => Observable<EmailArchiveResultDto>;
        many?: (ids: readonly string[]) => Observable<EmailBulkResultDto>;
        folder?: string;
    } = {}): EmailMailboxPageComponent {
        singles = [];
        bulks = [];
        movedTo = new Map<string, string>();
        listReads = 0;
        errors = [];
        shown = [];
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
                        // The server's folder: a message moved to another folder is no longer listed in it.
                        listMessages: () => {
                            listReads++;
                            const shown = answers.folder ?? 'INBOX';
                            return of(LISTED.map(m => ({ ...m, folder: movedTo.get(m.id) ?? shown })).filter(m => m.folder === shown));
                        },
                        archiveMessage: (id: string) => {
                            singles.push(id);
                            const answer: Observable<EmailArchiveResultDto> = answers.one ? answers.one(id) : of({ id, folder: 'Archive' });
                            return answer.pipe(tap((a: EmailArchiveResultDto) => movedTo.set(a.id, a.folder)));
                        },
                        archiveMessages: (ids: readonly string[]) => {
                            bulks.push(ids);
                            const answer: Observable<EmailBulkResultDto> = answers.many
                                ? answers.many(ids)
                                : of({ results: ids.map(id => ({ id, outcome: 'archived' as const, folder: 'Archive' })) });
                            return answer.pipe(tap((a: EmailBulkResultDto) => a.results
                                .filter(r => r.outcome === 'archived')
                                .forEach(r => movedTo.set(r.id, r.folder ?? ''))));
                        },
                        deleteMessages: (ids: readonly string[]) => {
                            ids.forEach(id => movedTo.set(id, 'Trash'));
                            return of({ results: ids.map(id => ({ id, outcome: 'moved', folder: 'Trash' })) });
                        },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: {
                        error: (m: string) => void errors.push(m),
                        success: noop,
                        info: noop,
                        show: (input: ToastInput) => {
                            shown.push(input);
                            return 1;
                        },
                    },
                },
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
        page.selectedFolder.set(answers.folder ?? 'INBOX');
        page.retryMessages();
        listReads = 0;

        return page;
    }

    const ids = (page: EmailMailboxPageComponent): string[] => page.messages().map(m => m.id);
    const open = (page: EmailMailboxPageComponent, id: string): void =>
        page.selectedMessage.set({ ...page.messages().find(m => m.id === id)!, bodyText: 'Hello' });

    it('the open message: its own call; the row leaves and the reader is left as Delete leaves it', () => {
        const page = build();
        open(page, 'm2');

        page.onDetailAction('archive');

        expect(singles).toEqual(['m2']);
        expect(bulks).toEqual([]);
        expect(ids(page)).toEqual(['m1', 'm3']);
        expect(page.selectedMessage()).withContext('the reader after Archive').toBeNull();

        const deleted = build();
        open(deleted, 'm2');
        deleted.onDetailAction('delete');
        expect(ids(deleted)).toEqual(['m1', 'm3']);
        expect(deleted.selectedMessage()).withContext('the reader after Delete, the same').toBeNull();
    });

    it("an unchecked row's menu archives that row alone by the single call, whatever else is checked", () => {
        const page = build();
        page.selectedIds.set(new Set(['m1', 'm3']));
        open(page, 'm1');

        page.onMessageAction('archive', ['m2']);

        expect(singles).toEqual(['m2']);
        expect(ids(page)).toEqual(['m1', 'm3']);
        expect(page.selectedMessage()?.id).withContext('another open message stays open').toBe('m1');
    });

    it('the row stays when the folder shown is the folder the server answered, and the list is read again', () => {
        const page = build({ folder: '[Gmail]/All Mail', one: id => of({ id, folder: '[Gmail]/All Mail' }) });
        open(page, 'm1');

        page.onDetailAction('archive');

        expect(singles).toEqual(['m1']);
        expect(ids(page)).toEqual(['m1', 'm2', 'm3']);
        expect(listReads).withContext('read again for its new state').toBe(1);
    });

    it('several checked: one bulk call; the archived leave, the refused stay, one summary says how many and why', () => {
        const page = build({ many: asked => of({ results: asked.map(id => (id === 'm3'
            ? { id, outcome: 'refused' as const, folder: 'INBOX', reason: 'not-archivable-from-here' }
            : { id, outcome: 'archived' as const, folder: 'Archive' })) }) });
        page.selectedIds.set(new Set(['m1', 'm2', 'm3']));

        page.onBulkAction('archive');

        expect(singles).toEqual([]);
        expect(bulks.length).toBe(1);
        expect([...bulks[0]].sort()).toEqual(['m1', 'm2', 'm3']);
        expect(ids(page)).toEqual(['m3']);
        expect(errors).toEqual(['1 message of 3 not archived. Messages in this folder cannot be archived.']);
    });

    it('a 422 keeps the row and says why; a 502 keeps it and offers Retry, not pressed by itself', () => {
        const refusing = build({ one: () => throwError(() => new HttpErrorResponse({
            status: 422, error: { type: '/errors/email/cannot-archive', reason: 'not-in-inbox' } })) });
        refusing.onMessageAction('archive', ['m1']);
        expect(ids(refusing)).toEqual(['m1', 'm2', 'm3']);
        expect(errors).toEqual(['On this server only messages in the Inbox can be archived.']);

        const failing = build({ one: () => throwError(() => new HttpErrorResponse({ status: 502 })) });
        failing.onMessageAction('archive', ['m1']);
        expect(ids(failing)).toEqual(['m1', 'm2', 'm3']);
        expect(shown.map(s => s.action?.label)).toEqual(['Retry']);
        expect(singles).toEqual(['m1']);
    });

    describe('a change from elsewhere', () => {
        const moved = (seq: number, movedTo: string): MailMessagesChangedEvent => readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'action', seq,
            changes: [{ id: 'm2', threadId: 't2', folder: 'INBOX', movedTo, seen: true, flagged: false }], counts: {}, mailboxUnseen: 0,
        }) as MailMessagesChangedEvent;
        const apply = (page: EmailMailboxPageComponent, evt: MailMessagesChangedEvent): void =>
            (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(evt);

        it("archived on Gmail elsewhere (movedTo All Mail): the row leaves the inbox shown here", () => {
            const page = build();
            apply(page, moved(5, '[Gmail]/All Mail'));
            expect(ids(page)).toEqual(['m1', 'm3']);
        });

        it('moved into the folder shown and not listed: the list is read again rather than a row guessed', () => {
            jasmine.clock().install();
            try {
                const page = build({ folder: '[Gmail]/All Mail' });
                page.messages.set(page.messages().filter(m => m.id !== 'm2'));
                apply(page, moved(6, '[Gmail]/All Mail'));
                jasmine.clock().tick(400);
                expect(listReads).toBe(1);
            } finally {
                jasmine.clock().uninstall();
            }
        });
    });
});
