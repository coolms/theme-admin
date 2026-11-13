import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import {
    type ConfirmDialogData,
    ConfirmDialogService,
    type ContextMenuItem,
    ContextMenuService,
    DateTimeFormatService,
    DraftStoreService,
    type ToastInput,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailFolderTreeDto, type EmailFolderTreeNodeDto, type EmailMailboxDto, type EmailMessageDto,
    type FolderActionPreviewDto, type FolderJobDto,
} from './email.types';
import { type MailFolderJobEvent } from './mail-folder-actions';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

function node(folder: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return {
        folder, name: folder, selectable: true, total: 3, unseen: 0, role: null, children: [], system: false,
        hasChildren: false, canCreateChild: false, canRename: false, canDelete: false, canEmpty: false, canMarkRead: false,
        busy: null, ...over,
    };
}

const TREE: EmailFolderTreeDto = {
    folders: [
        node('INBOX', { name: 'Inbox', role: 'inbox', system: true, canMarkRead: true }),
        node('Trash', { name: 'Bin', role: 'trash', system: true, canEmpty: true }),
        node('Junk', { name: 'Spam', role: 'junk', system: true }),
    ],
    canCreateTop: false,
    held: false,
};

/** The server's preview, worded in the reader's language: shown as given. */
const preview = (over: Partial<FolderActionPreviewDto> = {}): FolderActionPreviewDto => ({
    mailboxId: 'mb1', folder: 'Trash', action: 'empty', title: 'Papierkorb leeren?',
    body: '3 Nachrichten werden endgueltig geloescht.', confirm: 'Endgueltig leeren', count: 3, uidCeiling: 812,
    uidValidity: 1700000001, ...over,
});

const ROWS = ['t1', 't2', 't3'].map(id => ({ id, folder: 'Trash', subject: id, seen: true } as EmailMessageDto));

const problem = (status: number, body: Record<string, unknown>): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: { title: 'Refused', ...body } });

const isVisible = (n: NaviGraphNode, record: Record<string, unknown>): boolean => {
    const when = n.meta['showWhen'] as { field: string; value: unknown } | undefined;
    return when === undefined || (when.field in record && record[when.field] === when.value);
};

/**
 * Empty Trash or Spam on the mail page: offered only where canEmpty is true; the server's preview, shown as given in a
 * destructive confirm; confirmed, the folder is emptied with the preview's numbers as a job; each refusal in its own
 * words, a renumbered folder previewed again.
 */
describe('EmailMailboxPageComponent -- Empty Trash or Spam', () => {
    let previews: Array<() => Observable<FolderActionPreviewDto>>;
    let previewsAsked: string[];
    let emptyAnswer: () => Observable<FolderJobDto>;
    let emptied: Array<[string, number, number]>;
    let confirms: ConfirmDialogData[];
    let confirmAnswer: boolean;
    let menus: ContextMenuItem[][];
    let errors: string[];
    let shown: ToastInput[];
    let treeAsked: number;

    function build(): EmailMailboxPageComponent {
        previewsAsked = [];
        emptied = [];
        confirms = [];
        menus = [];
        errors = [];
        shown = [];
        treeAsked = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => {
                            treeAsked++;
                            return of(TREE);
                        },
                        listMessages: (_id: string, folder: string) => of(folder === 'Trash' ? ROWS : []),
                        folderActionPreview: (_mailboxId: string, folder: string) => {
                            previewsAsked.push(folder);
                            return (previews.shift() ?? ((): Observable<FolderActionPreviewDto> => of(preview())))();
                        },
                        emptyFolder: (_mailboxId: string, folder: string, uidCeiling: number, uidValidity: number) => {
                            emptied.push([folder, uidCeiling, uidValidity]);
                            return emptyAnswer();
                        },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: {
                        error: (m: string): void => { errors.push(m); },
                        success: (): void => {},
                        info: (): void => {},
                        show: (t: ToastInput): number => shown.push(t),
                        dismiss: (): void => {},
                    },
                },
                { provide: Router, useValue: { events: NEVER } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                {
                    provide: ConfirmDialogService,
                    useValue: {
                        open: (data: ConfirmDialogData): Observable<boolean> => {
                            confirms.push(data);
                            return of(confirmAnswer);
                        },
                    },
                },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER, connected: () => true, reconnects: () => NEVER } },
                { provide: NaviGraphService, useValue: { isVisible } },
                {
                    provide: ContextMenuService,
                    useValue: { open: (_e: MouseEvent, items: ContextMenuItem[]): void => { menus.push(items); } },
                },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        built.push(page);
        page.selectedFolder.set('Trash');
        page.loadMailboxes();

        return page;
    }

    /** Every page built in a case: its jobs are stopped after it, so no timer reads on into the next spec. */
    let built: EmailMailboxPageComponent[] = [];
    afterEach(() => {
        built.forEach(page => page.folderJobs.stop());
        built = [];
    });

    beforeEach(() => {
        previews = [];
        confirmAnswer = true;
        emptyAnswer = () => of({ jobId: 'job-e', mailboxId: 'mb1', folder: 'Trash', action: 'empty', outcome: 'running', count: 0, reason: null });
    });

    const menuOf = (page: EmailMailboxPageComponent, folder: string): ContextMenuItem[] => {
        page.onFolderMenu({ folder, event: new MouseEvent('contextmenu'), opener: null });
        return menus[menus.length - 1] ?? [];
    };
    const busyOf = (page: EmailMailboxPageComponent, folder: string): string | null =>
        page.railRows().find(r => r.folder.folder === folder)?.flags?.busy ?? null;
    const hear = (page: EmailMailboxPageComponent, outcome: 'done' | 'failed', reason: string | null = null): void => {
        const evt: MailFolderJobEvent = {
            type: 'mail.folders.job', jobId: 'job-e', mailboxId: 'mb1', folder: 'Trash', action: 'empty', outcome, count: 3, reason,
        };
        (page as unknown as { onFolderJob(e: MailFolderJobEvent): void }).onFolderJob(evt);
    };

    it('is offered only where canEmpty is true, in the danger style', () => {
        const page = build();

        expect(menuOf(page, 'Trash').map(i => [i.id, i.danger === true])).toEqual([['empty', true]]);
        expect(menuOf(page, 'Junk').map(i => i.id)).withContext('Spam without canEmpty').toEqual([]);
        expect(menuOf(page, 'INBOX').map(i => i.id)).toEqual(['mark-read']);
        page.onFolderAction('empty', 'Junk');
        page.onFolderAction('empty', 'INBOX');
        expect(previewsAsked).toEqual([]);
    });

    it('previews first and shows its title, body and confirm as given in a destructive confirm', () => {
        const page = build();
        page.onFolderAction('empty', 'Trash');

        expect(previewsAsked).toEqual(['Trash']);
        expect(confirms).toEqual([{
            title: 'Papierkorb leeren?', message: '3 Nachrichten werden endgueltig geloescht.', confirmLabel: 'Endgueltig leeren',
            danger: true,
        }]);
    });

    it('cancelled, nothing is removed', () => {
        confirmAnswer = false;
        const page = build();
        page.onFolderAction('empty', 'Trash');

        expect(emptied).toEqual([]);
        expect(busyOf(page, 'Trash')).toBeNull();
    });

    it('confirmed, empties with the preview\'s numbers; busy until mail.folders.job done; the removed rows leave the list', () => {
        const page = build();
        expect(page.messages().map(m => m.id)).toEqual(['t1', 't2', 't3']);
        page.onFolderAction('empty', 'Trash');

        expect(emptied).toEqual([['Trash', 812, 1700000001]]);
        expect(busyOf(page, 'Trash')).toBe('empty');
        expect(menuOf(page, 'Trash')).withContext('busy: nothing offered').toEqual([]);

        // The removed rows arrive as gone; mail that came after the preview (t3 here) is not among them and stays.
        const gone = readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'action', seq: 5,
            changes: [{ id: 't1', folder: 'Trash', gone: true }, { id: 't2', folder: 'Trash', gone: true }],
            counts: { Trash: { total: 1, unseen: 0, serverTotal: 1, serverUnseen: 0 } },
        }) as MailMessagesChangedEvent;
        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(gone);
        expect(page.messages().map(m => m.id)).toEqual(['t3']);

        const asked = treeAsked;
        hear(page, 'done');
        expect(busyOf(page, 'Trash')).toBeNull();
        expect(treeAsked).toBe(asked + 1);
        expect(shown).withContext('done adds nothing').toEqual([]);
    });

    it('a failed Empty says why with Retry, which previews again rather than reusing the numbers', () => {
        const page = build();
        page.onFolderAction('empty', 'Trash');
        hear(page, 'failed', 'server-failed');

        expect(shown.length).toBe(1);
        expect(shown[0].message).toContain('Bin');
        previews = [() => of(preview({ uidCeiling: 900, count: 5 }))];
        shown[0].action?.run();
        expect(previewsAsked).toEqual(['Trash', 'Trash']);
        expect(emptied[1]).toEqual(['Trash', 900, 1700000001]);
    });

    it('a folder renumbered since the preview is previewed again, its new numbers shown, never sent with the old', () => {
        let refusals = 1;
        emptyAnswer = () => (refusals-- > 0
            ? throwError(() => problem(409, { type: '/errors/email/folder-renumbered' }))
            : of({ jobId: 'job-e', mailboxId: 'mb1', folder: 'Trash', action: 'empty', outcome: 'running', count: 0, reason: null }));
        previews = [
            () => of(preview()),
            () => of(preview({ body: '5 Nachrichten werden endgueltig geloescht.', count: 5, uidCeiling: 940, uidValidity: 1700000002 })),
        ];
        const page = build();
        page.onFolderAction('empty', 'Trash');

        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('changed on the mail server');
        expect(previewsAsked).toEqual(['Trash', 'Trash']);
        expect(confirms.map(c => c.message)).toEqual(['3 Nachrichten werden endgueltig geloescht.', '5 Nachrichten werden endgueltig geloescht.']);
        expect(emptied).toEqual([['Trash', 812, 1700000001], ['Trash', 940, 1700000002]]);
        hear(page, 'done');
    });

    it('each other refusal of Empty says its own sentence, and nothing is busy', () => {
        const cases: Array<[number, Record<string, unknown>]> = [
            [422, { type: '/errors/email/folder-not-emptiable', reason: 'not-allowed' }],
            [422, { type: '/errors/email/folder-not-emptiable', reason: 'not-trash-or-spam' }],
            [422, { type: '/errors/email/folder-not-emptiable', reason: 'ceiling-required' }],
            [422, { type: '/errors/email/folder-not-emptiable', reason: 'no-uidplus' }],
            [409, { type: '/errors/email/mailbox-held' }],
            [409, { type: '/errors/email/folder-busy', action: 'mark-read' }],
            [404, { type: '/errors/email/folder-not-found' }],
        ];
        const said: string[] = [];
        for (const [status, body] of cases) {
            emptyAnswer = () => throwError(() => problem(status, body));
            const page = build();
            page.onFolderAction('empty', 'Trash');

            expect(errors.length).withContext(String(body['type'])).toBe(1);
            expect(busyOf(page, 'Trash')).toBeNull();
            expect(previewsAsked.length).withContext('no second preview').toBe(1);
            said.push(errors[0]);
        }
        expect(new Set(said).size).toBe(cases.length);
        expect(said[5]).toBe('Mark all as read is running in this folder.');
    });

    it('a preview refused (legal hold) says so, and no confirm is shown', () => {
        previews = [() => throwError(() => problem(409, { type: '/errors/email/mailbox-held' }))];
        const page = build();
        page.onFolderAction('empty', 'Trash');

        expect(confirms).toEqual([]);
        expect(errors[0]).toContain('legal hold');
    });
});
