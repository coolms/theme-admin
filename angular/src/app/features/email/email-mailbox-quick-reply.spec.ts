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
import { type ComposeDraft } from './compose-draft';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailComposeDto, type EmailComposeMode, type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto,
    type OutgoingEmailRequest,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { QUICK_REPLY_MAX_LINES, QUICK_REPLY_SAVE_MS } from './mail-quick-reply.component';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday', fromName: 'Ann Lee', fromAddress: 'ann@example.com' }];
const KEY = 'email.mb1.reply.m1';

/** The server's prefill for an answer or a forward of m1: the reply goes to the Reply-To the server chose. */
function prefill(mode: EmailComposeMode): EmailComposeDto {
    return {
        id: 'm1', mode, from: { address: 'work@example.com', choices: ['work@example.com'] },
        to: mode === 'forward' ? [] : [{ name: 'Desk team', address: 'desks@example.com' }], cc: [],
        subject: mode === 'forward' ? 'Fwd: Desk move on Friday' : 'Re: Desk move on Friday',
        quote: { text: 'Ann Lee wrote:\n> Line 1', html: '<p>Ann Lee wrote:</p><blockquote>Line 1</blockquote>', attribution: null },
        inReplyTo: null, references: [], attachments: [], unreadable: null,
    };
}

/** The open message, its plain body `lines` lines long. */
function message(lines: number): EmailMessageDetailDto {
    const body = Array.from({ length: lines }, (_, i) => `Line ${i + 1} of the note.`).join('\n');
    return { ...LISTED[0], bodyText: body } as EmailMessageDetailDto;
}

/**
 * The quick reply: a chat-like box pinned at the bottom of the message pane, outside the message's one scroll region.
 * One line until used, growing with the text to about six lines, then scrolling inside; no To or Subject (the server's
 * reply prefill gives them); plain text, files, Send and Expand; Ctrl or Cmd+Enter sends, Enter is a new line; the
 * server appends the quote. Its text is the message's reply draft, saved after a pause; Expand, or Reply while it holds
 * text, hands that one draft to the compose window. Rendered and laid out at 1400 x 600, fixed at the window's top left.
 */
describe('EmailMailboxPageComponent -- the quick reply, pinned below the message', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let replies: Array<{ id: string; request: OutgoingEmailRequest }>;
    let asked: Array<[string, EmailComposeMode]>;
    let drafts: Map<string, unknown>;

    beforeEach(() => {
        replies = [];
        asked = [];
        drafts = new Map<string, unknown>();
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
                        composePrefill: (id: string, mode: EmailComposeMode) => {
                            asked.push([id, mode]);
                            return of(prefill(mode));
                        },
                        reply: (id: string, request: OutgoingEmailRequest) => {
                            replies.push({ id, request: structuredClone(request) });
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
                        load: (key: string) => (drafts.has(key) ? structuredClone(drafts.get(key)) : null),
                        save: (key: string, value: unknown) => void drafts.set(key, structuredClone(value)),
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
        mount();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    /** The page, laid out; mounted again it is the page after a reload, with the same draft store. */
    function mount(): void {
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
    }

    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await frame();
        }
        await fixture.whenStable();
        fixture.detectChanges();
    }
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const section = (): HTMLElement => el().querySelector<HTMLElement>('.mbx__detail')!;
    const scroll = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-scroll"]')!;
    const quick = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="quick-reply"]')!;
    const box = (): HTMLTextAreaElement => el().querySelector<HTMLTextAreaElement>('[data-test="quick-reply-box"]')!;
    const dock = (): HTMLElement | null => el().querySelector<HTMLElement>('.mbx__dock');
    const handed = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="quick-reply-in-window"]');

    async function open(lines: number): Promise<void> {
        fixture.componentInstance.selectedMailboxId.set('mb1');
        fixture.componentInstance.selectedMessage.set(message(lines));
        await settle();
    }

    /** Types into the box and lets it draw, without waiting out the pause before the draft is saved. */
    async function type(text: string): Promise<void> {
        box().value = text;
        box().dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await frame();
        await frame();
        fixture.detectChanges();
    }

    /** The box's height for `lines` lines of text, from its own line height, padding and border. */
    function heightFor(lines: number): number {
        const s = getComputedStyle(box());
        return parseFloat(s.lineHeight) * lines + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)
            + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    }

    it('is pinned at the bottom of the message pane, outside its one scroll region, and stays put as the message scrolls', async () => {
        await open(200);
        const pane = section().getBoundingClientRect();
        const at = quick().getBoundingClientRect();

        expect(scroll().contains(quick())).withContext('not inside the scroll region').toBeFalse();
        expect(section().contains(quick())).withContext('in the message pane').toBeTrue();
        expect(at.bottom).withContext('at the pane\'s bottom').toBeCloseTo(pane.bottom, 0);
        expect(scroll().getBoundingClientRect().bottom).withContext('the scroll region ends above it').toBeLessThanOrEqual(at.top + 0.5);
        expect(scroll().scrollHeight).withContext('the long message scrolls').toBeGreaterThan(scroll().clientHeight + 100);

        scroll().scrollTop = scroll().scrollHeight;
        await settle();
        expect(quick().getBoundingClientRect().top).withContext('scrolling the message leaves it in place').toBeCloseTo(at.top, 0);

        await open(2);
        expect(quick().getBoundingClientRect().bottom).withContext('under a short message too').toBeCloseTo(section().getBoundingClientRect().bottom, 0);
    });

    it('is one line reading "Write a reply…", grows with the text to six lines, then scrolls inside', async () => {
        await open(3);
        expect(box().placeholder).toBe('Write a reply…');
        expect(box().getBoundingClientRect().height).withContext('one line').toBeCloseTo(heightFor(1), 0);

        await type('one\ntwo\nthree');
        expect(box().getBoundingClientRect().height).withContext('three lines').toBeCloseTo(heightFor(3), 0);
        expect(box().scrollHeight).withContext('no scroll at three lines').toBeLessThanOrEqual(box().clientHeight);

        await type(Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
        expect(QUICK_REPLY_MAX_LINES).toBe(6);
        expect(box().getBoundingClientRect().height).withContext('capped at six lines').toBeCloseTo(heightFor(6), 0);
        expect(box().scrollHeight).withContext('scrolls inside past six').toBeGreaterThan(box().clientHeight + 10);
        expect(getComputedStyle(box()).overflowY).toBe('auto');
        expect(scroll().contains(box())).toBeFalse();
    });

    it('has no To or Subject, and sends plain text to the prefill\'s recipient with Re: and quote: true', async () => {
        await open(3);
        expect(asked).toEqual([['m1', 'reply']]);
        expect(quick().querySelector('app-tag-input, input[type="text"]')).withContext('no To, no Subject').toBeNull();

        await type('Friday works.');
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-send"]')!.click();
        await settle();

        expect(replies).toEqual([{ id: 'm1', request: {
            text: 'Friday works.', to: ['desks@example.com'], subject: 'Re: Desk move on Friday', from: 'work@example.com', quote: true,
        } }]);
        expect(box().value).withContext('cleared after the send').toBe('');
        expect(drafts.has(KEY)).withContext('no draft left').toBeFalse();
    });

    it('Ctrl+Enter and Cmd+Enter send; Enter alone is a new line', async () => {
        await open(3);
        await type('First');
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        box().dispatchEvent(enter);
        await settle();
        expect(enter.defaultPrevented).withContext('Enter is left to the box').toBeFalse();
        expect(replies.length).toBe(0);

        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
        await settle();
        await type('Second');
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
        await settle();

        expect(replies.map(r => r.request.text)).toEqual(['First', 'Second']);
    });

    it('its text is that message\'s reply draft, saved after a pause, and back after a reload', async () => {
        await open(3);
        await type('Will reply properly later.');
        expect(drafts.has(KEY)).withContext('not before the pause').toBeFalse();
        await wait(QUICK_REPLY_SAVE_MS + 100);
        expect((drafts.get(KEY) as ComposeDraft).text).toBe('Will reply properly later.');
        expect((drafts.get(KEY) as ComposeDraft).place).toBe('quick');

        fixture.destroy();
        (fixture.nativeElement as HTMLElement).remove();
        mount();
        await open(3);

        expect(box().value).toBe('Will reply properly later.');
    });

    it('Expand moves the text into the compose window as the same draft; the box says so and brings the window up', async () => {
        await open(3);
        await type('Long answer coming.');
        await wait(QUICK_REPLY_SAVE_MS + 100);
        const keys = [...drafts.keys()];

        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();

        expect(dock()).withContext('the compose window').not.toBeNull();
        expect(dock()!.querySelector('textarea')!.value).toBe('Long answer coming.');
        expect(fixture.componentInstance.composeTo).withContext('the prefill\'s To').toEqual(['desks@example.com']);
        expect(fixture.componentInstance.composeSubject).toBe('Re: Desk move on Friday');
        expect([...drafts.keys()]).withContext('one draft, the same key').toEqual(keys);
        expect((drafts.get(KEY) as ComposeDraft).place).toBe('window');
        expect(el().querySelector('[data-test="quick-reply-box"]')).withContext('the box clears').toBeNull();
        expect(handed()?.textContent).toContain('The reply is open in the compose window.');

        fixture.componentInstance.toggleMinimize();
        await settle();
        handed()!.querySelector<HTMLButtonElement>('[data-test="quick-reply-show-window"]')!.click();
        await settle();
        expect(fixture.componentInstance.composeMinimized()).withContext('Show it brings the window up').toBeFalse();
    });

    it('Reply while the box holds text does what Expand does, before the pause too', async () => {
        await open(3);
        await type('Typed just now.');

        fixture.componentInstance.onDetailAction('reply');
        await settle();

        expect(dock()!.querySelector('textarea')!.value).toBe('Typed just now.');
        expect([...drafts.keys()]).toEqual([KEY]);
        expect(handed()).not.toBeNull();
    });

    it('Reply with an empty box, Reply all and Forward open the compose window, the editor empty; the box stays', async () => {
        await open(3);

        fixture.componentInstance.onDetailAction('reply');
        await settle();
        expect(dock()).withContext('Reply').not.toBeNull();
        expect(fixture.componentInstance.composeMode()).toBe('reply');
        expect(dock()!.querySelector('textarea')!.value).toBe('');
        fixture.componentInstance.closeCompose();
        await settle();
        expect(handed()).withContext('nothing written: no draft for the window').toBeNull();

        fixture.componentInstance.onDetailAction('reply-all');
        await settle();
        expect(fixture.componentInstance.composeMode()).toBe('reply_all');
        expect(box()).withContext('the box stays for Reply all').not.toBeNull();
        fixture.componentInstance.closeCompose();

        fixture.componentInstance.onDetailAction('forward');
        await settle();
        expect(fixture.componentInstance.composeMode()).toBe('forward');
        expect(box()).not.toBeNull();
    });

    it('no quick reply on a server row: a row with no id, not yet stored', async () => {
        fixture.componentInstance.selectedMailboxId.set('mb1');
        fixture.componentInstance.selectedMessage.set({ ...message(3), id: undefined, fromServer: true, ref: 'INBOX:42' } as unknown as EmailMessageDetailDto);
        await settle();

        expect(el().querySelector('[data-test="quick-reply"]')).toBeNull();
        expect(asked).withContext('no reply prefill asked for').toEqual([]);
    });

    it('no quick reply while the message loads, and none for a copy from the server no longer kept', async () => {
        await open(3);
        fixture.componentInstance.openEvicted.set(true);
        await settle();
        expect(el().querySelector('[data-test="quick-reply"]')).toBeNull();
    });
});
