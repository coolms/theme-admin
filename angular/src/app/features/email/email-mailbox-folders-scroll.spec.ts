import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
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
import { type EmailFolderTreeNodeDto, type EmailMailboxDto, type EmailMessageList } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/** More folders than the column can show at the page's height. */
const FOLDERS: EmailFolderTreeNodeDto[] = [
    { folder: 'INBOX', name: 'Inbox', selectable: true, children: [], total: 3, unseen: 0 },
    ...Array.from({ length: 40 }, (_, i) => ({ folder: `P${i}`, name: `Project folder ${i + 1}`, selectable: true, children: [], total: 1, unseen: 0 })),
] as EmailFolderTreeNodeDto[];

/**
 * The folder column is a fixed head and one scroll region: the mailbox card stays at the column's top while the folders
 * under it scroll on their own. Real layout in the browser, the page 500px tall.
 */
describe('EmailMailboxPageComponent -- the folder column keeps its mailbox card', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: FOLDERS, canCreateTop: false, held: false }),
                        listMessages: () => of(Object.assign([], { next: null, serverPages: null }) as EmailMessageList),
                        searchMessages: () => NEVER,
                        serverSearch: () => NEVER,
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        olderMessages: () => NEVER,
                        getMessage: () => NEVER,
                        listThread: () => of([]),
                        markSeen: (id: string) => of({ ids: [id] }),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {}, dismiss: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' } : null) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {} } },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        const host = fixture.nativeElement as HTMLElement;
        host.style.height = '500px';
        host.style.width = '1400px';
        document.body.appendChild(host);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const column = (): HTMLElement => el().querySelector<HTMLElement>('.mbx__rail')!;
    const card = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="rail-card"]')!;
    const folders = (): HTMLElement => el().querySelector<HTMLElement>('.mbx__rail > app-mail-folder-rail')!;

    async function settle(): Promise<void> {
        await fixture.whenStable();
        fixture.detectChanges();
        await new Promise(r => requestAnimationFrame(() => r(null)));
    }

    it('scrolls the folders on their own, to their end, and the mailbox card stays at the column\'s top', async () => {
        await settle();
        expect(folders().scrollHeight).withContext('the folders overflow the column').toBeGreaterThan(folders().clientHeight);
        const top = card().getBoundingClientRect().top;
        folders().scrollTop = folders().scrollHeight;
        column().scrollTop = column().scrollHeight;
        await settle();
        expect(folders().scrollTop).withContext('the folders scrolled').toBeGreaterThan(0);
        expect(column().scrollTop).withContext('the column itself does not scroll').toBe(0);
        expect(card().getBoundingClientRect().top).withContext('the card has not moved').toBe(top);
        expect(getComputedStyle(folders()).overflowY).toBe('auto');
        expect(['auto', 'scroll']).withContext('the column is never a scroll region itself').not.toContain(getComputedStyle(column()).overflowY);
    });
});
