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
import { type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto, type EmailMessageList } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MAIL_PANE_CACHE_KEYS } from './mail-panes.directive';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';
const SHORT = 'Quarterly figures';
const LONG = 'Re: the quarterly figures and the plan for the spring campaign, with the notes from the last meeting and the list of open questions';

const stored = (id: string, subject: string): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null, sentAt: '2026-11-11T09:00:00+00:00',
});
const opened = (subject: string, id: string): EmailMessageDetailDto =>
    ({ ...stored(id, subject), bodyHtml: null, bodyText: 'The body.', hasAttachments: false }) as unknown as EmailMessageDetailDto;
const page = (rows: EmailMessageDto[]): EmailMessageList => Object.assign([...rows], { next: null, serverPages: null });

/** The open message's subject, in the browser's real layout: the type scale's step over 18px, semibold, whole on its lines. */
describe('EmailMailboxPageComponent -- the open message\'s subject', () => {
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
                        folderTree: () => of({ folders: [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: 3, unseen: 1 }], canCreateTop: false, held: false }),
                        listMessages: () => of(page([stored('m-1', SHORT), stored('m-2', LONG)])),
                        getMessage: (id: string) => of(opened(id === 'm-1' ? SHORT : LONG, id)),
                        markSeen: (id: string) => of({ ids: [id] }),
                        olderMessages: () => NEVER,
                        listThread: () => of([]),
                        composePrefill: () => NEVER,
                        draftsAnswering: () => NEVER,
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
                {
                    provide: DateTimeFormatService,
                    useValue: { row: () => '11 Nov 2026, 09:00', auto: () => '11 Nov 2026, 09:00', date: () => '', time: () => '', dateTime: () => '' },
                },
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
    async function settle(): Promise<void> {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 20)));
        }
        fixture.detectChanges();
    }
    async function open(subject: string, width: number): Promise<HTMLElement> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        el().style.cssText = `display: flex; flex-direction: column; width: ${width}px; height: 700px`;
        document.body.appendChild(el());
        await settle();
        fixture.componentInstance.selectFolder(FOLDER);
        await settle();
        const row = Array.from(el().querySelectorAll<HTMLElement>('.mbx__row')).find(r => r.textContent!.includes(subject.slice(0, 12)))!;
        row.querySelector<HTMLElement>('.mbx__row-main')!.click();
        await settle();
        return el().querySelector<HTMLElement>('.mbx__detail-subject')!;
    }
    const lines = (h: HTMLElement): number => {
        const range = document.createRange();
        range.selectNodeContents(h);
        return new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top))).size;
    };

    it('is 22px, semibold, on one line when it fits', async () => {
        const subject = await open(SHORT, 1440);
        expect(subject.textContent!.trim()).toBe(SHORT);
        expect(getComputedStyle(subject).fontSize).toBe('22px');
        expect(getComputedStyle(subject).fontWeight).toBe('600');
        expect(lines(subject)).toBe(1);
    });

    it('a long one wraps to more lines, whole: nothing is cut', async () => {
        const subject = await open(LONG, 1440);
        expect(subject.textContent!.trim()).toBe(LONG);
        expect(lines(subject)).toBeGreaterThan(1);
        expect(subject.scrollWidth).toBeLessThanOrEqual(subject.clientWidth);
        expect(subject.scrollHeight).toBeLessThanOrEqual(subject.clientHeight);
        expect(getComputedStyle(subject).textOverflow).toBe('clip');
    });
});
