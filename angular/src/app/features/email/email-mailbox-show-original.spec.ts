import { Dialog } from '@angular/cdk/dialog';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, ErrorHandlerService, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import { type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { MessageSourceViewerComponent } from './message-source-viewer.component';

function node(path: string, meta: Record<string, unknown>): NaviGraphNode {
    return { id: path, path, title: path, parentId: null, sortOrder: 0, isActive: true, isVisible: true, meta, children: [] };
}

/** The message tree as the server serves it, Show original among it: menu only (overflow 0). */
const MESSAGE_NODES: NaviGraphNode[] = [
    node('/reply', { action: 'reply', label: 'Reply', icon: 'reply', group: 'respond' }),
    node('/archive', { action: 'archive', label: 'Archive', icon: 'archive', group: 'remove' }),
    node('/show-original', { action: 'show-original', label: 'Show original', icon: 'file-earmark-code', group: 'view', overflow: 0 }),
];

const LISTED: EmailMessageDto[] = [
    { id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday' },
    { id: 'm2', folder: 'INBOX', subject: 'Statement for October' },
];

/**
 * Show original on the mailbox page: an action of the open message behind More actions only, never in its row; it
 * opens the viewer for one message and never for several; and the reading pane neither shows the source nor reads it.
 */
describe('EmailMailboxPageComponent -- show original', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let opened: { component: unknown; data: unknown }[];

    beforeEach(() => {
        opened = [];
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        // The open message's quick reply asks for its reply prefill; not answered here.
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(LISTED),
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
                {
                    provide: NaviGraphService,
                    useValue: {
                        loadTree: (url: string) => of(url.endsWith('navi.toolbar.email.message') ? MESSAGE_NODES : []),
                        isVisible: () => true,
                        matchesShowWhen: () => false,
                    },
                },
                {
                    provide: Dialog,
                    useValue: { open: (component: unknown, config: { data: unknown }) => void opened.push({ component, data: config.data }) },
                },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    async function settle(): Promise<void> {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await frame();
        }
        await fixture.whenStable();
        fixture.detectChanges();
    }
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const row = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-row"]')!;

    /** Opens m1 in the reader; the detail's rawBody, were the server still to send it, counts each read. */
    function openWithRawBody(): { reads: () => number } {
        let reads = 0;
        const detail = { ...LISTED[0], bodyText: 'The movers come at nine.' } as EmailMessageDetailDto;
        Object.defineProperty(detail, 'rawBody', {
            enumerable: true,
            get: () => {
                reads++;
                return 'X-SECRET-RAW: inline source';
            },
        });
        fixture.componentInstance.selectedMessage.set(detail);

        return { reads: () => reads };
    }

    it('puts Show original behind More actions only, never in the open message\'s row, wide or narrow', async () => {
        openWithRawBody();
        for (const width of [1400, 320]) {
            el().style.width = `${width}px`;
            await settle();
            const action = row().querySelector<HTMLElement>('[data-action="show-original"]');
            expect(action).withContext(`drawn at ${width}`).not.toBeNull();
            expect(action!.hidden).withContext(`hidden from the row at ${width}`).toBeTrue();
            expect(action!.getClientRects().length).withContext(`takes no room at ${width}`).toBe(0);
            expect(row().querySelector('[data-action="more"]')).withContext(`More actions at ${width}`).not.toBeNull();
        }
        el().style.width = '1400px';
        await settle();
        expect(Array.from(row().querySelectorAll<HTMLElement>('[data-action]')).filter(b => !b.hidden).map(b => b.dataset['action']))
            .toEqual(['reply', 'archive', 'more']);
    });

    it('shows no source in the reading pane, and never reads rawBody', async () => {
        const raw = openWithRawBody();
        await settle();
        expect(el().textContent).toContain('The movers come at nine.');
        expect(el().querySelector('.mbx__raw')).toBeNull();
        expect(el().textContent).not.toContain('Raw source');
        expect(el().textContent).not.toContain('X-SECRET-RAW');
        expect(el().textContent).not.toContain('No raw source');
        expect(raw.reads()).withContext('reads of rawBody').toBe(0);
    });

    it('opens the viewer for one message, with its subject, and for several opens nothing', async () => {
        openWithRawBody();
        await settle();
        fixture.componentInstance.onDetailAction('show-original');
        expect(opened).toEqual([{ component: MessageSourceViewerComponent, data: { messageId: 'm1', subject: 'Desk move on Friday' } }]);

        fixture.componentInstance.onMessageAction('show-original', ['m2']);
        expect(opened[1]?.data).toEqual({ messageId: 'm2', subject: 'Statement for October' });

        fixture.componentInstance.onMessageAction('show-original', ['m1', 'm2']);
        expect(opened.length).toBe(2);
    });
});
