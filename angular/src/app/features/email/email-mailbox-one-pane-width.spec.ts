import { type ComponentFixture, TestBed } from '@angular/core/testing';
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
import { type EmailMailboxDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MAIL_PANE_CACHE_KEYS } from './mail-panes.directive';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * One pane at a time (a phone, or a grid under the two minimums): the pane shown fills the grid, whatever width the
 * person saved for the splitters. The splitters write their saved width on their pane inline; the one-pane rules win
 * over it, as the two-pane rule does. Where three panes show, the saved widths stand.
 */
describe('EmailMailboxPageComponent -- one pane fills the grid over the saved widths', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;

    beforeEach(() => {
        // A saved folder width of 230 and list width of 340, as a person's widths are cached.
        localStorage.setItem(MAIL_PANE_CACHE_KEYS.folders, '230');
        localStorage.setItem(MAIL_PANE_CACHE_KEYS.list, '340');
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of(Object.assign([], { next: null, serverPages: null })),
                        olderMessages: () => NEVER,
                        listThread: () => of([]),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
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
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {} } },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
    });
    afterEach(() => {
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const rail = (): HTMLElement => part('.mbx__rail');
    const list = (): HTMLElement => part('.mbx__list');
    const foldersControl = (): HTMLElement => part('[data-test="phone-folders"]');
    const shown = (e: HTMLElement): boolean => getComputedStyle(e).display !== 'none' && e.offsetWidth > 0;
    /** The ResizeObserver's answer, then the redraw it asks for. */
    const settle = async (): Promise<void> => {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await new Promise(r => setTimeout(r, 30));
        }
        fixture.detectChanges();
    };

    /** The page in a box this wide (the grid takes its whole width), laid out by the browser. */
    async function render(width: number): Promise<void> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        el().style.cssText = `display: flex; flex-direction: column; width: ${width}px; height: 700px`;
        document.body.appendChild(el());
        await settle();
    }

    it('one pane at 300px, folders shown: the rail fills the grid, not the saved 230px', async () => {
        await render(300);
        expect(fixture.componentInstance.onePane()).toBeTrue();
        foldersControl().click();
        await settle();

        expect(shown(rail())).toBeTrue();
        expect(rail().style.width).withContext('the splitter wrote the saved width on the rail').toBe('230px');
        expect(rail().offsetWidth).toBe(part('.mbx__body').offsetWidth);
        expect(rail().offsetWidth).toBe(300);
    });

    it('one pane at 300px, the list shown: it fills the grid, not the saved 340px', async () => {
        await render(300);

        expect(shown(list())).toBeTrue();
        expect(list().offsetWidth).toBe(300);
    });

    it('three panes at 1440px: the saved widths stand', async () => {
        await render(1440);

        expect(rail().offsetWidth).toBe(230);
        expect(list().offsetWidth).toBe(340);
    });
});
