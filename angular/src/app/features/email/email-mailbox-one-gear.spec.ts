import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, ErrorHandlerService, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
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
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

function toolbarNode(path: string, meta: Record<string, unknown>): NaviGraphNode {
    return { id: path, path, title: path, parentId: null, sortOrder: 0, isActive: true, isVisible: true, meta, children: [] };
}

/** The page's toolbar tree as the server serves it: page actions in the header, the mailbox's settings in the bar. */
const NODES: NaviGraphNode[] = [
    toolbarNode('/compose', { icon: 'pencil-square', label: 'Compose', action: 'compose', position: 'header' }),
    toolbarNode('/mailbox-settings', { icon: 'gear', label: 'Settings', action: 'mailbox-settings', surface: 'both' }),
];

/** The rendered page shows one gear for a mailbox's settings, on the mailbox's card; the page's bar draws none. */
describe('EmailMailboxPageComponent -- one gear, on the mailbox card', () => {
    function render(nodes: NaviGraphNode[]): HTMLElement {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of([]),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (selector: unknown) => selector === AppConfigState.manifest
                            ? { navi: { graphBySlug: '/navi/{slug}' } }
                            : null,
                    },
                },
                { provide: NaviGraphService, useValue: { loadTree: () => of(nodes), isVisible: () => true } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        const fixture = TestBed.createComponent(EmailMailboxPageComponent);
        fixture.detectChanges();
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    /** The gears a person can see: drawn, and not inside anything not displayed. */
    const visibleGears = (el: HTMLElement): HTMLElement[] =>
        Array.from(el.querySelectorAll<HTMLElement>('.bi-gear'))
            .map(icon => icon.closest<HTMLElement>('button') ?? icon)
            .filter(button => button.getClientRects().length > 0);

    it('with the settings offered: one gear, and it is the card\'s', () => {
        const el = render(NODES);
        const gears = visibleGears(el);

        expect(gears.length).toBe(1);
        expect(gears[0].closest('app-mailbox-switcher')).withContext('the gear sits on the mailbox card').not.toBeNull();
    });

    it('without the settings node: no gear', () => {
        expect(visibleGears(render(NODES.slice(0, 1))).length).toBe(0);
    });
});
