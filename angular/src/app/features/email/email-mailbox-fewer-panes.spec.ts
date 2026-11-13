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
import { MAIL_MESSAGE_MIN, MAIL_PANE_CACHE_KEYS, MAIL_THREE_PANES_MIN, MAIL_TWO_PANES_MIN, mailPaneCount } from './mail-panes.directive';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * The message pane is never narrower than 360px: where the mail grid cannot hold the folders, the list and the
 * message at their minimums (854px with both splitters), it shows the list and the message, the folders one press
 * away in the list's place; where it cannot hold those two (647px), one pane at a time, as on a phone. The grid's own
 * width decides, measured in real layout.
 */
describe('EmailMailboxPageComponent -- fewer panes where three would not fit', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;

    beforeEach(() => {
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
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
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const rail = (): HTMLElement => part('.mbx__rail');
    const list = (): HTMLElement => part('.mbx__list');
    const detail = (): HTMLElement => part('.mbx__detail');
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

    it('counts three panes from 854px, two from 647px, one below; three while the grid is not measured', () => {
        expect(MAIL_THREE_PANES_MIN).toBe(200 + 280 + 360 + 14);
        expect(MAIL_TWO_PANES_MIN).toBe(280 + 360 + 7);
        expect([0, 1440, 854, 853, 647, 646, 400].map(mailPaneCount)).toEqual([3, 3, 3, 2, 2, 1, 1]);
    });

    it('at 1440px all three panes show side by side, and no folders control', async () => {
        await render(1440);

        expect(part('.mbx__body').offsetWidth).toBe(1440);
        expect(shown(rail())).withContext('folders').toBeTrue();
        expect(shown(list())).withContext('list').toBeTrue();
        expect(shown(detail())).withContext('message').toBeTrue();
        expect(shown(foldersControl())).withContext('folders control').toBeFalse();
        expect(detail().offsetWidth).toBeGreaterThanOrEqual(MAIL_MESSAGE_MIN);
    });

    it('under the three minimums (760px): the list and a message pane of at least 360px; the folders behind their control', async () => {
        await render(760);

        expect(shown(rail())).withContext('folders hidden').toBeFalse();
        expect(shown(part('.mbx__split-folders'))).withContext('no folders splitter').toBeFalse();
        expect(shown(list())).withContext('list').toBeTrue();
        expect(shown(detail())).withContext('message').toBeTrue();
        expect(detail().offsetWidth).toBeGreaterThanOrEqual(MAIL_MESSAGE_MIN);
        expect(shown(foldersControl())).withContext('folders control').toBeTrue();

        // The control shows the folders in the list's place, at its width; the message keeps its minimum.
        const listWidth = list().offsetWidth;
        foldersControl().click();
        await settle();
        expect(shown(rail())).withContext('folders shown').toBeTrue();
        expect(shown(list())).withContext('list put away').toBeFalse();
        expect(rail().offsetWidth).toBe(listWidth);
        expect(detail().offsetWidth).toBeGreaterThanOrEqual(MAIL_MESSAGE_MIN);

        // Choosing a folder puts them away again.
        fixture.componentInstance.selectFolder('Archive');
        await settle();
        expect(shown(rail())).toBeFalse();
        expect(shown(list())).toBeTrue();
    });

    it('just under the three minimums (853px): the list gives way, the message pane keeps 360px', async () => {
        await render(853);

        expect(shown(rail())).toBeFalse();
        expect(detail().offsetWidth).toBeGreaterThanOrEqual(MAIL_MESSAGE_MIN);
        expect(list().offsetWidth).toBeGreaterThanOrEqual(280);
    });

    it('under the two minimums (620px): one pane at a time, the list, as on a phone', async () => {
        await render(620);

        expect(shown(list())).withContext('list').toBeTrue();
        expect(shown(rail())).withContext('folders').toBeFalse();
        expect(shown(detail())).withContext('message').toBeFalse();
        expect(fixture.componentInstance.onePane()).toBeTrue();
    });
});
