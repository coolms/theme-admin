import { Dialog } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, Subject, of, throwError } from 'rxjs';
import { NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import {
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
    type EmailFolderTreeDto, type EmailFolderTreeNodeDto, type EmailMailboxDto, type FolderChangeDto, type FolderJobDto,
} from './email.types';
import { type FolderNameDialogData } from './folder-name-dialog.component';
import { type MailFolderJobEvent, jobFailureText } from './mail-folder-actions';
import { POLL_FIRST_MS } from './mail-folder-jobs';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

function node(folder: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return {
        folder, name: folder, selectable: true, total: 4, unseen: 2, role: null, children: [], system: false,
        hasChildren: false, canCreateChild: false, canRename: false, canDelete: false, canEmpty: false, canMarkRead: false,
        busy: null, ...over,
    };
}

/** Each folder offers something different; one is busy with a job someone else started. */
const TREE: EmailFolderTreeDto = {
    folders: [
        node('INBOX', { name: 'Inbox', role: 'inbox', system: true, canMarkRead: true }),
        node('Projects', { canCreateChild: true, canRename: true }),
        node('Old', { busy: 'empty' }),
    ],
    canCreateTop: true,
    held: false,
};

const running = (over: Partial<FolderJobDto> = {}): FolderJobDto => ({
    jobId: 'job-1', mailboxId: 'mb1', folder: 'INBOX', action: 'mark-read', outcome: 'running', count: 0, reason: null,
    ...over,
});

/** The showWhen evaluation of the NaviGraph service, for `eq`. */
const isVisible = (n: NaviGraphNode, record: Record<string, unknown>): boolean => {
    const when = n.meta['showWhen'] as { field: string; value: unknown } | undefined;
    return when === undefined || (when.field in record && record[when.field] === when.value);
};

/**
 * Folder actions on the mail page: a row's menu offers exactly what the tree's flags say; Mark all as read runs as a
 * job, the row busy until its end (realtime, or read over REST while realtime is down); a refusal is said in words.
 */
describe('EmailMailboxPageComponent -- folder actions', () => {
    let treeAsked: number;
    let marks: Array<[string, string]>;
    let markAnswer: () => Observable<FolderJobDto>;
    let jobReads: string[];
    let jobAnswer: () => Observable<FolderJobDto>;
    let realtime: boolean;
    let menus: ContextMenuItem[][];
    let shown: ToastInput[];
    let errors: string[];
    let dialogs: FolderNameDialogData[];
    let creates: Array<[string, string | null]>;

    function build(): EmailMailboxPageComponent {
        treeAsked = 0;
        marks = [];
        jobReads = [];
        menus = [];
        shown = [];
        errors = [];
        dialogs = [];
        creates = [];
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
                        listMessages: () => of([]),
                        markFolderRead: (mailboxId: string, folder: string) => {
                            marks.push([mailboxId, folder]);
                            return markAnswer();
                        },
                        folderJob: (_mailboxId: string, jobId: string) => {
                            jobReads.push(jobId);
                            return jobAnswer();
                        },
                        createFolder: (_mailboxId: string, name: string, parent: string | null): Observable<FolderChangeDto> => {
                            creates.push([name, parent]);
                            return of({ folder: `${parent ?? ''}/${name}`, from: null });
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
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER, connected: () => realtime, reconnects: () => NEVER } },
                { provide: NaviGraphService, useValue: { isVisible } },
                {
                    provide: ContextMenuService,
                    useValue: {
                        open: (_e: MouseEvent, items: ContextMenuItem[]): void => { menus.push(items); },
                        openFrom: (_o: HTMLElement, items: ContextMenuItem[]): void => { menus.push(items); },
                    },
                },
                {
                    provide: Dialog,
                    useValue: {
                        open: (_c: unknown, config: { data: FolderNameDialogData }) => {
                            dialogs.push(config.data);
                            return { closed: NEVER };
                        },
                    },
                },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        built.push(page);
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
        realtime = true;
        markAnswer = () => of(running());
        jobAnswer = () => of(running());
    });

    const menuOf = (page: EmailMailboxPageComponent, folder: string): string[] => {
        page.onFolderMenu({ folder, event: new MouseEvent('contextmenu'), opener: null });
        return (menus[menus.length - 1] ?? []).map(i => i.id);
    };
    const busyOf = (page: EmailMailboxPageComponent, folder: string): string | null =>
        page.railRows().find(r => r.folder.folder === folder)?.flags?.busy ?? null;
    const hear = (page: EmailMailboxPageComponent, over: Partial<FolderJobDto>): void => {
        const evt: MailFolderJobEvent = { ...running(over), type: 'mail.folders.job', outcome: over.outcome === 'failed' ? 'failed' : 'done' };
        (page as unknown as { onFolderJob(e: MailFolderJobEvent): void }).onFolderJob(evt);
    };

    it('each row offers exactly what its flags say, a busy folder none; an action not offered does nothing', () => {
        const page = build();

        expect(menuOf(page, 'INBOX')).toEqual(['mark-read']);
        expect(menuOf(page, 'Projects')).toEqual(['create-child', 'rename']);
        expect(menuOf(page, 'Old')).withContext('busy with Empty').toEqual([]);
        expect(busyOf(page, 'Old')).toBe('empty');
        expect(page.newFolderLabel()).toBe('New folder');

        page.onFolderAction('rename', 'INBOX');
        page.onFolderAction('mark-read', 'Projects');
        page.onFolderAction('mark-read', 'Old');
        expect(dialogs).toEqual([]);
        expect(marks).toEqual([]);
    });

    it('Mark all as read posts, shows the row busy offering nothing, and ends on mail.folders.job done', () => {
        const page = build();
        page.onFolderAction('mark-read', 'INBOX');

        expect(marks).toEqual([['mb1', 'INBOX']]);
        expect(busyOf(page, 'INBOX')).toBe('mark-read');
        expect(menuOf(page, 'INBOX')).toEqual([]);
        const asked = treeAsked;

        hear(page, { outcome: 'done', count: 40 });

        expect(busyOf(page, 'INBOX')).toBeNull();
        expect(treeAsked).withContext('the folders and their counts are read again').toBe(asked + 1);
        expect(shown).withContext('a job that is done adds nothing').toEqual([]);
        expect(errors).toEqual([]);
    });

    it('a failed job says its reason in a sentence with Retry, for each reason, and the row is no longer busy', () => {
        const page = build();
        const said: string[] = [];
        for (const reason of ['server-failed', 'folder-not-found', 'renumbered']) {
            shown = [];
            marks = [];
            page.onFolderAction('mark-read', 'INBOX');
            hear(page, { outcome: 'failed', reason });

            expect(busyOf(page, 'INBOX')).withContext(reason).toBeNull();
            expect(shown.length).withContext(reason).toBe(1);
            expect(shown[0].type).toBe('error');
            expect(shown[0].message).toContain('Inbox');
            said.push(shown[0].message);
            expect(shown[0].action?.label).toBe('Retry');
            shown[0].action?.run();
            expect(marks).withContext('Retry asks again').toEqual([['mb1', 'INBOX'], ['mb1', 'INBOX']]);
            hear(page, { outcome: 'done' });
        }
        expect(new Set(said).size).withContext('each reason its own sentence').toBe(3);
    });

    it('without realtime, the job is read until it ends', fakeAsync(() => {
        realtime = false;
        const page = build();
        page.onFolderAction('mark-read', 'INBOX');
        tick(POLL_FIRST_MS);
        expect(jobReads).toEqual(['job-1']);
        expect(busyOf(page, 'INBOX')).toBe('mark-read');

        jobAnswer = () => of(running({ outcome: 'done', count: 7 }));
        const asked = treeAsked;
        tick(POLL_FIRST_MS * 2);

        expect(jobReads.length).toBe(2);
        expect(busyOf(page, 'INBOX')).toBeNull();
        expect(treeAsked).toBe(asked + 1);
        tick(POLL_FIRST_MS * 100);
        expect(jobReads.length).withContext('nothing read after the end').toBe(2);
    }));

    it('done heard before the POST answers: the row is not busy, and nothing is said', () => {
        const answer = new Subject<FolderJobDto>();
        markAnswer = () => answer;
        const page = build();
        page.onFolderAction('mark-read', 'INBOX');
        hear(page, { outcome: 'done', count: 2 });
        answer.next(running());

        expect(busyOf(page, 'INBOX')).toBeNull();
        expect(page.folderJobs.running().size).toBe(0);
        expect(shown).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('failed heard before the POST answers: the row is not busy, and its reason is said', () => {
        const answer = new Subject<FolderJobDto>();
        markAnswer = () => answer;
        const page = build();
        page.onFolderAction('mark-read', 'INBOX');
        hear(page, { outcome: 'failed', reason: 'server-failed' });
        expect(shown).withContext('not said while it is not known as this page\'s').toEqual([]);
        answer.next(running());

        expect(busyOf(page, 'INBOX')).toBeNull();
        expect(shown.map(t => t.message)).toEqual([jobFailureText({ action: 'mark-read', reason: 'server-failed' }, 'Inbox')]);
    });

    it('a repeated click while it runs asks nothing more: the one job stays followed', () => {
        const page = build();
        page.onFolderAction('mark-read', 'INBOX');
        page.onFolderAction('mark-read', 'INBOX');

        expect(marks.length).toBe(1);
        expect(page.folderJobs.running().size).toBe(1);
        hear(page, { outcome: 'done' });
    });

    it('a folder-busy refusal names the running action, and the folders are read again', () => {
        markAnswer = () => throwError(() => new HttpErrorResponse({
            status: 409, error: { type: '/errors/email/folder-busy', action: 'empty', title: 'Conflict' },
        }));
        const page = build();
        const asked = treeAsked;
        page.onFolderAction('mark-read', 'INBOX');

        expect(errors).toEqual(['Empty is running in this folder.']);
        expect(busyOf(page, 'INBOX')).toBeNull();
        expect(treeAsked).toBe(asked + 1);
    });

    it('New folder inside asks for a name, creates it there, and words a \\Noinferiors refusal', () => {
        const page = build();
        page.onFolderAction('create-child', 'Projects');

        expect(dialogs.length).toBe(1);
        expect(dialogs[0].title).toBe('New folder in Projects');
        dialogs[0].save('Mango', dialogs[0].parent).subscribe();
        expect(creates).toEqual([['Mango', 'Projects']]);
        expect(dialogs[0].refusal(new HttpErrorResponse({
            status: 422, error: { type: '/errors/email/folder-parent-invalid' },
        }))).toBe('The mail server does not allow folders inside this folder.');

        page.createTopFolder();
        expect(dialogs[1].parent).withContext('New folder at the foot: the top level').toBeNull();
    });
});
