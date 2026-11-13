import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, Subject, of } from 'rxjs';
import { AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { FakeDraftsApi } from './email-drafts.fake';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailComposeDto, type EmailComposeMode, type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto,
    type OutgoingEmailRequest,
} from './email.types';
import { readDraftsChanged } from './mail-drafts-changed';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { QUICK_REPLY_MAX_LINES, QUICK_REPLY_SAVE_MS } from './mail-quick-reply.component';
import { DRAFT_GONE_KEPT, DRAFT_RETRY_FIRST_MS } from './server-draft';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday', fromName: 'Ann Lee', fromAddress: 'ann@example.com' }];
const REPLY = { messageId: 'm1', mode: 'reply' as const };

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

/** A reply draft of m1 as the quick reply writes it on another device: plain, quoted, to the prefill's recipient. */
function written(id: string, text: string): { id: string } & Record<string, unknown> {
    return {
        id, to: ['desks@example.com'], subject: 'Re: Desk move on Friday', text, html: null, from: 'work@example.com',
        answers: REPLY, quote: true,
    };
}

/**
 * The quick reply: a chat-like box pinned at the bottom of the message pane, outside the message's one scroll region.
 * One line until used, growing with the text to about six lines, then scrolling inside; no To or Subject (the server's
 * reply prefill gives them); plain text, files, Send and Expand; Ctrl or Cmd+Enter sends, Enter is a new line; the
 * server appends the quote. Its text is the message's reply draft on the server (the drafts API, in memory here), saved
 * after a pause; Expand, or Reply while it holds text, hands that one draft to the compose window. Rendered and laid
 * out at 1400 x 600, fixed at the window's top left.
 */
describe('EmailMailboxPageComponent -- the quick reply, pinned below the message', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let replies: Array<{ id: string; request: OutgoingEmailRequest }>;
    let asked: Array<[string, EmailComposeMode]>;
    let server: FakeDraftsApi;
    let live: Subject<unknown>;
    let infos: string[];
    let shown: Array<{ message: string; ms: number; action?: { label: string; run: () => void } }>;

    beforeEach(() => {
        shown = [];
        const notices = shown;
        replies = [];
        asked = [];
        // This test's own drafts: the mock below closes over them, so a save still pending from an earlier test's
        // page writes into that page's drafts, never into these.
        const drafts = new FakeDraftsApi();
        server = drafts;
        live = new Subject<unknown>();
        const told: string[] = [];
        infos = told;
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of(LISTED),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                        listAliases: () => of({ canManage: false, aliases: [] }),
                        composePrefill: (id: string, mode: EmailComposeMode) => {
                            asked.push([id, mode]);
                            return of(prefill(mode));
                        },
                        reply: (id: string, request: OutgoingEmailRequest) => {
                            replies.push({ id, request: structuredClone(request) });
                            // The server removes the draft a reply was written in once it is sent.
                            if (request.draftId !== undefined) {
                                drafts.drafts.delete(request.draftId);
                            }
                            return of({});
                        },
                        createDraft: drafts.createDraft.bind(drafts),
                        saveDraft: drafts.saveDraft.bind(drafts),
                        readDraft: drafts.readDraft.bind(drafts),
                        deleteDraft: drafts.deleteDraft.bind(drafts),
                        draftsAnswering: drafts.draftsAnswering.bind(drafts),
                        listDrafts: drafts.listDrafts.bind(drafts),
                        removeAttachment: () => of(null),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: {
                        error: (): void => {}, success: (): void => {}, info: (m: string): void => void told.push(m),
                        show: (n: { message: string; action?: { label: string; run: () => void } }, ms: number): number =>
                            notices.push({ ...n, ms }),
                    },
                },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' } : null) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => live } },
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

    /** The page, laid out; mounted again it is the page after a reload (or on another device), with the same drafts. */
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
    const draftLine = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-test="quick-reply-draft"]');
    const sendButton = (): HTMLButtonElement => quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-send"]')!;
    const only = (): string => [...server.drafts.keys()][0];

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

    /** Types into the box and waits out the pause: the draft is saved. */
    async function typeAndSave(text: string): Promise<void> {
        await type(text);
        await wait(QUICK_REPLY_SAVE_MS + 100);
        await settle();
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
        expect([at.left, at.right]).withContext('the full width of the pane, edge to edge').toEqual([pane.left, pane.right]);
        expect(at.bottom).withContext('at the pane\'s bottom').toBeCloseTo(pane.bottom, 0);
        expect(scroll().getBoundingClientRect().bottom).withContext('the scroll region ends above it').toBeLessThanOrEqual(at.top + 0.5);
        expect(scroll().scrollHeight).withContext('the long message scrolls').toBeGreaterThan(scroll().clientHeight + 100);

        scroll().scrollTop = scroll().scrollHeight;
        await settle();
        expect(quick().getBoundingClientRect().top).withContext('scrolling the message leaves it in place').toBeCloseTo(at.top, 0);

        await open(2);
        expect(quick().getBoundingClientRect().bottom).withContext('under a short message too').toBeCloseTo(section().getBoundingClientRect().bottom, 0);
    });

    it('is one line reading "Reply to <name>…", grows with the text to six lines, then scrolls inside', async () => {
        await open(3);
        expect(box().placeholder).withContext('the sender\'s name').toBe('Reply to Ann Lee…');
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
        expect(server.drafts.size).withContext('no draft left').toBe(0);
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

    it('its text is the message\'s reply draft on the server, saved after a pause with quote: true, and found again after a reload', async () => {
        await open(3);
        await type('Will reply properly later.');
        expect(server.of('create').length).withContext('not before the pause').toBe(0);
        await wait(QUICK_REPLY_SAVE_MS + 100);

        const made = server.of('create');
        expect(made.length).toBe(1);
        expect(made[0].body).toEqual({
            to: ['desks@example.com'], cc: [], bcc: [], subject: 'Re: Desk move on Friday', text: 'Will reply properly later.',
            html: null, attachments: [], from: 'work@example.com', quote: true, messageParts: [], answers: REPLY,
        });
        expect(Object.keys(made[0].body!)).withContext('never the server\'s threading').not.toContain('inReplyTo');

        fixture.destroy();
        (fixture.nativeElement as HTMLElement).remove();
        mount();
        await open(3);

        expect(server.of('lookup').at(-1)?.messageId).withContext('found by the message').toBe('m1');
        expect(box().value).toBe('Will reply properly later.');
    });

    it('a second reply draft refused (409 reply-draft-exists) loads that draft and never makes a second', async () => {
        await open(3);
        // Another device made the reply draft after this box looked it up.
        server.put(written('d-other', 'Written on the phone.'));

        await typeAndSave('Typed here.');

        expect(server.of('create').length).withContext('one create, refused').toBe(1);
        expect(server.of('read').map(c => c.id)).withContext('the named draft is read').toEqual(['d-other']);
        expect([...server.drafts.keys()]).withContext('still one draft').toEqual(['d-other']);
        expect(box().value).withContext('the box shows that draft').toBe('Written on the phone.');

        await typeAndSave('Written on the phone. And here.');
        expect(server.of('save').map(c => [c.id, c.version])).withContext('saved to that draft, from its version').toEqual([['d-other', 1]]);
        expect(server.drafts.get('d-other')!.text).toBe('Written on the phone. And here.');
    });

    it('a stale save (409 draft-stale) reloads the draft and never writes over it', async () => {
        server.put(written('d1', 'First words.'));
        await open(3);
        expect(box().value).toBe('First words.');
        // Saved elsewhere meanwhile: version 2.
        server.put({ id: 'd1', text: 'Changed on the laptop.' });

        await typeAndSave('First words, and more.');

        expect(server.of('save').map(c => c.version)).withContext('made from version 1').toEqual([1]);
        expect(server.drafts.get('d1')!.text).withContext('not written over').toBe('Changed on the laptop.');
        expect(server.drafts.get('d1')!.version).toBe(2);
        expect(box().value).withContext('the stored draft, reloaded').toBe('Changed on the laptop.');
    });

    it('Expand hands the same draft id to the compose window; the box says so and brings the window up', async () => {
        await open(3);
        await typeAndSave('Long answer coming.');
        const id = only();

        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();

        expect(dock()).withContext('the compose window').not.toBeNull();
        expect(server.of('read').map(c => c.id)).withContext('the window reads the draft handed to it').toEqual([id]);
        expect(dock()!.querySelector('textarea')!.value).toBe('Long answer coming.');
        expect(fixture.componentInstance.composeTo).withContext('the prefill\'s To').toEqual(['desks@example.com']);
        expect(fixture.componentInstance.composeSubject).toBe('Re: Desk move on Friday');
        expect(el().querySelector('[data-test="quick-reply-box"]')).withContext('the box clears').toBeNull();
        expect(handed()?.textContent).toContain('Your reply is open in the compose window.');

        // Written on in the window: the same draft, saved from the version the box left.
        fixture.componentInstance.composeText = 'Long answer coming. Here it is.';
        fixture.componentInstance.onComposeChange();
        await wait(QUICK_REPLY_SAVE_MS + 100);
        const saves = server.of('save');
        expect(saves.length).withContext('saved from the window').toBeGreaterThan(0);
        expect(saves.map(c => c.id)).withContext('one draft id for both').toEqual(saves.map(() => id));
        expect(saves[0].version).withContext('from the version the box left').toBe(1);
        expect(server.drafts.get(id)!.text).toBe('Long answer coming. Here it is.');
        expect(server.of('create').length).toBe(1);
        expect(server.drafts.size).toBe(1);

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
        expect(server.of('create').length).withContext('saved at the hand-off').toBe(1);
        expect(server.of('read').map(c => c.id)).toEqual([only()]);
        expect(handed()).not.toBeNull();
    });

    it('a reply sent from the box or the window names its draft (draftId), and the server removes it', async () => {
        await open(3);
        await typeAndSave('Sent from the box.');
        const first = only();
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-send"]')!.click();
        await settle();

        expect(replies.length).toBe(1);
        expect(replies[0].request.draftId).toBe(first);
        expect(replies[0].request.quote).toBeTrue();
        expect(server.drafts.size).withContext('removed with the send').toBe(0);

        await typeAndSave('Then from the window.');
        const second = only();
        expect(second).withContext('a new reply draft').not.toBe(first);
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();
        fixture.componentInstance.sendCompose();
        await settle();

        expect(replies.length).toBe(2);
        expect(replies[1].id).toBe('m1');
        expect(replies[1].request.draftId).toBe(second);
        expect(replies[1].request.quote).withContext('the quote choice stated').toBeTrue();
        expect(server.drafts.size).toBe(0);
    });

    it('a mail.drafts.changed with a newer version reads the draft again; with null it clears the box', async () => {
        await open(3);
        await typeAndSave('Mine.');
        const id = only();
        const reads = server.of('read').length;

        // The event of this place's own save: nothing newer, nothing read.
        live.next({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: id, version: 1, answers: REPLY });
        await settle();
        expect(server.of('read').length).toBe(reads);

        server.put({ id, text: 'Mine, edited on the phone.' });
        live.next(readDraftsChanged({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: id, version: 2, answers: REPLY }));
        await settle();
        expect(server.of('read').at(-1)?.id).toBe(id);
        expect(box().value).toBe('Mine, edited on the phone.');

        server.drafts.delete(id);
        live.next({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: id, version: null, answers: REPLY });
        await settle();
        expect(box().value).withContext('gone elsewhere: cleared').toBe('');

        await typeAndSave('A new one.');
        expect(server.of('create').length).withContext('the next text makes a new draft').toBe(2);
    });

    it('a reply draft made on another device is taken up by the box from its event', async () => {
        await open(3);
        server.put(written('d-phone', 'From the phone.'));
        live.next({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: 'd-phone', version: 1, answers: REPLY });
        await settle();

        expect(box().value).toBe('From the phone.');
        await typeAndSave('From the phone. Done here.');
        expect(server.of('create').length).withContext('no second draft').toBe(0);
        expect(server.of('save').map(c => c.id)).toEqual(['d-phone']);
    });

    it('Expand while the box\'s create is on its way waits for it: the window opens on that draft, never a second', async () => {
        await open(3);
        await type('Racing the window.');
        server.hold();
        await wait(QUICK_REPLY_SAVE_MS + 100);
        expect(server.waiting).withContext('the box\'s create is on its way').toBe(1);

        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();
        expect(server.of('lookup').length + server.of('read').length).withContext('the window waits').toBe(1);

        server.release();
        await settle();
        expect(server.of('create').length).withContext('one create').toBe(1);
        expect(server.of('read').map(c => c.id)).withContext('the window reads the box\'s draft').toEqual([only()]);
        expect(dock()!.querySelector('textarea')!.value).toBe('Racing the window.');
    });

    it('a reply draft create the server fails (5xx) looks the draft up once and loads it when it is there', async () => {
        await open(3);
        // The create raced another one, which made the draft; this one failed.
        server.put(written('d-race', 'Made by the other create.'));
        server.failNextCreate(500);

        await typeAndSave('Typed here.');

        expect(server.of('create').length).withContext('no second create').toBe(1);
        expect(server.of('lookup').map(c => c.messageId)).withContext('looked up by the message').toEqual(['m1', 'm1']);
        expect(box().value).toBe('Made by the other create.');
        expect([...server.drafts.keys()]).toEqual(['d-race']);
    });

    it('a reply draft create the server fails with none there keeps the text and saves it again after a pause', async () => {
        await open(3);
        server.failNextCreate(503);

        await type('Keep me.');
        await wait(QUICK_REPLY_SAVE_MS + 100);
        expect(server.of('create').length).withContext('the first create failed').toBe(1);
        expect(server.drafts.size).withContext('nothing made yet').toBe(0);
        expect(box().value).withContext('the text kept').toBe('Keep me.');

        await wait(DRAFT_RETRY_FIRST_MS + 200);
        expect(server.of('create').length).withContext('tried again').toBe(2);
        expect(server.of('create')[1].key).withContext('with the same Idempotency-Key').toBe(server.of('create')[0].key);
        expect(server.drafts.size).toBe(1);
        expect(server.drafts.get(only())!.text).toBe('Keep me.');
    });

    it('a save refused with 404 (deleted elsewhere, its event missed) tells the person and keeps the text as a new draft', async () => {
        await open(3);
        await typeAndSave('First part.');
        const first = only();
        // Deleted on another device; the event never came.
        server.drafts.delete(first);

        await typeAndSave('First part. Second part.');

        expect(server.of('save').map(c => c.id)).withContext('the save found it gone').toEqual([first]);
        expect(infos).withContext('the person is told').toEqual([DRAFT_GONE_KEPT]);
        expect(box().value).withContext('the text stays').toBe('First part. Second part.');
        expect(server.of('create').length).withContext('kept as a new draft').toBe(2);
        expect([...server.drafts.values()].map(d => d.text)).toEqual(['First part. Second part.']);
        expect(only()).not.toBe(first);
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
        expect(server.drafts.size).toBe(0);

        fixture.componentInstance.onDetailAction('reply-all');
        await settle();
        expect(fixture.componentInstance.composeMode()).toBe('reply_all');
        expect(handed()).withContext('reply all writes the same reply draft: the box says it is in the window').not.toBeNull();
        fixture.componentInstance.closeCompose();
        await settle();

        fixture.componentInstance.onDetailAction('forward');
        await settle();
        expect(fixture.componentInstance.composeMode()).toBe('forward');
        expect(box()).not.toBeNull();
    });

    /**
     * The field takes all of the row the three buttons leave: attach at its start, then the field from edge to edge of
     * what is left, then Expand and Send, with only the row's gaps between them.
     */
    function expectFieldFillsTheRow(state: string): void {
        const row = quick().querySelector<HTMLElement>('.mqr__row')!;
        const r = (e: Element): DOMRect => e.getBoundingClientRect();
        const attach = r(row.querySelector('app-compose-attach-button')!);
        const field = r(box());
        const expand = r(row.querySelector('[data-test="quick-reply-expand"]')!);
        const send = r(sendButton());
        const gap = parseFloat(getComputedStyle(row).columnGap);
        const rowBox = r(row);
        expect(attach.left).withContext(`${state}: attach at the start`).toBeCloseTo(rowBox.left, 0);
        expect(field.left - attach.right).withContext(`${state}: the field right after attach`).toBeCloseTo(gap, 0);
        expect(expand.left - field.right).withContext(`${state}: Expand right after the field`).toBeCloseTo(gap, 0);
        expect(send.right).withContext(`${state}: Send at the end`).toBeCloseTo(rowBox.right, 0);
        expect(field.width).withContext(`${state}: the field is the rest of the row`)
            .toBeCloseTo(rowBox.width - attach.width - expand.width - send.width - 3 * gap, 0);
    }

    it('one line: attach, the field, Expand and Send; Send is disabled until there is text', async () => {
        await open(3);
        const row = quick().querySelector<HTMLElement>('.mqr__row')!;
        const parts = [...row.children].map(c => c.getAttribute('data-test')
            ?? c.querySelector('[data-test]')?.getAttribute('data-test') ?? c.tagName.toLowerCase());
        expect(parts).toEqual(['attach-button', 'quick-reply-box', 'quick-reply-expand', 'quick-reply-send']);
        expect(row.querySelector('[data-test="attach-button"]')!.getAttribute('aria-label')).toBe('Attach files');
        const tops = [...row.children].map(c => Math.round(c.getBoundingClientRect().bottom));
        expect(new Set(tops).size).withContext('on one line').toBe(1);

        expectFieldFillsTheRow('idle');

        expect(sendButton().disabled).withContext('empty').toBeTrue();
        await type('   ');
        expect(sendButton().disabled).withContext('blank').toBeTrue();
        await type('Yes.');
        expect(sendButton().disabled).withContext('text').toBeFalse();
        await type('Yes, Friday at ten works for me, and I will bring the plan of the new desks with me as well.');
        expectFieldFillsTheRow('typing');
        await type('');
        expect(sendButton().disabled).withContext('emptied again').toBeTrue();
    });

    it('the file chips and the size meter show above the line only once files are attached', async () => {
        await open(3);
        expect(quick().querySelector('[data-test="attachment-chip"]')).toBeNull();
        expect(quick().querySelector('[data-test="attachment-meter"]')).withContext('no meter without files').toBeNull();
        expect(quick().querySelector('[data-test="attachment-size"]')).toBeNull();

        const qr = fixture.debugElement.query(d => d.name === 'app-mail-quick-reply').componentInstance as {
            attachments: { set(v: unknown): void };
        };
        qr.attachments.set([{
            key: 'k1', id: 'f1', filename: 'agenda.pdf', sizeBytes: 220_000, encodedBytes: null, mimeType: 'application/pdf',
            source: 'upload', status: 'ready', progress: 100, refusal: null,
        }]);
        await settle();

        const chip = quick().querySelector<HTMLElement>('[data-test="attachment-chip"]');
        const meter = quick().querySelector<HTMLElement>('[data-test="attachment-meter"]');
        expect(chip?.textContent).toContain('agenda.pdf');
        expect(meter).withContext('the meter with files').not.toBeNull();
        expect(chip!.getBoundingClientRect().bottom).withContext('above the line').toBeLessThanOrEqual(box().getBoundingClientRect().top);
        expect(meter!.getBoundingClientRect().bottom).toBeLessThanOrEqual(box().getBoundingClientRect().top);
        expectFieldFillsTheRow('with files');

        // At a phone's width too: the pane narrows, and the field still takes all of it but the three buttons.
        el().style.width = '390px';
        await settle();
        expectFieldFillsTheRow('with files, 390 px');
    });

    it('while the reply is in the compose window: "Your reply is open in the compose window." with Show it', async () => {
        await open(3);
        await typeAndSave('In the window now.');
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();

        expect(handed()!.querySelector('.mqr__line-text')!.textContent!.trim()).toBe('Your reply is open in the compose window.');
        expect([...handed()!.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['Show it']);
        expect(el().querySelector('[data-test="quick-reply-box"]')).toBeNull();
        expect(draftLine()).toBeNull();
        fixture.componentInstance.toggleMinimize();
        await settle();
        handed()!.querySelector<HTMLButtonElement>('[data-test="quick-reply-show-window"]')!.click();
        await settle();
        await wait(50);
        expect(fixture.componentInstance.composeMinimized()).withContext('restored').toBeFalse();
        const win = el().querySelector<HTMLElement>('[data-testid="compose-window"]')!;
        expect(win.contains(document.activeElement)).withContext('and focused').toBeTrue();
    });

    it('closed with the draft kept: the line shows the draft\'s first words with Open and Discard, never the text in the box', async () => {
        await open(3);
        await typeAndSave('Hi Ann, Friday works for me and I will bring the plan of the new desks with me.');
        const id = only();
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();
        // Plain text, quoted, to the sender: a draft the box could show, so only the window having held it keeps it out.
        fixture.componentInstance.closeCompose();
        await settle();

        expect(handed()).toBeNull();
        expect(el().querySelector('[data-test="quick-reply-box"]')).withContext('the text is not put back in the box').toBeNull();
        expect(draftLine()).not.toBeNull();
        expect(draftLine()!.querySelector('[data-test="quick-reply-draft-text"]')!.textContent!.trim())
            .withContext('its first words').toBe('Draft: \u201CHi Ann, Friday works for me and I will bring the plan\u2026\u201D');
        expect([...draftLine()!.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['Open', 'Discard']);
        expect(server.drafts.get(id)!.text).withContext('the draft kept').toContain('Hi Ann');

        // A page that had already drawn the draft in its box gives way once it learns a window held it.
        fixture.destroy();
        (fixture.nativeElement as HTMLElement).remove();
        mount();
        await open(3);
        fixture.componentInstance.windowReplyDrafts.set(new Set([id]));
        await settle();
        expect(el().querySelector('[data-test="quick-reply-box"]')).toBeNull();
        expect(draftLine()).not.toBeNull();

        draftLine()!.querySelector<HTMLButtonElement>('[data-test="quick-reply-open-draft"]')!.click();
        await settle();
        expect(el().querySelector('[data-testid="compose-window"]')).withContext('Open opens the window').not.toBeNull();
        expect(server.of('read').at(-1)?.id).withContext('on that draft').toBe(id);
        expect(fixture.componentInstance.composeText).toContain('Hi Ann');
        expect(handed()).not.toBeNull();
    });

    it('the draft line\'s Discard deletes it with the 10 s Undo, and the box is the normal line again', async () => {
        await open(3);
        await typeAndSave('Draft to throw away.');
        const id = only();
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();
        fixture.componentInstance.closeCompose();
        await settle();
        expect(draftLine()).not.toBeNull();

        draftLine()!.querySelector<HTMLButtonElement>('[data-test="quick-reply-discard-draft"]')!.click();
        // Drawn without waiting for the page to be stable: the Undo's 10 s timer is pending until it is used.
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await frame();
        }
        expect(server.of('delete').map(c => c.id)).toEqual([id]);
        expect(server.drafts.size).toBe(0);
        expect(draftLine()).toBeNull();
        expect(box()).withContext('the normal line').not.toBeNull();
        expect(box().value).toBe('');
        expect(shown.map(n => [n.message, n.ms, n.action?.label])).toEqual([['Draft discarded.', 10_000, 'Undo']]);

        shown[0].action!.run();
        await settle();
        expect(server.drafts.size).withContext('Undo makes it again').toBe(1);
        expect([...server.drafts.values()][0].text).toBe('Draft to throw away.');
        expect(el().querySelector('[data-testid="compose-window"]')).withContext('in its window').not.toBeNull();
        expect(handed()).not.toBeNull();
    });

    it('after a send from the window the box is the normal line again', async () => {
        await open(3);
        await typeAndSave('Sent from the window.');
        quick().querySelector<HTMLButtonElement>('[data-test="quick-reply-expand"]')!.click();
        await settle();
        fixture.componentInstance.closeCompose();
        await settle();
        expect(draftLine()).not.toBeNull();

        draftLine()!.querySelector<HTMLButtonElement>('[data-test="quick-reply-open-draft"]')!.click();
        await settle();
        fixture.componentInstance.sendCompose();
        await settle();
        expect(server.drafts.size).toBe(0);
        expect(draftLine()).toBeNull();
        expect(handed()).toBeNull();
        expect(box().value).toBe('');
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
