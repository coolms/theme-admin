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
import { type EmailFolderDto, type EmailFolderTreeNodeDto, type EmailMailboxDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

function node(folder: string, name: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return { folder, name, selectable: true, total: 2, unseen: 0, role: null, children: [], ...over };
}

/**
 * The server's tree, its order and names neither alphabetical nor what a role would be called: a heading first, so
 * the folder opened first is the tree's first that opens, not the flat list's first.
 */
const TREE: EmailFolderTreeNodeDto[] = [
    node('Projects', 'Projects', { selectable: false, children: [node('Projects/Mango', 'Mango')] }),
    node('INBOX', 'Mail that came in', { role: 'inbox' }),
    node('Zulu', 'Zulu'),
    node('Alpha', 'Alpha'),
];
/** The flat list, in its own (alphabetical) order: it carries counts only. */
const FLAT: EmailFolderDto[] = [
    { folder: 'Alpha', total: 2, unseen: 1 },
    { folder: 'INBOX', role: 'inbox', total: 5, unseen: 3 },
    { folder: 'Projects/Mango', total: 1, unseen: 0 },
    { folder: 'Zulu', total: 2, unseen: 0 },
];

/**
 * The mail page draws its folders from the server's tree only: its order and names, the first folder that opens
 * selected; a tree that cannot be read is an error with Retry, never a list made from the flat one; counts move with
 * realtime without moving a row. The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- the folders as the server gives them', () => {
    let treeAnswers: Array<() => Observable<EmailFolderTreeNodeDto[]>>;
    let treeAsked: number;

    function build(): EmailMailboxPageComponent {
        treeAsked = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of(FLAT),
                        folderTree: () => treeAnswers[Math.min(treeAsked++, treeAnswers.length - 1)](),
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

        return TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
    }

    const rowsOf = (page: EmailMailboxPageComponent): Array<[string, string, number]> =>
        page.folderRows().map(r => [r.name, r.folder.folder, r.depth]);

    it('the rows are the tree\'s, in its order and by its names; the first folder that opens is selected', () => {
        treeAnswers = [() => of(TREE)];
        const page = build();
        page.selectedFolder.set('Nowhere');

        page.loadMailboxes();

        expect(rowsOf(page)).toEqual([
            ['Projects', 'Projects', 0],
            ['Mango', 'Projects/Mango', 1],
            ['Mail that came in', 'INBOX', 0],
            ['Zulu', 'Zulu', 0],
            ['Alpha', 'Alpha', 0],
        ]);
        expect(page.selectedFolder()).toBe('Projects/Mango');
        expect(page.foldersFailure()).toBeNull();
    });

    it('the open folder\'s title, a search hit\'s folder and Move name folders as the tree does', () => {
        treeAnswers = [() => of(TREE)];
        const page = build();
        page.loadMailboxes();
        page.selectedFolder.set('INBOX');

        expect(page.selectedFolderName()).toBe('Mail that came in');
        expect(page.folderNameOf('INBOX')).toBe('Mail that came in');
        const choices = (page as unknown as { moveChoices(): Array<{ folder: string; name: string }> }).moveChoices();
        expect(choices.map(c => c.name)).withContext('Move offers the folders that open, in the tree\'s order')
            .toEqual(['Mango', 'Mail that came in', 'Zulu', 'Alpha']);
    });

    it('a tree that cannot be read is the rail\'s error: no rows, no name made here; Retry reads it again', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        treeAnswers = [() => throwError(() => failure), () => of(TREE)];
        const page = build();
        page.selectedFolder.set('INBOX');

        page.loadMailboxes();

        expect(page.foldersFailure()).toBe(failure);
        expect(page.folderRows()).withContext('the flat list answered, and draws nothing').toEqual([]);
        expect(page.selectedFolderName()).toBe('');

        page.retryFolders();

        expect(treeAsked).toBe(2);
        expect(page.foldersFailure()).toBeNull();
        expect(page.folderRows().length).toBe(5);
    });

    it('a realtime change moves the counts, never the rows', () => {
        treeAnswers = [() => of(TREE)];
        const page = build();
        page.loadMailboxes();
        const before = rowsOf(page);
        const event: MailMessagesChangedEvent = {
            type: 'mail.messages.changed',
            mailboxId: 'mb1',
            origin: 'sync',
            seq: 1,
            changes: [],
            counts: { Alpha: { total: 9, unseen: 7, serverTotal: null, serverUnseen: null } },
            mailboxUnseen: 10,
        };

        (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(event);

        expect(rowsOf(page)).toEqual(before);
        const alpha = page.folderRows().find(r => r.folder.folder === 'Alpha');
        expect(alpha?.folder.unseen).toBe(7);
        expect(alpha?.folder.total).toBe(9);
    });
});
