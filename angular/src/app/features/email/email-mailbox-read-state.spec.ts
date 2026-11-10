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
import type { EmailMailboxDto, EmailMessageDetailDto, EmailMessageDto } from './email.types';
import { readFlagRefused } from './mail-flag-refused';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * The read state the person chose (contract design-tokens "read state"). Until its write answers, what was read or
 * sent before -- a list read again, a live event -- keeps the person's value. After the answer the server's word is
 * final: the first live event ends the choice, and when it carries the other value, or mail.flag.refused said so, the
 * change was refused and the page says it in place of its "Marked" notice. The last choice for a message wins.
 * Every write here waits until the test answers it. Built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- the read state the person chose', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;
    const ROWS: EmailMessageDto[] = ['m1', 'm2', 'm3'].map(id => ({ id, folder: 'INBOX', subject: id, seen: true, flagged: false }));

    let server: Map<string, boolean>;
    let writes: { id: string; seen: boolean; answer: Subject<unknown> }[];
    let flagWrites: Subject<unknown>[];
    let lists: Subject<EmailMessageDto[]>[];
    let shown: ToastInput[];
    let errors: string[];
    let dismissed: number[];
    let seq: number;

    function build(): EmailMailboxPageComponent {
        server = new Map(ROWS.map(r => [r.id, r.seen ?? false]));
        writes = [];
        flagWrites = [];
        lists = [];
        shown = [];
        errors = [];
        dismissed = [];
        seq = 0;
        let listCalls = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        // The first read answers at once; every later one waits for the test, so it can answer it
                        // after a write has answered, as a read started before the answer would.
                        listMessages: () => {
                            listCalls++;
                            if (listCalls === 1) {
                                return of(ROWS.map(r => ({ ...r })));
                            }
                            const answer = new Subject<EmailMessageDto[]>();
                            lists.push(answer);
                            return answer;
                        },
                        getMessage: (id: string) => of({ ...ROWS.find(r => r.id === id)!, seen: server.get(id), bodyText: 'Hello' } as EmailMessageDetailDto),
                        listThread: () => of([]),
                        markSeen: (id: string, seen: boolean) => {
                            const answer = new Subject<unknown>();
                            writes.push({ id, seen, answer });
                            return answer;
                        },
                        markFlagged: () => {
                            const answer = new Subject<unknown>();
                            flagWrites.push(answer);
                            return answer;
                        },
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
                        success: () => undefined,
                        info: () => undefined,
                        show: (input: ToastInput) => {
                            shown.push(input);
                            return shown.length;
                        },
                        dismiss: (id: number) => void dismissed.push(id),
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

    const row = (page: EmailMailboxPageComponent, id: string) => page.messages().find(m => m.id === id);
    const answerWrite = (n = 0, value: unknown = null): void => {
        writes[n].answer.next(value);
        writes[n].answer.complete();
    };
    /** A list read started now; answered later with what the server then says. */
    const reread = (page: EmailMailboxPageComponent): Subject<EmailMessageDto[]> => {
        page.retryMessages();
        return lists[lists.length - 1];
    };
    const serverList = (): EmailMessageDto[] => ROWS.map(r => ({ ...r, seen: server.get(r.id) }));
    const liveSeen = (page: EmailMailboxPageComponent, id: string, seen: boolean): void => {
        const evt = readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'action', seq: ++seq,
            changes: [{ id, threadId: 't-' + id, folder: 'INBOX', seen, flagged: false }], counts: {}, mailboxUnseen: 0,
        }) as MailMessagesChangedEvent;
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(evt);
    };
    const flagRefused = (page: EmailMailboxPageComponent, id: string, flag: 'seen' | 'flagged', value: boolean, extra: Record<string, unknown> = {}): void => {
        const evt = readFlagRefused({ type: 'mail.flag.refused', mailboxId: 'mb1', messageId: id, flag, value, ...extra })!;
        (page as unknown as { onFlagRefused(e: unknown): void }).onFlagRefused(evt);
    };

    it('Mark unread, then a list read started before the answer returns read: the row stays unread', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m1']));
        const list = reread(page);
        answerWrite();
        server.set('m1', false);

        list.next(ROWS.map(r => ({ ...r, seen: true })));

        expect(row(page, 'm1')?.seen).toBeFalse();
    });

    it('a live event saying read before the answer is held off; the row stays unread', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m1']));

        liveSeen(page, 'm1', true);

        expect(row(page, 'm1')?.seen).toBeFalse();
    });

    it('after the answer, an event saying read is the server refusing: the row reverts and the refusal is said', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m1']));
        answerWrite();
        expect(shown.map(s => s.message)).toEqual(['Marked 1 message(s) unread.']);

        liveSeen(page, 'm1', true);

        expect(row(page, 'm1')?.seen).toBeTrue();
        expect(dismissed).withContext('the "Marked" notice is replaced').toEqual([1]);
        expect(errors).toEqual(["Couldn't mark as unread."]);
    });

    it('after the answer, an event with the person\'s value ends the choice silently; a later change elsewhere applies', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m1']));
        answerWrite();

        liveSeen(page, 'm1', false);
        expect(row(page, 'm1')?.seen).toBeFalse();
        expect(errors).toEqual([]);

        liveSeen(page, 'm1', true);
        expect(row(page, 'm1')?.seen).withContext('a genuine change elsewhere').toBeTrue();
        expect(errors).withContext('no refusal: the choice had ended').toEqual([]);
    });

    it('a list read started after the answer is the server\'s word', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m1']));
        answerWrite();
        const list = reread(page);

        list.next(serverList());

        expect(row(page, 'm1')?.seen).withContext('the server still had it read').toBeTrue();
    });

    it('the open message: an event before the answer keeps it unread, and an event after it saying read refuses', () => {
        const page = build();
        page.openMessage(row(page, 'm2')!);
        expect(page.selectedMessage()?.id).toBe('m2');
        page.onDetailAction('mark-unread');
        liveSeen(page, 'm2', true);
        expect(page.selectedMessage()?.seen).withContext('held before the answer').toBeFalse();
        expect(row(page, 'm2')?.seen).toBeFalse();

        answerWrite(writes.findIndex(w => w.id === 'm2' && !w.seen));
        liveSeen(page, 'm2', true);

        expect(page.selectedMessage()?.seen).toBeTrue();
        expect(errors).toEqual(["Couldn't mark as unread."]);
    });

    it('mail.flag.refused says the refusal in the page\'s words, in place of the "Marked" notice; the next event restores', () => {
        const page = build();
        page.bulkMarkSeen(false, new Set(['m3']));
        answerWrite();

        flagRefused(page, 'm3', 'seen', false, { reason: 'The folder was changed elsewhere.', code: 'changed-elsewhere' });

        expect(dismissed).toEqual([1]);
        expect(errors).toEqual(["Couldn't mark as unread: It was changed elsewhere in the meantime."]);
        liveSeen(page, 'm3', true);
        expect(row(page, 'm3')?.seen).toBeTrue();
        expect(errors.length).withContext('said once, not inferred again').toBe(1);
    });

    it('a refused star is said the same way, with the server\'s sentence when its code is not known', () => {
        const page = build();
        page.bulkFlag(true, new Set(['m1']));
        flagWrites[0].next(null);
        flagWrites[0].complete();

        flagRefused(page, 'm1', 'flagged', true, { reason: 'The mailbox is read-only.', code: 'something-new' });

        expect(dismissed).toEqual([1]);
        expect(errors).toEqual(["Couldn't star: The mailbox is read-only."]);
    });

    it('says a refusal in the same words whether the write\'s answer refused it or the server did after answering', () => {
        const sync = build();
        sync.bulkMarkSeen(false, new Set(['m1']));
        writes[0].answer.error(new HttpErrorResponse({ status: 409, error: { type: '/errors/email/changed-elsewhere' } }));
        const answered = [...errors];

        const later = build();
        later.bulkMarkSeen(false, new Set(['m1']));
        answerWrite();
        flagRefused(later, 'm1', 'seen', false, { code: 'changed-elsewhere', reason: 'The message was changed elsewhere.' });
        const afterwards = [...errors];

        expect(answered).toEqual(["Couldn't mark as unread: It was changed elsewhere in the meantime."]);
        expect(afterwards).toEqual(answered);

        const plain = build();
        plain.bulkFlag(true, new Set(['m2']));
        flagWrites[0].error(new HttpErrorResponse({ status: 502 }));
        const plainSync = [...errors];
        const plainLater = build();
        plainLater.bulkFlag(true, new Set(['m2']));
        flagWrites[0].next(null);
        flagWrites[0].complete();
        flagRefused(plainLater, 'm2', 'flagged', true);
        expect(plainSync).toEqual(["Couldn't star."]);
        expect([...errors]).toEqual(plainSync);
    });

    it('two read writes in flight: the one chosen last wins, and the earlier one\'s answer applies nothing', () => {
        const page = build();
        // Opening an unread message writes it read; a quick Mark unread follows before that write answers.
        server.set('m2', false);
        page.messages.set(page.messages().map(m => (m.id === 'm2' ? { ...m, seen: false } : m)));
        page.openMessage(row(page, 'm2')!);
        const opening = writes.findIndex(w => w.id === 'm2' && w.seen);
        expect(opening).withContext('the open marks it read').toBeGreaterThanOrEqual(0);
        page.onDetailAction('mark-unread');
        const unread = writes.findIndex(w => w.id === 'm2' && !w.seen);
        expect(unread).withContext('Mark unread is sent though the row still shows unread').toBeGreaterThanOrEqual(0);

        answerWrite(unread);
        answerWrite(opening);

        expect(row(page, 'm2')?.seen).toBeFalse();
        expect(page.selectedMessage()?.seen).toBeFalse();
    });
});
