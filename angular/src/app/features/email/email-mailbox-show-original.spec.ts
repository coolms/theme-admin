import { Dialog } from '@angular/cdk/dialog';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of, Subject } from 'rxjs';
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
import { MESSAGE_SOURCE_WORDS } from './message-source.component';

function node(path: string, meta: Record<string, unknown>): NaviGraphNode {
    return { id: path, path, title: path, parentId: null, sortOrder: 0, isActive: true, isVisible: true, meta, children: [] };
}

const SINGLE = { field: '_single', op: 'eq', value: true };
/** The message tree as the server seeds it, its view actions among it (navi.toolbar.email.message). */
const MESSAGE_NODES: NaviGraphNode[] = [
    node('/reply', { action: 'reply', label: 'Reply', icon: 'reply', group: 'respond' }),
    node('/archive', { action: 'archive', label: 'Archive', icon: 'archive', group: 'remove' }),
    node('/show-original', { action: 'show-original', label: 'Show original', icon: 'file-earmark-code', group: 'view', overflow: 0,
        showWhen: { and: [SINGLE, { field: '_view', op: 'ne', value: 'original' }] } }),
    node('/show-message', { action: 'show-message', label: 'Show message', icon: 'envelope-open', group: 'view',
        showWhen: { and: [SINGLE, { field: '_view', op: 'eq', value: 'original' }] } }),
    node('/copy-source', { action: 'copy-source', label: 'Copy source', icon: 'clipboard', group: 'view', overflow: 5,
        showWhen: { and: [SINGLE, { field: '_view', op: 'eq', value: 'original' }] } }),
    node('/download-eml', { action: 'download-eml', label: 'Download message (.eml)', icon: 'download', group: 'view', overflow: 0,
        showWhen: SINGLE }),
];

/** The served reader's evaluation, reduced to what these nodes use: and, eq, ne; a fact not stated matches nothing. */
function holds(c: Record<string, unknown> | null | undefined, record: Record<string, unknown>): boolean {
    if (!c) {
        return true;
    }
    if (Array.isArray(c['and'])) {
        return (c['and'] as Record<string, unknown>[]).every(x => holds(x, record));
    }
    const field = String(c['field']);
    if (!(field in record)) {
        return false;
    }
    return c['op'] === 'ne' ? record[field] !== c['value'] : record[field] === c['value'];
}

const LISTED: EmailMessageDto[] = [
    { id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday' },
    { id: 'm2', folder: 'INBOX', subject: 'Statement for October' },
];

/**
 * Show original on the mailbox page: the original replaces the message in the reading pane, in the same place, and the
 * view toggles from the pane's row and More actions, as the server's tree declares: Show original while the message
 * shows; Show message (in the row), Copy source and Download message with the original. No viewer over the page, no
 * switch row. Escape, another message or Show message brings the message back.
 */
describe('EmailMailboxPageComponent -- show original', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let dialogs: number;
    let sources: Map<string, Subject<HttpResponse<string>>>;
    let downloads: string[];

    beforeEach(() => {
        dialogs = 0;
        sources = new Map();
        downloads = [];
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
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of(LISTED),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                        getMessageSource: (id: string) => {
                            const answer = new Subject<HttpResponse<string>>();
                            sources.set(id, answer);
                            return answer;
                        },
                        downloadMessageSource: (id: string) => {
                            downloads.push(id);
                            return NEVER;
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
                        isVisible: (n: NaviGraphNode, record: Record<string, unknown>) =>
                            holds(n.meta['showWhen'] as Record<string, unknown> | undefined, record),
                        matchesShowWhen: (c: Record<string, unknown> | null | undefined, record: Record<string, unknown>) =>
                            c ? holds(c, record) : false,
                    },
                },
                { provide: Dialog, useValue: { open: () => void dialogs++ } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
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
    const page = (): EmailMailboxPageComponent => fixture.componentInstance;
    const row = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-row"]')!;
    const scroll = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="detail-scroll"]')!;
    const inRow = (): string[] => Array.from(row().querySelectorAll<HTMLElement>('[data-action]'))
        .filter(b => !b.hidden).map(b => b.dataset['action']!);
    const behindMore = (): string[] => Array.from(row().querySelectorAll<HTMLElement>('[data-action]'))
        .filter(b => b.hidden).map(b => b.dataset['action']!);

    function open(id = 'm1'): void {
        const listed = LISTED.find(m => m.id === id)!;
        page().selectedMessage.set({ ...listed, bodyText: `The body of ${id}.` } as EmailMessageDetailDto);
    }
    async function sourceShown(id: string, text: string): Promise<void> {
        sources.get(id)!.next(new HttpResponse({ body: text, headers: new HttpHeaders({ 'X-Raw-Truncated': 'false' }) }));
        await settle();
    }

    it('shows the message, with Show original and Download behind More actions and no view action in the row', async () => {
        el().style.width = '1400px';
        open();
        await settle();
        expect(inRow()).toEqual(['reply', 'archive', 'more']);
        expect(behindMore()).toEqual(['show-original', 'download-eml']);
        expect(scroll().textContent).toContain('The body of m1.');
        expect(el().querySelector('app-message-source')).toBeNull();
        expect(sources.size).withContext('no source read while the message shows').toBe(0);
    });

    it('Show original puts the source in the message\'s place in the reading pane, never a viewer over the page', async () => {
        el().style.width = '1400px';
        open();
        await settle();
        page().onDetailAction('show-original');
        await settle();
        const original = scroll().querySelector('app-message-source');
        expect(original).withContext('in the pane\'s scroll region').not.toBeNull();
        expect(scroll().querySelector('.mbx__detail-head')).withContext('the message\'s header gives way').toBeNull();
        expect(scroll().textContent).not.toContain('The body of m1.');
        await sourceShown('m1', 'Received: from relay\r\nSubject: Desk move');
        expect(scroll().querySelector('[data-test="source-text"]')!.textContent).toBe('Received: from relay\r\nSubject: Desk move');
        expect(dialogs).withContext('no dialog').toBe(0);
        // The row as the source shows, wide: Show message and Copy source in it, Download behind More actions.
        expect(inRow()).toEqual(['reply', 'archive', 'show-message', 'copy-source', 'more']);
        expect(behindMore()).toEqual(['download-eml']);
        expect(page().detailFacts()['_view']).toBe('original');
        // Narrow: Copy source goes behind More actions first; Show message stays in the row.
        el().style.width = '320px';
        await settle();
        expect(inRow()).toContain('show-message');
        expect(behindMore()).toEqual(['copy-source', 'download-eml']);
    });

    it('Show message brings the message back in the same place', async () => {
        open();
        await settle();
        page().onDetailAction('show-original');
        await settle();
        page().onDetailAction('show-message');
        await settle();
        expect(el().querySelector('app-message-source')).toBeNull();
        expect(scroll().textContent).toContain('The body of m1.');
        expect(page().detailFacts()['_view']).toBe('message');
    });

    it('Escape in the pane brings the message back; Escape in a field there does not', async () => {
        open();
        await settle();
        page().onDetailAction('show-original');
        await settle();
        await sourceShown('m1', 'Received: one');
        const field = document.createElement('input');
        scroll().appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await settle();
        expect(el().querySelector('app-message-source')).withContext('a field holds Escape').not.toBeNull();
        field.remove();
        scroll().querySelector<HTMLElement>('[data-test="source-text"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await settle();
        expect(el().querySelector('app-message-source')).toBeNull();
        expect(scroll().textContent).toContain('The body of m1.');
    });

    it('keeps the original for the next message, read afresh; the pane closed, the next message opens as written', async () => {
        open('m1');
        await settle();
        page().onDetailAction('show-original');
        await settle();
        expect(page().detailFacts()['_view']).toBe('original');
        expect(page().bulkFacts()['_view']).withContext('no rows checked').toBe('message');
        open('m2');
        await settle();
        expect(scroll().querySelector('app-message-source')).withContext('the next message opens in its original').not.toBeNull();
        expect(sources.has('m2')).withContext('its own source is read').toBeTrue();
        expect(page().originalShown()).toBe('m2');
        expect(page().detailFacts()['_view']).toBe('original');
        await sourceShown('m2', 'Received: second');
        expect(scroll().querySelector('[data-test="source-text"]')!.textContent).toBe('Received: second');
        page().selectedMessage.set(null);
        await settle();
        open('m1');
        await settle();
        expect(el().querySelector('app-message-source')).toBeNull();
        expect(scroll().textContent).toContain('The body of m1.');
        expect(page().detailFacts()['_view']).toBe('message');
    });

    it('opens nothing for several messages', async () => {
        open();
        await settle();
        page().onMessageAction('show-original', ['m1', 'm2']);
        await settle();
        expect(el().querySelector('app-message-source')).toBeNull();
        expect(page().originalShown()).toBeNull();
    });

    it('Copy source says what it did in the pane; Download message asks the server for the .eml in either view', async () => {
        const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
        open();
        await settle();
        page().onDetailAction('download-eml');
        expect(downloads).withContext('from the message').toEqual(['m1']);
        page().onDetailAction('show-original');
        await settle();
        page().onDetailAction('copy-source');
        await settle();
        expect(el().querySelector('[data-test="source-note"]')!.textContent!.trim()).toBe(MESSAGE_SOURCE_WORDS.copyLoading);
        await sourceShown('m1', 'Received: one');
        page().onDetailAction('copy-source');
        await settle();
        expect(write).toHaveBeenCalledOnceWith('Received: one');
        expect(el().querySelector('[data-test="source-note"]')!.textContent!.trim()).toBe(MESSAGE_SOURCE_WORDS.copied);
        page().onDetailAction('download-eml');
        expect(downloads).withContext('from the original').toEqual(['m1', 'm1']);
        // Another message: the note goes with the one it was said for.
        open('m2');
        await settle();
        expect(el().querySelector('[data-test="source-note"]')!.textContent!.trim()).toBe('');
    });

    it('shows no source in the reading pane until asked, and never reads rawBody', async () => {
        let reads = 0;
        const detail = { ...LISTED[0], bodyText: 'The movers come at nine.' } as EmailMessageDetailDto;
        Object.defineProperty(detail, 'rawBody', {
            enumerable: true,
            get: () => {
                reads++;
                return 'X-SECRET-RAW: inline source';
            },
        });
        page().selectedMessage.set(detail);
        await settle();
        expect(el().textContent).toContain('The movers come at nine.');
        expect(el().textContent).not.toContain('X-SECRET-RAW');
        expect(reads).withContext('reads of rawBody').toBe(0);
    });
});
