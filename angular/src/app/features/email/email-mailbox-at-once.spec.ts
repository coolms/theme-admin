import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
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
    type ToastInput,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import type { EmailArchiveResultDto, EmailBulkResultDto, EmailFolderDto, EmailMailboxDto, EmailMessageDetailDto, EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * A mail action shows its result the moment it is chosen: Archive, Delete and Move take the rows out of the list at
 * once and the next message opens; read and star change at once. When the server refuses, what it refused comes back
 * as it was (in its place, and open again if it was open) and a notice says why; nothing is asked again by itself.
 * Every server call here waits until the test answers it. Built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- mail actions at once', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;
    const FIVE: EmailMessageDto[] = ['m1', 'm2', 'm3', 'm4', 'm5'].map(id => ({
        id, folder: 'INBOX', subject: id, canArchive: true, seen: id !== 'm2', flagged: false,
    }));

    let calls: { name: string; args: unknown; answer: Subject<unknown> }[];
    let opened: string[];
    let successes: string[];
    let errors: string[];
    let shown: ToastInput[];
    /** What the server no longer lists in the folder, as its answers say: a read of the list after reads it so. */
    let serverGone: Set<string>;
    /** The list shown is All Mail, where an archived or labelled message is still listed by the server. */
    let allMailKeeps: boolean;

    function build(): EmailMailboxPageComponent {
        calls = [];
        opened = [];
        successes = [];
        errors = [];
        shown = [];
        serverGone = new Set<string>();
        allMailKeeps = false;
        const call = (name: string) => (...args: unknown[]) => {
            const answer = new Subject<unknown>();
            calls.push({ name, args: args.length === 1 ? args[0] : args, answer });
            return answer;
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(FIVE.filter(m => allMailKeeps || !serverGone.has(m.id))),
                        getMessage: (id: string) => {
                            opened.push(id);
                            return of({ ...FIVE.find(m => m.id === id)!, bodyText: 'Hello' } as EmailMessageDetailDto);
                        },
                        listThread: () => of([]),
                        markSeen: call('seen'),
                        markFlagged: call('flag'),
                        archiveMessage: call('archive'),
                        archiveMessages: call('archive-bulk'),
                        deleteMessages: call('delete'),
                        moveMessage: call('move'),
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS },
                },
                {
                    provide: ToastService,
                    useValue: {
                        error: (m: string) => void errors.push(m),
                        success: (m: string) => void successes.push(m),
                        info: () => undefined,
                        show: (input: ToastInput) => {
                            shown.push(input);
                            return 1;
                        },
                    },
                },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: NaviGraphService, useValue: {} },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: () => undefined } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.mailboxes.set([MAILBOX]);
        page.selectedMailboxId.set('mb1');
        page.selectedFolder.set('INBOX');
        page.retryMessages();

        return page;
    }

    const open = (page: EmailMailboxPageComponent, id: string): void => {
        page.openMessage(page.messages().find(m => m.id === id)!);
        opened = [];
        calls = calls.filter(c => c.name !== 'seen');
    };
    const ids = (page: EmailMailboxPageComponent): string[] => page.messages().map(m => m.id);
    const row = (page: EmailMailboxPageComponent, id: string) => page.messages().find(m => m.id === id);
    /** The nth call (from 0) to this endpoint. */
    const callTo = (name: string, nth = 0) => calls.filter(c => c.name === name)[nth];
    const answer = (name: string, value: unknown, nth = 0): void => {
        const asked = callTo(name, nth);
        if (name === 'archive') {
            serverGone.add((value as EmailArchiveResultDto).id);
        } else if (name === 'move') {
            serverGone.add((asked.args as unknown[])[0] as string);
        } else if (name === 'archive-bulk' || name === 'delete') {
            (value as EmailBulkResultDto).results.filter(r => r.outcome === 'archived' || r.outcome === 'moved').forEach(r => serverGone.add(r.id));
        }
        callTo(name, nth).answer.next(value);
        callTo(name, nth).answer.complete();
    };
    const refuse = (name: string, e: HttpErrorResponse, nth = 0): void => callTo(name, nth).answer.error(e);
    const bulk = (results: { id: string; outcome: string; folder?: string; reason?: string }[]): EmailBulkResultDto =>
        ({ results } as EmailBulkResultDto);
    const cannotArchive = (reason: string) => new HttpErrorResponse({ status: 422, error: { type: '/errors/email/cannot-archive', reason } });

    describe('the effect, before the server answers', () => {
        it('Archive takes the open message out at once and opens the next; the notice says Archived when it is done', () => {
            const page = build();
            open(page, 'm2');

            page.onDetailAction('archive');

            expect(calls.map(c => c.name)).toEqual(['archive']);
            expect(ids(page)).toEqual(['m1', 'm3', 'm4', 'm5']);
            expect(opened).toEqual(['m3']);
            expect(page.selectedMessage()?.id).toBe('m3');
            answer('archive', { id: 'm2', folder: 'Archive' } as EmailArchiveResultDto);
            expect(ids(page)).toEqual(['m1', 'm3', 'm4', 'm5']);
            expect(successes).toEqual(['Archived 1 message.']);
        });

        it('Delete takes the open message out at once; the notice says Moved to Trash, with Undo', () => {
            const page = build();
            open(page, 'm5');

            page.onDetailAction('delete');

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4']);
            expect(page.selectedMessage()?.id).withContext('the last: the one above opens').toBe('m4');
            answer('delete', bulk([{ id: 'm5', outcome: 'moved', folder: 'Trash' }]));
            expect(shown.map(s => s.message)).toEqual(['Moved 1 message to Trash.']);
            expect(shown[0].action?.label).toBe('Undo');
        });

        it('Move takes the open message out at once and opens the next; the notice names the folder', () => {
            const page = build();
            open(page, 'm3');

            page.bulkMoveTo('Projects', new Set(['m3']));

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m4');
            answer('move', null);
            expect(successes).toEqual(['Moved to Projects.']);
            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
        });

        it('Mark read and Star change the row and the open message at once', () => {
            const page = build();
            open(page, 'm1');

            page.bulkMarkSeen(true, new Set(['m2']));
            page.bulkFlag(true, new Set(['m1']));

            expect(row(page, 'm2')?.seen).toBeTrue();
            expect(row(page, 'm1')?.flagged).toBeTrue();
            expect(page.selectedMessage()?.flagged).withContext('the open message').toBeTrue();
            expect(calls.map(c => c.name)).toEqual(['seen', 'flag']);
        });
    });

    describe('a refusal puts it back as it was', () => {
        it('Archive refused (422): the row back in its place, open again, and the reason said', () => {
            const page = build();
            open(page, 'm2');
            page.onDetailAction('archive');
            expect(page.selectedMessage()?.id).toBe('m3');

            refuse('archive', cannotArchive('not-in-inbox'));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m2');
            expect(errors).toEqual(['On this server only messages in the Inbox can be archived.']);
            expect(calls.filter(c => c.name === 'archive').length).withContext('nothing asked again').toBe(1);
        });

        it('Archive not completed (502): back as it was, Retry offered and not pressed by itself', () => {
            const page = build();
            open(page, 'm4');
            page.onDetailAction('archive');

            refuse('archive', new HttpErrorResponse({ status: 502 }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m4');
            expect(shown.map(s => s.action?.label)).toEqual(['Retry']);
            expect(calls.filter(c => c.name === 'archive').length).toBe(1);
        });

        it('Delete refused (502 for the call): back as it was and open again', () => {
            const page = build();
            open(page, 'm1');
            page.onDetailAction('delete');
            expect(page.selectedMessage()?.id).toBe('m2');

            refuse('delete', new HttpErrorResponse({ status: 502 }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m1');
            expect(errors).toEqual(['Could not delete 1 message.']);
        });

        it('Mark read refused: the row is unread again, and said', () => {
            const page = build();

            page.bulkMarkSeen(true, new Set(['m2']));
            refuse('seen', new HttpErrorResponse({ status: 422 }));

            expect(row(page, 'm2')?.seen).toBeFalse();
            expect(errors).toEqual(['Could not mark 1 message read.']);
        });

        it('Move refused (422 no-move): back in its place, open again, the reason said', () => {
            const page = build();
            open(page, 'm3');
            page.bulkMoveTo('Projects', new Set(['m3']));

            refuse('move', new HttpErrorResponse({ status: 422, error: { type: '/errors/email/no-move' } }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m3');
            expect(errors).toEqual(["This mailbox's server cannot move messages, so nothing was moved."]);
        });
    });

    describe('in All Mail, where the messages stay shown', () => {
        /** The list shown is Gmail's All Mail (role all); Projects is a label, Trash is Trash. */
        const inAllMail = (page: EmailMailboxPageComponent): void => {
            const f = (folder: string, role: string | null) => ({ folder, name: folder, role, total: 5, unseen: 0 }) as EmailFolderDto;
            page.folders.set([f('[Gmail]/All Mail', 'all'), f('Projects', null), f('[Gmail]/Trash', 'trash'), f('[Gmail]/Spam', 'junk')]);
            page.selectedFolder.set('[Gmail]/All Mail');
            allMailKeeps = true;
        };

        it('Archive while viewing All Mail: the message stays shown and open, and nothing else opens', () => {
            const page = build();
            inAllMail(page);
            open(page, 'm2');

            page.onDetailAction('archive');

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m2');
            expect(opened).toEqual([]);
            answer('archive', { id: 'm2', folder: '[Gmail]/All Mail' } as EmailArchiveResultDto);
            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m2');
        });

        it('Move into a label from All Mail: the message stays shown and open', () => {
            const page = build();
            inAllMail(page);
            open(page, 'm3');

            page.bulkMoveTo('Projects', new Set(['m3']));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m3');
            answer('move', null);
            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m3');
            expect(opened).toEqual([]);
        });

        it('Move to Trash from All Mail: the message leaves at once and the next opens', () => {
            const page = build();
            inAllMail(page);
            open(page, 'm3');

            page.bulkMoveTo('[Gmail]/Trash', new Set(['m3']));

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m4');
        });

        it('Move to Spam from All Mail: the message leaves at once and the next opens', () => {
            const page = build();
            inAllMail(page);
            open(page, 'm3');

            page.bulkMoveTo('[Gmail]/Spam', new Set(['m3']));

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m4');
        });

        it('Delete from All Mail: the message leaves at once and the next opens', () => {
            const page = build();
            inAllMail(page);
            open(page, 'm3');

            page.onDetailAction('delete');

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m4');
        });
    });

    describe('checked rows, row by row', () => {
        it('the open one among them: the nearest unchecked opens at once; only the refused rows come back', () => {
            const page = build();
            open(page, 'm3');
            page.selectedIds.set(new Set(['m2', 'm3', 'm4']));

            page.onBulkAction('archive');

            expect(ids(page)).toEqual(['m1', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m5');
            answer('archive-bulk', bulk([
                { id: 'm2', outcome: 'refused', folder: 'INBOX', reason: 'not-archivable-from-here' },
                { id: 'm3', outcome: 'archived', folder: 'Archive' },
                { id: 'm4', outcome: 'refused', folder: 'INBOX', reason: 'not-archivable-from-here' },
            ]));

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).withContext('m3 was archived: m5 stays open').toBe('m5');
            expect(errors).toEqual(['2 messages of 3 not archived. Messages in this folder cannot be archived.']);
        });

        it('Delete of checked rows: the refused one comes back in its place, the moved ones stay out', () => {
            const page = build();
            page.selectedIds.set(new Set(['m1', 'm3', 'm5']));

            page.onBulkAction('delete');
            expect(ids(page)).toEqual(['m2', 'm4']);
            answer('delete', bulk([
                { id: 'm1', outcome: 'moved', folder: 'Trash' },
                { id: 'm3', outcome: 'refused', reason: 'no-move' },
                { id: 'm5', outcome: 'moved', folder: 'Trash' },
            ]));

            expect(ids(page)).toEqual(['m2', 'm3', 'm4']);
            expect(shown.map(s => s.message)).withContext('one notice, the refusal in place of Moved to Trash')
                .toEqual(["This mailbox's server cannot move messages, so nothing was deleted."]);
            expect(shown[0].action?.label).toBe('Undo');
            expect(errors).toEqual([]);
            expect(successes).toEqual([]);
        });

        it('a refusal while the next message is untouched opens the refused one again', () => {
            const page = build();
            open(page, 'm2');
            page.onDetailAction('delete');
            expect(page.selectedMessage()?.id).toBe('m3');

            refuse('delete', new HttpErrorResponse({ status: 502 }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m2');
        });

        it('a refusal after the person opened another message keeps that one; only the row comes back', () => {
            const page = build();
            open(page, 'm2');
            page.onDetailAction('archive');
            page.openMessage(page.messages().find(m => m.id === 'm5')!);

            refuse('archive', new HttpErrorResponse({ status: 422, error: { type: '/errors/email/cannot-archive', reason: 'not-in-inbox' } }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m5');
            expect(errors).toEqual(['On this server only messages in the Inbox can be archived.']);
        });

        it('a refusal after the person acted on the next message keeps it; only the row comes back', () => {
            const page = build();
            open(page, 'm2');
            page.onDetailAction('archive');
            expect(page.selectedMessage()?.id).toBe('m3');
            page.onDetailAction('star');

            refuse('archive', new HttpErrorResponse({ status: 502 }));

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
            expect(page.selectedMessage()?.id).toBe('m3');
        });

        it('a refused row comes back with its row state', () => {
            const page = build();
            page.bulkFlag(true, new Set(['m2']));
            answer('flag', null);
            expect(row(page, 'm2')?.flagged).toBeTrue();
            page.selectedIds.set(new Set(['m2']));

            page.onBulkAction('archive');
            refuse('archive', new HttpErrorResponse({ status: 502 }));

            expect(row(page, 'm2')?.flagged).toBeTrue();
            expect(row(page, 'm2')?.seen).toBeFalse();
            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
        });

        it('Move of checked rows: each row by its own answer', () => {
            const page = build();
            page.selectedIds.set(new Set(['m2', 'm4']));

            page.bulkMoveTo('Projects');
            expect(ids(page)).toEqual(['m1', 'm3', 'm5']);
            answer('move', null);
            refuse('move', new HttpErrorResponse({ status: 404, error: { type: '/errors/email/not-found' } }), 1);

            expect(ids(page)).toEqual(['m1', 'm3', 'm4', 'm5']);
            expect(successes).withContext('one notice: the refusal, in place of what was done').toEqual([]);
            expect(errors).toEqual(['This message no longer exists.']);
        });
    });
});
