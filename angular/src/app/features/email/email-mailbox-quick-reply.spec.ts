import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
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
import { type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto, type OutgoingEmailRequest } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday', fromName: 'Ann Lee', fromAddress: 'ann@example.com' }];

/** The open message, its plain body `lines` lines long. */
function message(lines: number): EmailMessageDetailDto {
    const body = Array.from({ length: lines }, (_, i) => `Line ${i + 1} of the note.`).join('\n');
    return { ...LISTED[0], bodyText: body } as EmailMessageDetailDto;
}

/**
 * The quick reply in the message pane: one "Reply…" line at the foot of the message, inside the pane's one scroll
 * region, and at the pane's foot under a short message, so it never moves up when the message gets shorter. Choosing
 * the line (a click, Enter or Space; focus alone does not), or Reply, opens the reply's composer there, in view and
 * focused; it sends as the dock's reply does and folds back to the line. Reply all and Forward keep the dock. The page is rendered and laid out at 1400 x 600,
 * fixed at the window's top left.
 */
describe('EmailMailboxPageComponent -- quick reply at the pane\'s foot', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let replies: Array<{ id: string; request: OutgoingEmailRequest }>;

    beforeEach(() => {
        replies = [];
        const drafts = new Map<string, unknown>();
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(LISTED),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                        compose: () => NEVER,
                        reply: (id: string, request: OutgoingEmailRequest) => {
                            replies.push({ id, request });
                            return of({});
                        },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                {
                    provide: DraftStoreService,
                    useValue: {
                        load: (key: string) => drafts.get(key) ?? null,
                        save: (key: string, value: unknown) => void drafts.set(key, value),
                        clear: (key: string) => void drafts.delete(key),
                    },
                },
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
        const host = fixture.nativeElement as HTMLElement;
        host.style.display = 'flex';
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '1400px';
        host.style.height = '600px';
        document.body.appendChild(host);
        fixture.componentInstance.composeRich.set(false);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await frame();
        }
        await fixture.whenStable();
        fixture.detectChanges();
    }
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const scroll = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-scroll"]')!;
    const reply = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="quick-reply"]')!;
    const line = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-test="quick-reply-line"]');
    const composer = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="quick-reply-composer"]');
    const dock = (): HTMLElement | null => el().querySelector<HTMLElement>('.mbx__dock');
    const bodyBottom = (): number => el().querySelector<HTMLElement>('.mbx__detail-body')!.getBoundingClientRect().bottom;
    /** Where the pane's content ends: the scroll region's bottom, less its padding. */
    const paneFoot = (): number => scroll().getBoundingClientRect().bottom - parseFloat(getComputedStyle(scroll()).paddingBottom);

    async function open(lines: number): Promise<void> {
        fixture.componentInstance.selectedMessage.set(message(lines));
        await settle();
    }

    it('shows one "Reply…" line, last in the pane\'s one scroll region, until it is used', async () => {
        await open(3);

        expect(reply().parentElement).withContext('inside the scroll region').toBe(scroll());
        expect(scroll().lastElementChild).withContext('after the message and its files').toBe(reply());
        expect(line()?.textContent?.trim()).toBe('Reply…');
        expect(composer()).toBeNull();
        expect(reply().querySelector('textarea, input')).toBeNull();
        expect(getComputedStyle(reply()).position).withContext('not pinned, not sticky').toBe('static');
    });

    it('sits at the pane\'s foot under a short message, and stays there when the message gets shorter', async () => {
        await open(8);
        expect(scroll().scrollHeight).withContext('the message fits the pane').toBeLessThanOrEqual(scroll().clientHeight);
        expect(reply().getBoundingClientRect().bottom).withContext('at the pane\'s foot').toBeCloseTo(paneFoot(), 0);
        expect(reply().getBoundingClientRect().top - bodyBottom()).withContext('free space above it').toBeGreaterThan(50);
        const before = reply().getBoundingClientRect().top;

        await open(2);

        expect(reply().getBoundingClientRect().top).withContext('never moves up').toBeCloseTo(before, 0);
    });

    it('follows a long message, right after it', async () => {
        await open(200);
        expect(scroll().scrollHeight).withContext('the message is longer than the pane').toBeGreaterThan(scroll().clientHeight);

        expect(reply().getBoundingClientRect().top).withContext('right after the message').toBeCloseTo(bodyBottom(), 0);
        expect(reply().getBoundingClientRect().top).withContext('below the pane, until scrolled to')
            .toBeGreaterThan(scroll().getBoundingClientRect().bottom);
    });

    it('stays a line when it only takes the focus, and opens as the reply\'s composer on Enter, the dock staying closed', async () => {
        await open(3);
        expect(line()!.getAttribute('aria-label')).toBe('Reply to Ann Lee');

        line()!.focus();
        await settle();

        expect(document.activeElement).withContext('tabbing onto it focuses the line').toBe(line());
        expect(composer()).withContext('focus alone opens nothing').toBeNull();

        line()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await settle();

        expect(composer()).withContext('Enter opens the composer in the pane').not.toBeNull();
        expect(line()).toBeNull();
        expect(dock()).withContext('no dock').toBeNull();
        const page = fixture.componentInstance;
        expect(page.composeMode()).toBe('reply');
        expect(page.composeTo).toEqual(['ann@example.com']);
        expect(page.composeSubject).toBe('Re: Desk move on Friday');
        expect(document.activeElement).withContext('its body has the focus').toBe(composer()!.querySelector('textarea'));
    });

    it('Reply scrolls the pane to the quick reply, opens it and focuses it', async () => {
        await open(200);
        expect(scroll().scrollTop).toBe(0);

        fixture.componentInstance.onDetailAction('reply');
        await settle();

        expect(composer()).not.toBeNull();
        expect(dock()).toBeNull();
        expect(scroll().scrollTop).withContext('the pane scrolled').toBeGreaterThan(0);
        const box = composer()!.getBoundingClientRect();
        const pane = scroll().getBoundingClientRect();
        expect(box.top).withContext('in view').toBeLessThan(pane.bottom);
        expect(box.bottom).withContext('in view').toBeGreaterThan(pane.top);
        expect(document.activeElement).toBe(composer()!.querySelector('textarea'));
    });

    it('sends through the reply\'s send and folds back to the line', async () => {
        await open(3);
        fixture.componentInstance.openQuickReply();
        await settle();
        fixture.componentInstance.composeText = 'Friday works.';

        Array.from(composer()!.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === 'Send')!.click();
        await settle();

        expect(replies.length).toBe(1);
        expect(replies[0].id).toBe('m1');
        expect(replies[0].request.text).toBe('Friday works.');
        expect(replies[0].request.to).toEqual(['ann@example.com']);
        expect(replies[0].request.subject).toBe('Re: Desk move on Friday');
        expect(composer()).toBeNull();
        expect(line()).withContext('the line again').not.toBeNull();
    });

    it('keeps the dock for Reply all and Forward, and the line in the pane', async () => {
        await open(3);

        fixture.componentInstance.onDetailAction('forward');
        await settle();
        expect(dock()).withContext('Forward').not.toBeNull();
        expect(line()).not.toBeNull();

        fixture.componentInstance.closeCompose();
        fixture.componentInstance.onDetailAction('reply-all');
        await settle();
        expect(dock()).withContext('Reply all').not.toBeNull();
        expect(composer()).toBeNull();
    });
});
