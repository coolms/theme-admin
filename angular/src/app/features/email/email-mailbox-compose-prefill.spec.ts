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
    DraftStoreService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import type { EmailComposeDto, EmailComposeMode, EmailMailboxDto, EmailMessageDto, OutgoingEmailRequest } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { MAIL_FRAME_PAGE, MessageFrameComponent } from './message-frame.component';

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
        attachments: [],
        unreadable: null,
        ...change,
    };
}

const MESSAGE: EmailMessageDto = {
    id: 'm1', mailboxId: 'mb1', folder: 'INBOX', fromName: 'Ada Byron', fromAddress: 'ada@example.test',
    toAddresses: ['work@example.test'], subject: 'Lunch', seen: true, replyAllUseful: true,
};

/**
 * Reply, Reply all and Forward start from what the server prepares: each asks the compose prefill with its mode and
 * fills the composer from the answer, says it is being read and why it could not be, shows the served quote as served
 * below the person's text, and sends the served From -- an answer through the reply endpoint (which threads it) with
 * the server's quote; a forward its own part alone, the quote shown and not sent until the server has a way to add it.
 */
describe('EmailMailboxPageComponent -- the server prepares an answer or a forward', () => {
    let asked: [string, EmailComposeMode][];
    let answer: (mode: EmailComposeMode) => Observable<EmailComposeDto>;
    let sent: { via: 'send' | 'reply'; id: string; request: OutgoingEmailRequest }[];
    let toasts: string[];

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
                    composePrefill: (id: string, mode: EmailComposeMode) => {
                        asked.push([id, mode]);
                        return answer(mode);
                    },
                    send: (id: string, request: OutgoingEmailRequest) => {
                        sent.push({ via: 'send', id, request });
                        return NEVER;
                    },
                    reply: (id: string, request: OutgoingEmailRequest) => {
                        sent.push({ via: 'reply', id, request });
                        return NEVER;
                    },
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
            { provide: DraftStoreService, useValue: { load: () => null, save: noop, clear: noop } },
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
        answer = mode => of(answerFor(mode));
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
                expect(page.composeFrom()).toBe('sales@example.test');
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

        it('a reply all sends the served Cc, and an answer with nothing to quote asks for no quote', () => {
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
                ['reply', 'm1', undefined, 'sales@example.test', undefined],
            ]);
        });

        it('a forward sends the person\'s own part alone with the served From, and says its quote is not sent yet', () => {
            const page = build();
            page.onDetailAction('forward');
            page.composeTo = ['lin@example.test'];
            page.composeHtml.set('<p>See below.</p>');

            page.sendCompose();

            expect(page.prefillHasQuote()).toBeTrue();
            expect(sent).toEqual([{ via: 'send', id: 'mb1', request: {
                text: 'See below.', html: '<p>See below.</p>', to: ['lin@example.test'], subject: 'Fwd: Lunch', from: 'sales@example.test',
            } }]);
        });

        it('says when the original could not be read, and shows no quote', () => {
            const page = build();
            answer = mode => of(answerFor(mode, { quote: null, unreadable: 'the message is no longer on the server where it was stored' }));
            page.onDetailAction('reply');

            expect(page.composeUnreadable())
                .toBe('The original is not quoted: the message is no longer on the server where it was stored.');
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

        function render(change: Partial<EmailComposeDto> = {}, action = 'reply'): HTMLElement {
            reset();
            answer = mode => of(answerFor(mode, change));
            TestBed.configureTestingModule({ imports: [EmailMailboxPageComponent], providers: providers() as never[] });
            TestBed.overrideComponent(EmailMailboxPageComponent, {
                set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
            });
            fixture = TestBed.createComponent(EmailMailboxPageComponent);
            fixture.detectChanges();
            const page = fixture.componentInstance;
            page.composeRich.set(false);
            page.selectedMailboxId.set('mb1');
            page.messages.set([MESSAGE]);
            page.selectedMessage.set({ ...MESSAGE, bodyText: 'Lunch at noon?' });
            page.onMessageAction(action, ['m1']);
            fixture.detectChanges();

            return fixture.nativeElement as HTMLElement;
        }

        it('the person\'s text above, the served quote below it as served, the From, and Send', () => {
            const el = render();
            const text = el.querySelector('.mbx__compose textarea');
            const quote = quoteFrame(el);

            expect(text).not.toBeNull();
            expect(quote.frame).not.toBeNull();
            expect(text!.compareDocumentPosition(quote.frame!) & Node.DOCUMENT_POSITION_FOLLOWING).withContext('the quote below').toBeTruthy();
            expect(quote.html).toBe(QUOTE_HTML);
            expect(el.querySelector('[data-testid="compose-from"]')?.textContent?.trim()).toBe('sales@example.test');
            expect(el.querySelector('[data-testid="compose-send"]')).not.toBeNull();
        });

        it('a forward: the served header block below the text, read-only, and the sentence that it is not sent yet', () => {
            const el = render({}, 'forward');
            const quote = quoteFrame(el);

            expect(quote.html).toBe(QUOTE_HTML);
            expect(quote.frame?.getAttribute('sandbox')).withContext('the mail frame page: never scripts')
                .toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
            expect(quote.frame?.getAttribute('src')).toBe(MAIL_FRAME_PAGE);
            expect(el.querySelector('[data-testid="compose-forward-unsent"]')?.textContent?.trim())
                .toBe('The forwarded message is shown here only. It is not sent with yours yet.');
        });

        it('says the original could not be read, and draws no quote', () => {
            const el = render({ quote: null, unreadable: 'the server could not be read' });

            expect(el.querySelector('[data-testid="compose-unreadable"]')?.textContent?.trim())
                .toBe('The original is not quoted: the server could not be read.');
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
