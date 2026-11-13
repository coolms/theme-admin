import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, Subject, of, throwError } from 'rxjs';
import { AppConfigState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { FakeDraftsApi } from './email-drafts.fake';
import { DRAFT_RETRY_FIRST_MS } from './server-draft';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import type { EmailComposeDto, EmailComposeMode, EmailMailboxDto, EmailMessageDto, OutgoingEmailRequest } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { MAIL_FRAME_PAGE, MessageFrameComponent } from './message-frame.component';
import { EDITOR_MANIFEST_PROVIDER, provideCoolmsEditor } from '@coolms/editor-angular';

/** The served quote: a trailing line end and an inline image as data:, both kept as served. */
const QUOTE_HTML = '<div><p style="margin:0 0 12px 0;">On 9 Nov 2026, 14:05, Ada Byron &lt;ada@example.test&gt; wrote:</p>'
    + '<blockquote style="margin:0 0 12px 0;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a;">'
    + '<p>Lunch at noon?</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="map"></blockquote></div>\n';
const QUOTE_TEXT = 'On 9 Nov 2026, 14:05, Ada Byron <ada@example.test> wrote:\n> Lunch at noon?';

function answerFor(mode: EmailComposeMode, change: Partial<EmailComposeDto> = {}): EmailComposeDto {
    return {
        id: 'm1',
        mode,
        from: { address: 'sales@example.test', choices: ['work@example.test', 'sales@example.test'] },
        to: mode === 'forward' ? [] : [{ name: 'Ada Byron', address: 'ada@example.test' }],
        cc: mode === 'reply_all' ? [{ name: null, address: 'grace@example.test' }] : [],
        subject: mode === 'forward' ? 'Fwd: Lunch' : 'Re: Lunch',
        quote: { text: QUOTE_TEXT, html: QUOTE_HTML, attribution: 'On 9 Nov 2026, 14:05, Ada Byron <ada@example.test> wrote:' },
        inReplyTo: mode === 'forward' ? null : '<a1@example.test>',
        references: mode === 'forward' ? [] : ['<a1@example.test>'],
        attachments: mode === 'forward' ? FORWARD_PARTS : [],
        unreadable: null,
        ...change,
    };
}

const MESSAGE: EmailMessageDto = {
    id: 'm1', mailboxId: 'mb1', folder: 'INBOX', fromName: 'Ada Byron', fromAddress: 'ada@example.test',
    toAddresses: ['work@example.test'], subject: 'Lunch', seen: true, replyAllUseful: true,
};

/** A forward's parts: a file of its own, and an image the quote shows (which goes with the quote, never alone). */
const FORWARD_PARTS: EmailComposeDto['attachments'] = [
    { messageId: 'm1', part: 2, name: 'menu.pdf', mimeType: 'application/pdf', sizeBytes: 2048, inline: false, contentId: null },
    { messageId: 'm1', part: 3, name: 'map.png', mimeType: 'image/png', sizeBytes: 512, inline: true, contentId: 'map' },
    { messageId: 'm1', part: 4, name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 64, inline: false, contentId: null },
];

/**
 * Reply, Reply all and Forward start from what the server prepares: each asks the compose prefill with its mode and
 * fills the composer from the answer, says it is being read and why it could not be, shows the served quote read-only
 * below the editor (never in it), and sends the served From with the quote choice always stated -- an answer through
 * the reply endpoint (which threads it), a forward through send with the message it forwards and its own files.
 */
describe('EmailMailboxPageComponent -- the server prepares an answer or a forward', () => {
    let asked: [string, EmailComposeMode][];
    let answer: (mode: EmailComposeMode) => Observable<EmailComposeDto>;
    let sent: { via: 'send' | 'reply'; id: string; request: OutgoingEmailRequest }[];
    let toasts: string[];
    /** What a send or a reply answers; nothing by default. */
    let sendAnswer: () => Observable<unknown>;
    /** The person's drafts on the server, this test's own. */
    let drafts: FakeDraftsApi;

    function providers(): unknown[] {
        const noop = (): void => undefined;
        return [
            {
                provide: EmailService,
                useValue: {
                    listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                    listFolders: () => of([]),
                    folderTree: () => of([]),
                    listMessages: () => of([]),
                    listInboundWorkflowOptions: () => of([]),
                    listOAuthProviders: () => of([]),
                    listAliases: () => of({ canManage: false, aliases: [] }),
                    composePrefill: (id: string, mode: EmailComposeMode) => {
                        asked.push([id, mode]);
                        return answer(mode);
                    },
                    send: (id: string, request: OutgoingEmailRequest) => {
                        sent.push({ via: 'send', id, request: structuredClone(request) });
                        return sendAnswer();
                    },
                    reply: (id: string, request: OutgoingEmailRequest) => {
                        sent.push({ via: 'reply', id, request: structuredClone(request) });
                        return sendAnswer();
                    },
                    ...drafts.api(),
                },
            },
            { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
            { provide: ToastService, useValue: { error: (m: string) => void toasts.push(m), success: noop, info: noop } },
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
            { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true } },
            { provide: ConfirmDialogService, useValue: {} },
            { provide: ContactsService, useValue: {} },
            { provide: DateTimeFormatService, useValue: { auto: () => '', dateTime: () => '' } },
            { provide: ErrorHandlerService, useValue: {} },
            { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
            { provide: ContextMenuService, useValue: {} },
            { provide: CrumbNamesService, useValue: { setTail: noop } },
        ];
    }

    function reset(): void {
        asked = [];
        sent = [];
        toasts = [];
        sendAnswer = () => NEVER;
        answer = mode => of(answerFor(mode));
        drafts = new FakeDraftsApi();
        TestBed.resetTestingModule();
    }

    /** The page built directly, with message m1 open. */
    function build(): EmailMailboxPageComponent {
        reset();
        TestBed.configureTestingModule({
            providers: [...providers(), { provide: MailboxSettingsModal, useValue: {} }] as never[],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.selectedMailboxId.set('mb1');
        page.messages.set([MESSAGE]);
        page.selectedMessage.set({ ...MESSAGE, bodyText: 'Lunch at noon?' });

        return page;
    }

    describe('built', () => {
        const modes: [string, EmailComposeMode][] = [['reply', 'reply'], ['reply-all', 'reply_all'], ['forward', 'forward']];

        for (const [action, mode] of modes) {
            it(`${action}: asks the server with mode ${mode} and fills To, Cc, Subject and From from its answer`, () => {
                const page = build();

                page.onDetailAction(action);

                const served = answerFor(mode);
                expect(asked).toEqual([['m1', mode]]);
                expect(page.composeOpen()).toBeTrue();
                expect(page.composeMode()).toBe(mode);
                expect(page.composeTo).toEqual(served.to.map(r => r.address));
                expect(page.composeCc).toEqual(served.cc.map(r => r.address));
                expect(page.composeShowCcBcc()).toBe(served.cc.length > 0);
                expect(page.composeSubject).toBe(served.subject);
                expect(page.composeFromValue()).toBe('sales@example.test');
                expect(page.composeText).withContext('nothing written for the person').toBe('');
                expect(page.composeHtml()).withContext('the quote is not put in the editor').toBe('');
                expect(page.recipientOptions()).toEqual(served.to.map(r => ({ value: r.address, label: `${r.name} <${r.address}>` })));
            });
        }

        it('says it is being prepared while the answer is read, with no fields and no Send', () => {
            const page = build();
            const later = new Subject<EmailComposeDto>();
            answer = () => later;

            page.onDetailAction('reply');

            expect(page.composePrefill()?.state).toBe('loading');
            expect(page.composePreparing()).toBe('Preparing the reply…');
            expect(page.composeFieldsShown()).toBeFalse();
            expect(page.composeMaySend()).toBeFalse();
            page.sendCompose();
            expect(sent).toEqual([]);

            later.next(answerFor('reply'));
            expect(page.composePrefill()?.state).toBe('ready');
            expect(page.composeMaySend()).toBeTrue();
        });

        it('says a 404 and a 422 plainly, with no Retry; another failure offers Retry, which reads again', () => {
            const said = (status: number): unknown => {
                const page = build();
                answer = () => throwError(() => new HttpErrorResponse({ status }));
                page.onDetailAction('forward');
                expect(page.composeMaySend()).withContext(`no Send after ${status}`).toBeFalse();
                return page.composePrefill();
            };

            expect(said(404)).toEqual({ state: 'failed', retry: false,
                sentence: 'This message is not there to answer: it was removed, or you may no longer read it.' });
            expect(said(422)).toEqual({ state: 'failed', retry: false,
                sentence: 'The server does not prepare a message this way, so nothing was filled in.' });

            const page = build();
            answer = () => throwError(() => new HttpErrorResponse({ status: 503 }));
            page.onDetailAction('forward');
            expect(page.composePrefill()).toEqual({ state: 'failed', retry: true, sentence: 'The forward could not be prepared.' });
            answer = mode => of(answerFor(mode));
            page.retryPrefill();
            expect(asked).toEqual([['m1', 'forward'], ['m1', 'forward']]);
            expect(page.composePrefill()?.state).toBe('ready');
        });

        it('the served quote is drawn exactly as served, in the message view\'s frame', () => {
            const page = build();
            page.onDetailAction('reply');

            expect(page.composeQuoteHtml()).toBe(QUOTE_HTML);
        });

        it('a reply sends the person\'s text with the served From and the server\'s quote, through the reply endpoint', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.composeText = 'Yes, noon works.';

            page.sendCompose();

            expect(sent).toEqual([{ via: 'reply', id: 'm1', request: {
                text: 'Yes, noon works.', to: ['ada@example.test'], subject: 'Re: Lunch', from: 'sales@example.test', quote: true,
            } }]);
        });

        it('a reply all sends the served Cc, and an answer with nothing to quote says quote: false', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply-all');
            page.composeText = 'All of us.';
            page.sendCompose();
            expect(sent.map(s => [s.via, s.id, s.request.to, s.request.cc, s.request.from, s.request.quote])).toEqual([
                ['reply', 'm1', ['ada@example.test'], ['grace@example.test'], 'sales@example.test', true],
            ]);

            const unread = build();
            unread.composeRich.set(false);
            answer = mode => of(answerFor(mode, { quote: null, unreadable: 'the server could not be read' }));
            unread.onDetailAction('reply');
            unread.composeText = 'Noted.';
            unread.sendCompose();

            expect(sent.map(s => [s.via, s.id, s.request.cc, s.request.from, s.request.quote])).toEqual([
                ['reply', 'm1', undefined, 'sales@example.test', false],
            ]);
        });

        it('a reply with Remove quote: quote: false, and the quote is no longer shown', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.composeText = 'Yes, noon works.';
            expect(page.composeQuoteShown()).toBeTrue();

            page.removeQuote();
            page.sendCompose();

            expect(page.composeQuoteShown()).toBeFalse();
            expect(sent).toEqual([{ via: 'reply', id: 'm1', request: {
                text: 'Yes, noon works.', to: ['ada@example.test'], subject: 'Re: Lunch', from: 'sales@example.test', quote: false,
            } }]);
        });

        it('a reply with the quote kept and no text of its own goes; with the quote removed it asks for a body', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.sendCompose();
            expect(sent.map(s => s.request)).toEqual([
                { text: '', to: ['ada@example.test'], subject: 'Re: Lunch', from: 'sales@example.test', quote: true },
            ]);

            const bare = build();
            bare.composeRich.set(false);
            bare.onDetailAction('reply');
            bare.removeQuote();
            bare.sendCompose();
            expect(sent).toEqual([]);
            expect(toasts).toEqual(['Enter a message body.']);
        });

        it('a forward sends the person\'s text through send with forwardOf, quote: true and its own files', () => {
            const page = build();
            page.onDetailAction('forward');
            page.composeTo = ['lin@example.test'];
            page.composeHtml.set('<p>See below.</p>');

            page.sendCompose();

            expect(sent).toEqual([{ via: 'send', id: 'mb1', request: {
                text: 'See below.', html: '<p>See below.</p>', to: ['lin@example.test'], subject: 'Fwd: Lunch', from: 'sales@example.test',
                forwardOf: 'm1', quote: true,
                messageParts: [{ messageId: 'm1', part: 2 }, { messageId: 'm1', part: 4 }],
            } }]);
        });

        it('a forward with Remove quote and a file removed: quote: false, and that file not sent', () => {
            const page = build();
            page.onDetailAction('forward');
            page.composeTo = ['lin@example.test'];
            page.composeHtml.set('<p>See below.</p>');

            page.removeQuote();
            page.removeForwardFile(2);
            page.sendCompose();

            expect(sent).toEqual([{ via: 'send', id: 'mb1', request: {
                text: 'See below.', html: '<p>See below.</p>', to: ['lin@example.test'], subject: 'Fwd: Lunch', from: 'sales@example.test',
                forwardOf: 'm1', quote: false,
                messageParts: [{ messageId: 'm1', part: 4 }],
            } }]);
        });

        it('a new message states no quote and forwards nothing', () => {
            const page = build();
            page.composeRich.set(false);
            page.openCompose();
            page.composeTo = ['lin@example.test'];
            page.composeText = 'Hello.';

            page.sendCompose();

            expect(sent).toEqual([{ via: 'send', id: 'mb1', request: { text: 'Hello.', to: ['lin@example.test'] } }]);
        });

        it('a refusal because the original could not be read: nothing went, it says so, and Send without the quote sends quote: false', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.composeText = 'Yes.';
            sendAnswer = () => throwError(() => new HttpErrorResponse({ status: 422, error: {
                type: '/errors/email/quoted-message-unavailable', messageId: 'm1',
            } }));

            page.sendCompose();

            expect(page.composeQuoteRefused()).toBeTrue();
            expect(page.composeOpen()).withContext('the composer stays, with the text').toBeTrue();
            expect(toasts).toEqual([]);
            sendAnswer = () => NEVER;
            page.sendWithoutQuote();
            expect(sent.map(s => [s.via, s.request.text, s.request.quote])).toEqual([['reply', 'Yes.', true], ['reply', 'Yes.', false]]);
            expect(page.composeQuoteRefused()).toBeFalse();
            expect(page.composeQuoteShown()).toBeFalse();
        });

        it('a draft keeps Remove quote on the server: the answer opened again sends without it, naming the draft', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.composeText = 'Later.';
            page.removeQuote();
            page.closeCompose();
            expect(drafts.of('create').map(c => [c.body!.answers, c.body!.quote])).toEqual([[{ messageId: 'm1', mode: 'reply' }, false]]);
            const id = [...drafts.drafts.keys()][0];

            page.onDetailAction('reply');
            expect(drafts.of('lookup').map(c => c.messageId)).withContext('found again by the message').toEqual(['m1', 'm1']);
            expect(page.composeQuoteShown()).toBeFalse();
            page.sendCompose();
            expect(sent.map(s => [s.request.text, s.request.quote, s.request.draftId])).toEqual([['Later.', false, id]]);
        });

        it('every draft states the quote: kept for an answer or a forward, false for a new message', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('forward');
            page.composeText = 'FYI.';
            page.closeCompose();
            page.openCompose();
            page.composeTo = ['ada@example.com'];
            page.composeText = 'New.';
            page.closeCompose();

            expect(drafts.of('create').map(c => [c.body!.answers, c.body!.quote])).toEqual([
                [{ messageId: 'm1', mode: 'forward' }, true],
                [null, false],
            ]);
            const keys = drafts.of('create').map(c => c.key);
            expect(keys.every(k => typeof k === 'string' && k !== '')).withContext('each create sends an Idempotency-Key').toBeTrue();
            expect(new Set(keys).size).withContext('a key of its own for each create').toBe(2);
        });

        it('a forward draft create that answers 5xx is tried again with the same Idempotency-Key: one draft', async () => {
            const page = build();
            page.composeRich.set(false);
            // The create commits on the server but its answer is a 503, as one whose answer was lost.
            drafts.failNextCreate(503, true);
            page.onDetailAction('forward');
            page.composeText = 'FYI.';
            page.closeCompose();
            expect(drafts.of('create').length).toBe(1);
            expect(drafts.of('lookup').length).withContext('a forward is not looked up by the message').toBe(1);

            await new Promise(resolve => setTimeout(resolve, DRAFT_RETRY_FIRST_MS + 200));

            const creates = drafts.of('create');
            expect(creates.length).withContext('tried again').toBe(2);
            expect(creates[1].key).withContext('with the same key').toBe(creates[0].key);
            expect(creates[1].body).toEqual(creates[0].body);
            expect(drafts.drafts.size).withContext('one draft').toBe(1);
            expect([...drafts.drafts.values()][0].answers).toEqual({ messageId: 'm1', mode: 'forward' });
        });

        it('Reply all opens the reply draft and switches it to reply all; never a second draft', () => {
            const page = build();
            page.composeRich.set(false);
            page.onDetailAction('reply');
            page.composeText = 'To everyone, in the end.';
            page.closeCompose();
            const id = [...drafts.drafts.keys()][0];

            page.onDetailAction('reply-all');
            expect(page.composeText).toBe('To everyone, in the end.');
            page.closeCompose();

            expect(drafts.of('create').length).toBe(1);
            expect(drafts.of('save').map(c => [c.id, c.body!.answers])).toEqual([[id, { messageId: 'm1', mode: 'reply_all' }]]);
            expect(drafts.drafts.get(id)!.answers).toEqual({ messageId: 'm1', mode: 'reply_all' });
        });

        it('says when the original could not be read, and shows no quote', () => {
            const page = build();
            answer = mode => of(answerFor(mode, { quote: null, unreadable: 'not-on-server' }));
            page.onDetailAction('reply');

            expect(page.composeUnreadable())
                .toBe('The original is not quoted: it is no longer stored here, and the mail server no longer holds it.');
            expect(page.composeQuoteHtml()).toBeNull();
            expect(page.composeQuoteText()).toBeNull();
        });

        it('a reader with no address to send as: no Send, and a send does nothing', () => {
            const page = build();
            answer = mode => of(answerFor(mode, { from: { address: 'work@example.test', choices: [] } }));
            page.onDetailAction('reply');
            page.composeText = 'Hi';
            page.composeRich.set(false);

            expect(page.composeMaySend()).toBeFalse();
            page.sendCompose();
            expect(sent).toEqual([]);
        });

        it('an answer arriving after its composer was closed fills nothing', () => {
            const page = build();
            const later = new Subject<EmailComposeDto>();
            answer = () => later;
            page.onDetailAction('reply');
            page.closeCompose();

            later.next(answerFor('reply'));

            expect(page.composePrefill()).toBeNull();
            expect(page.composeTo).toEqual([]);
        });
    });

    describe('drawn', () => {
        let fixture: ComponentFixture<EmailMailboxPageComponent>;

        /** The quote's frame component and the iframe it draws. */
        function quoteFrame(el: HTMLElement): { html: string | null | undefined; frame: HTMLIFrameElement | null } {
            const host = fixture.debugElement.query(d => d.attributes['data-testid'] === 'compose-quote');
            const html = host === null ? undefined : (host.componentInstance as MessageFrameComponent).html();
            return { html, frame: el.querySelector<HTMLIFrameElement>('[data-testid="compose-quote"] iframe') };
        }

        afterEach(() => (fixture?.nativeElement as HTMLElement | undefined)?.remove());

        function render(change: Partial<EmailComposeDto> = {}, action = 'reply', rich = false): HTMLElement {
            reset();
            answer = mode => of(answerFor(mode, change));
            TestBed.configureTestingModule({
                imports: [EmailMailboxPageComponent],
                // The real editor, with an empty profile (no toolbar contributors), as the editor's own specs build it.
                providers: [
                    ...providers(),
                    provideCoolmsEditor(),
                    { provide: EDITOR_MANIFEST_PROVIDER, useValue: { getProfile: () => ({ contributors: [], allowedWidgets: [] }) } },
                ] as never[],
            });
            TestBed.overrideComponent(EmailMailboxPageComponent, {
                set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
            });
            fixture = TestBed.createComponent(EmailMailboxPageComponent);
            document.body.appendChild(fixture.nativeElement);
            fixture.detectChanges();
            const page = fixture.componentInstance;
            page.composeRich.set(rich);
            page.selectedMailboxId.set('mb1');
            page.messages.set([MESSAGE]);
            page.selectedMessage.set({ ...MESSAGE, bodyText: 'Lunch at noon?' });
            page.onMessageAction(action, ['m1']);
            fixture.detectChanges();

            return fixture.nativeElement as HTMLElement;
        }

        it('the person\'s editor above, the served quote below it as served, and Send', () => {
            const el = render({}, 'reply', true);
            const text = el.querySelector('.mbx__compose coolms-editor');
            const quote = quoteFrame(el);

            expect(text).not.toBeNull();
            expect(quote.frame).not.toBeNull();
            expect(text!.compareDocumentPosition(quote.frame!) & Node.DOCUMENT_POSITION_FOLLOWING).withContext('the quote below').toBeTruthy();
            expect(quote.html).toBe(QUOTE_HTML);
            expect(el.querySelector('[data-testid="compose-from"]')).withContext('no From without a confirmed alias').toBeNull();
            expect(el.querySelector('[data-testid="compose-send"]')).not.toBeNull();
        });

        it('a forward: the served quote below the editor, read-only, in the mail frame page; its own files listed', () => {
            const el = render({}, 'forward', true);
            const quote = quoteFrame(el);

            expect(quote.html).toBe(QUOTE_HTML);
            expect(quote.frame?.getAttribute('sandbox')).withContext('the mail frame page: never scripts')
                .toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
            expect(quote.frame?.getAttribute('src')).toBe(MAIL_FRAME_PAGE);
            const files = [...el.querySelectorAll('[data-testid="compose-forward-files"] li')].map(li => li.textContent?.replace(/\s+/g, ' ').trim());
            expect(files.length).toBe(2);
            expect(files[0]).toContain('menu.pdf');
            expect(files[1]).toContain('notes.txt');
        });

        it('Plain text shows quote.text below the textarea, and no frame', () => {
            const el = render();
            const pre = el.querySelector('[data-testid="compose-quote-text"]');

            expect(pre?.textContent).toBe(QUOTE_TEXT);
            expect(el.querySelector('[data-testid="compose-quote"]')).toBeNull();
            expect(el.querySelector('textarea')!.compareDocumentPosition(pre!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('Remove quote hides the quote', () => {
            const el = render({}, 'reply', true);
            expect(el.querySelector('[data-testid="compose-quote"]')).not.toBeNull();

            el.querySelector<HTMLButtonElement>('[data-testid="compose-remove-quote"]')!.click();
            fixture.detectChanges();

            expect(el.querySelector('[data-testid="compose-quote-box"]')).toBeNull();
            expect(el.querySelector('[data-testid="compose-quote"]')).toBeNull();
        });

        it('the editor opens empty and focused', async () => {
            const el = render();
            for (let i = 0; i < 40 && document.activeElement?.tagName !== 'TEXTAREA'; i++) {
                await new Promise(resolve => setTimeout(resolve, 25));
                fixture.detectChanges();
            }

            expect(document.activeElement).toBe(el.querySelector('textarea'));
            expect((document.activeElement as HTMLTextAreaElement).value).toBe('');
        });

        it('the quote is never inside the editor: the frame holds it, the editor\'s DOM does not', async () => {
            const el = render({}, 'forward', true);
            let editable: HTMLElement | null = null;
            let quoteDoc: Document | null = null;
            for (let i = 0; i < 100; i++) {
                fixture.detectChanges();
                editable = el.querySelector<HTMLElement>('coolms-editor [contenteditable="true"]');
                quoteDoc = quoteFrame(el).frame?.contentDocument ?? null;
                if (editable !== null && (quoteDoc?.body?.textContent ?? '').includes('Lunch at noon?')) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }

            expect(editable).withContext('the editor mounted').not.toBeNull();
            expect(quoteDoc?.body.textContent).withContext('the control: the frame holds the quote').toContain('Lunch at noon?');
            const editor = el.querySelector('coolms-editor')!;
            expect(editor.textContent).not.toContain('Lunch at noon?');
            expect(editor.textContent).not.toContain('Ada Byron');
            expect(editor.querySelector('iframe, app-message-frame, [data-testid="compose-quote-box"]')).toBeNull();
            expect(fixture.componentInstance.composeHtml()).toBe('');
        });

        it('says the original could not be read, and draws no quote', () => {
            const el = render({ quote: null, unreadable: 'server-failed' });

            expect(el.querySelector('[data-testid="compose-unreadable"]')?.textContent?.trim())
                .toBe('The original is not quoted: the mail server could not be read just now.');
            expect(el.querySelector('[data-testid="compose-quote"]')).toBeNull();
        });

        it('a reader with no address to send as: the sentence, and no Send', () => {
            const el = render({ from: { address: 'work@example.test', choices: [] } });

            expect(el.querySelector('[data-testid="compose-send"]')).toBeNull();
            expect(el.querySelector('[data-testid="compose-no-send"]')?.textContent?.trim())
                .toBe('You may read this mailbox but not send from it, so this cannot be sent from here.');
        });
    });
});
