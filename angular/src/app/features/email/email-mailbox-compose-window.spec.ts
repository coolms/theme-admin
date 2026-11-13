import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, Subject, of } from 'rxjs';
import { AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    ToastService,
} from '@coolms/ui-angular';
import { EDITOR_MANIFEST_PROVIDER, provideCoolmsEditor } from '@coolms/editor-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { DISCARD_UNDO_MS, MAIL_EDITOR_PROFILE, MAX_COMPOSE_WINDOWS, windowsToClose, type ComposeWindowSnapshot } from './compose-windows';
import { FakeDraftsApi } from './email-drafts.fake';
import { EmailLiveEventsService } from './email-live-events.service';
import { DRAFT_GONE_KEPT } from './server-draft';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import { type EmailMailboxDto, type OutgoingEmailRequest } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailAliasesDto } from './mail-aliases';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

interface Shown { type: string; message: string; action?: { label: string; run: () => void } }

/**
 * The compose window to the contract: docked and not modal (role dialog, aria-modal false); Minimize to a bar naming the
 * subject (or New message) and the recipients; Maximize centred over a dimmed backdrop, modal, with the focus kept
 * inside, and a click on the backdrop minimizes; Esc minimizes once an open suggestion list has closed; Ctrl or
 * Cmd+Enter sends; at most three windows, minimized ones as bars to the left, a fourth closing the one unused longest
 * with its draft kept; From only with confirmed aliases; Close keeps the draft and there is no Cancel; Discard always,
 * with a 10 second Undo once a draft was saved, after a save on its way has landed. Drafts are the server's (its drafts
 * API, in memory here). Rendered and laid out at 1400 x 800, fixed at the window's top left.
 */
describe('EmailMailboxPageComponent -- the compose window', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let sent: OutgoingEmailRequest[];
    let shown: Shown[];
    let server: FakeDraftsApi;
    let live: Subject<unknown>;
    let infos: string[];
    let aliases: MailAliasesDto;
    let removed: string[];

    beforeEach(() => {
        sent = [];
        shown = [];
        removed = [];
        // This test's own drafts: the mock below closes over them, so a save still pending from an earlier test's
        // page writes into that page's drafts, never into these.
        const drafts = new FakeDraftsApi();
        server = drafts;
        live = new Subject<unknown>();
        const told: string[] = [];
        infos = told;
        aliases = { canManage: false, aliases: [] };
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work', emailAddress: 'work@example.test' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of([]),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                        listAliases: (): Observable<MailAliasesDto> => of(aliases),
                        composePrefill: () => NEVER,
                        removeAttachment: (_mb: string, id: string) => {
                            removed.push(id);
                            return of(null);
                        },
                        send: (_id: string, request: OutgoingEmailRequest) => {
                            sent.push(structuredClone(request));
                            return NEVER;
                        },
                        ...drafts.api(),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: {
                        error: (): void => {}, success: (): void => {}, info: (m: string): void => void told.push(m),
                        show: (t: Shown, ms: number): number => {
                            shown.push({ ...t, message: `${t.message} (${ms} ms)` });
                            return shown.length;
                        },
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
                // The real editor, with an empty profile, for the window's formatted body.
                provideCoolmsEditor(),
                { provide: EDITOR_MANIFEST_PROVIDER, useValue: { getProfile: () => ({ contributors: [], allowedWidgets: [] }) } },
            ] as never[],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        const host = fixture.nativeElement as HTMLElement;
        Object.assign(host.style, { display: 'flex', position: 'fixed', top: '0', left: '0', width: '1400px', height: '800px' });
        document.body.appendChild(host);
        fixture.componentInstance.composeRich.set(false);
        fixture.componentInstance.selectedMailboxId.set('mb1');
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const page = (): EmailMailboxPageComponent => fixture.componentInstance;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const win = (): HTMLElement | null => el().querySelector<HTMLElement>('[data-testid="compose-window"]');
    const bars = (): HTMLElement[] => [...el().querySelectorAll<HTMLElement>('[data-testid="compose-bar"]')];
    const texts = (): string[] => [...server.drafts.values()].map(d => d.text);
    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await frame();
        }
        fixture.detectChanges();
    }
    function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        fixture.detectChanges();
        return event;
    }
    async function compose(to: string[], subject: string, text: string): Promise<void> {
        // Plain text before it opens: the page sets the format from the person's preferences on load.
        page().composeRich.set(false);
        page().openCompose();
        await settle();
        page().composeRich.set(false);
        page().composeTo = to;
        page().composeSubject = subject;
        page().composeText = text;
        page().onComposeChange();
        await settle();
    }

    it('docked: a dialog that is not modal, with Minimize, Maximize and Close; no Cancel; Discard always offered', async () => {
        await compose([], '', '');

        expect(win()!.getAttribute('role')).toBe('dialog');
        expect(win()!.getAttribute('aria-modal')).toBe('false');
        expect(win()!.getAttribute('aria-labelledby')).toBe('mbx-compose-title');
        expect(el().querySelector('#mbx-compose-title')?.textContent?.trim()).toBe('New message');
        expect([...win()!.querySelectorAll('.mbx__compose-head-actions button')].map(b => b.getAttribute('aria-label')))
            .toEqual(['Minimize', 'Maximize', 'Close']);
        const labels = [...win()!.querySelectorAll('button')].map(b => b.textContent?.trim());
        expect(labels).not.toContain('Cancel');
        expect(win()!.querySelector('[data-testid="compose-discard"]')).withContext('Discard with no draft saved').not.toBeNull();
        expect(el().querySelector('[data-testid="compose-backdrop"]')).toBeNull();
        expect(page().editorProfile).toBe(MAIL_EDITOR_PROFILE);
        expect(MAIL_EDITOR_PROFILE).withContext('until the mail profile is served').toBe('standard');
    });

    it('docked: 600 px wide and at most about 70% of the viewport tall; header buttons at least 36 px', async () => {
        await compose([], '', '');
        const box = win()!.getBoundingClientRect();
        expect(box.width).toBeCloseTo(600, 0);
        expect(box.height).toBeLessThanOrEqual(window.innerHeight * 0.7 + 1);
        for (const b of win()!.querySelectorAll<HTMLElement>('.mbx__compose-head-actions button')) {
            const r = b.getBoundingClientRect();
            expect(Math.min(r.width, r.height)).withContext(b.getAttribute('aria-label')!).toBeGreaterThanOrEqual(36);
        }
        // The editor takes the height the lines and the foot leave: it grows with the window.
        const editor = (): number => win()!.querySelector<HTMLElement>('.mbx__compose-editor')!.getBoundingClientRect().height;
        const docked = editor();
        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-maximize"]')!.click();
        await settle();
        const taller = win()!.getBoundingClientRect().height - box.height;
        expect(taller).withContext('Maximize gives more').toBeGreaterThan(0);
        expect(editor()).withContext('the editor takes it').toBeGreaterThan(docked);
    });

    it('From, To, Cc, Bcc and Subject are compact lines, their labels in one column at least 52 px wide', async () => {
        aliases = { canManage: true, aliases: [{ id: 'a1', address: 'sales@example.test', status: 'confirmed', requestedAt: '' }] };
        await compose(['ada@example.test'], 'Hi', 'Hello');
        const lines = win()!.querySelector<HTMLElement>('[data-testid="compose-lines"]')!;
        expect(getComputedStyle(lines).display).toBe('grid');
        expect([...win()!.querySelectorAll('.mbx__line-label')].map(l => l.textContent!.trim())).toEqual(['From', 'To', 'Subject']);

        // Cc and Bcc: two links at the end of the To line, each opening its own line.
        const to = win()!.querySelector<HTMLElement>('[data-testid="compose-to"]')!.closest<HTMLElement>('.mbx__line')!;
        const links = [...to.querySelectorAll<HTMLButtonElement>('.mbx__line-links button')];
        expect(links.map(b => b.textContent!.trim())).toEqual(['Cc', 'Bcc']);
        const toBox = to.getBoundingClientRect();
        expect(links[1].getBoundingClientRect().right).withContext('at the end of the To line').toBeGreaterThan(toBox.right - 40);
        links[0].click();
        await settle();
        expect([...win()!.querySelectorAll('.mbx__line-label')].map(l => l.textContent!.trim())).toEqual(['From', 'To', 'Cc', 'Subject']);
        expect(document.activeElement).withContext('the Cc field focused')
            .toBe(win()!.querySelector('[data-testid="compose-cc"] input'));
        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-add-bcc"]')!.click();
        await settle();
        expect(win()!.querySelector('[data-testid="compose-add-cc"], [data-testid="compose-add-bcc"]')).toBeNull();

        const labels = [...win()!.querySelectorAll<HTMLElement>('.mbx__line-label')];
        expect(labels.map(l => l.textContent!.trim())).toEqual(['From', 'To', 'Cc', 'Bcc', 'Subject']);
        const lefts = labels.map(l => Math.round(l.getBoundingClientRect().left));
        expect(new Set(lefts).size).withContext('one column').toBe(1);
        const fields = [...win()!.querySelectorAll<HTMLElement>('.mbx__line-field')].map(f => Math.round(f.getBoundingClientRect().left));
        expect(new Set(fields).size).withContext('the fields start together').toBe(1);
        expect(fields[0] - lefts[0]).withContext('the column at least 52 px, and the gap').toBeGreaterThanOrEqual(52 + 12);
        const widest = Math.max(...labels.map(l => l.getBoundingClientRect().width));
        expect(fields[0] - lefts[0]).withContext('as wide as the longest label').toBeGreaterThanOrEqual(widest);
        expect(parseFloat(getComputedStyle(lines).gridTemplateColumns.split(' ')[0])).withContext('the label column')
            .toBeCloseTo(Math.max(52, widest), 1);
        for (const line of win()!.querySelectorAll<HTMLElement>('.mbx__line')) {
            const s = getComputedStyle(line);
            expect(line.getBoundingClientRect().height).withContext('about 40 px').toBeGreaterThanOrEqual(39);
            expect(line.getBoundingClientRect().height).toBeLessThan(48);
            expect(s.borderBottomWidth).withContext('a thin divider below').toBe('1px');
            expect(s.borderTopWidth).toBe('0px');
        }
        const subject = win()!.querySelector<HTMLInputElement>('[data-testid="compose-subject"]')!;
        expect(getComputedStyle(subject).borderTopWidth).withContext('not a boxed input').toBe('0px');

        // Still real labelled fields.
        expect(win()!.querySelector('[data-testid="compose-from"]')!.tagName).toBe('SELECT');
        expect((win()!.querySelector('[data-testid="compose-from"]') as HTMLSelectElement).labels![0].textContent).toContain('From');
        expect(subject.labels![0].textContent).toContain('Subject');
        for (const which of ['to', 'cc', 'bcc']) {
            const input = win()!.querySelector<HTMLInputElement>(`[data-testid="compose-${which}"] input`)!;
            expect(document.getElementById(input.getAttribute('aria-labelledby')!)?.textContent?.trim())
                .toBe(which === 'to' ? 'To' : which === 'cc' ? 'Cc' : 'Bcc');
        }
    });

    it('the foot: Send, attach, the saved state, More options and Discard, as icons labelled', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        await wait(700);
        await settle();
        const foot = win()!.querySelector<HTMLElement>('.mbx__compose-foot')!;
        const named = [...foot.querySelectorAll<HTMLElement>('button[data-testid], button[data-test], [data-testid="compose-draft-saved"]')]
            .filter(b => b.closest('[role="menu"]') === null)
            .map(b => b.getAttribute('aria-label') ?? b.textContent!.trim().split(' ')[0]);
        expect(named).toEqual(['Send', 'Attach files', 'Saved', 'More options', 'Discard draft']);
        expect(foot.querySelector('[data-testid="compose-send"]')!.getAttribute('title')).toBe('Send (Ctrl+Enter)');
        expect(foot.querySelector('[data-testid="compose-plain-text"]')).withContext('no switch in the foot').toBeNull();
        expect(foot.textContent).not.toContain('Rich text');
    });

    it('Plain text is a checkable item of the More options menu', async () => {
        page().composeRich.set(true);
        page().openCompose();
        await settle();
        const more = win()!.querySelector<HTMLButtonElement>('[data-testid="compose-more"]')!;
        expect(more.getAttribute('aria-haspopup')).toBe('menu');
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(win()!.querySelector('[role="menu"]')).toBeNull();

        more.click();
        await settle();
        expect(more.getAttribute('aria-expanded')).toBe('true');
        const menu = win()!.querySelector<HTMLElement>('[data-testid="compose-more-menu"]')!;
        expect(menu.getAttribute('role')).toBe('menu');
        const item = menu.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
        expect(item.textContent!.trim()).toBe('Plain text');
        expect(item.getAttribute('aria-checked')).toBe('false');

        item.click();
        await settle();
        expect(page().composeRich()).withContext('plain text now').toBeFalse();
        expect(win()!.querySelector('textarea.mbx__compose-text')).not.toBeNull();
        expect(win()!.querySelector('[role="menu"]')).withContext('the menu closes').toBeNull();
        more.click();
        await settle();
        expect(win()!.querySelector('[role="menuitemcheckbox"]')!.getAttribute('aria-checked')).toBe('true');

        // Esc closes the menu first; the window stays.
        key(win()!.querySelector('[role="menuitemcheckbox"]')!, { key: 'Escape' });
        await settle();
        expect(win()!.querySelector('[role="menu"]')).toBeNull();
        expect(page().composeMinimized()).toBeFalse();
    });

    it('where one pane shows at a time: full screen, Minimize and Close only, each at least 44 px', async () => {
        (page() as unknown as { phone: { set(v: boolean): void } }).phone.set(true);
        await compose([], '', '');

        expect(win()!.classList).toContain('mbx__compose--full');
        const box = win()!.getBoundingClientRect();
        expect([box.left, box.top, box.width, box.height])
            .toEqual([0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight]);
        const head = [...win()!.querySelectorAll<HTMLElement>('.mbx__compose-head-actions button')];
        expect(head.map(b => b.getAttribute('aria-label'))).withContext('no Maximize').toEqual(['Minimize', 'Close']);
        expect(win()!.querySelector('[data-testid="compose-maximize"]')).toBeNull();
        for (const b of head) {
            const r = b.getBoundingClientRect();
            expect(Math.min(r.width, r.height)).withContext(b.getAttribute('aria-label')!).toBeGreaterThanOrEqual(44);
        }
    });

    it('Minimize leaves a bar with the subject and the recipients; a click on it restores the window', async () => {
        await compose(['ada@example.test', 'lin@example.test'], 'Lunch', 'Noon?');

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-minimize"]')!.click();
        await settle();
        expect(win()!.querySelector('.mbx__compose-body')).toBeTruthy();
        expect(getComputedStyle(win()!.querySelector('.mbx__compose-body')!).display).toBe('none');
        expect(win()!.querySelector('.mbx__compose-title-text')?.textContent?.trim()).toBe('Lunch');
        expect(win()!.querySelector('[data-testid="compose-recipients"]')?.textContent?.trim()).toBe('ada@example.test, lin@example.test');

        const subject = win()!.querySelector<HTMLInputElement>('[data-testid="compose-subject"]')!;
        subject.value = '';
        subject.dispatchEvent(new Event('input'));
        await settle();
        expect(win()!.querySelector('.mbx__compose-title-text')?.textContent?.trim()).toBe('New message');

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-title"]')!.click();
        await settle();
        expect(page().composeMinimized()).toBeFalse();
    });

    it('Maximize: centred over a dimmed backdrop, modal, the focus kept inside; a click on the backdrop minimizes', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-maximize"]')!.click();
        await settle();

        const box = win()!.getBoundingClientRect();
        expect(win()!.getAttribute('aria-modal')).toBe('true');
        // The viewport a fixed box is placed in: the window without its scrollbars.
        const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
        expect(box.left + box.width / 2).withContext('centred across').toBeCloseTo(view.width / 2, 0);
        expect(box.top + box.height / 2).withContext('centred down').toBeCloseTo(view.height / 2, 0);
        const backdrop = el().querySelector<HTMLElement>('[data-testid="compose-backdrop"]')!;
        expect(backdrop).not.toBeNull();
        const scrim = backdrop.getBoundingClientRect();
        expect([scrim.left, scrim.top, scrim.width, scrim.height]).withContext('over the whole viewport').toEqual([0, 0, view.width, view.height]);
        expect(getComputedStyle(backdrop).backgroundColor).withContext('dimmed').not.toBe('rgba(0, 0, 0, 0)');
        // The focus trap: its anchors on either side of the window, and the focus inside it.
        const anchors = [win()!.previousElementSibling, win()!.nextElementSibling];
        expect(anchors.map(a => a?.classList.contains('cdk-focus-trap-anchor'))).toEqual([true, true]);
        await wait(50);
        expect(win()!.contains(document.activeElement)).withContext('focus inside').toBeTrue();
        (anchors[1] as HTMLElement).focus();
        await settle();
        expect(win()!.contains(document.activeElement)).withContext('tabbing past the end wraps inside').toBeTrue();

        backdrop.click();
        await settle();
        expect(page().composeMinimized()).toBeTrue();
        expect(win()!.getAttribute('aria-modal')).toBe('false');
        expect(el().querySelector('[data-testid="compose-backdrop"]')).toBeNull();
    });

    it('Esc minimizes and keeps the draft; an open suggestion list takes the first Esc', async () => {
        await compose([], 'Lunch', 'Noon?');
        page().contactOptions.set([{ value: 'lin@example.test', label: 'Lin Park <lin@example.test>' }]);
        await settle();
        const field = win()!.querySelector<HTMLInputElement>('app-tag-input input')!;
        field.focus();
        field.value = 'Li';
        field.dispatchEvent(new Event('input'));
        await settle();
        expect(win()!.querySelector('.tagin-menu')).withContext('the list is open').not.toBeNull();

        key(field, { key: 'Escape' });
        await settle();
        expect(win()!.querySelector('.tagin-menu')).withContext('the first Esc closed the list').toBeNull();
        expect(page().composeMinimized()).withContext('and did not minimize').toBeFalse();

        key(field, { key: 'Escape' });
        await settle();
        expect(page().composeMinimized()).toBeTrue();
        expect(page().composeOpen()).toBeTrue();
        await wait(700);
        expect(texts()).withContext('the draft kept').toEqual(['Noon?']);
    });

    it('Ctrl+Enter and Cmd+Enter send', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        const box = win()!.querySelector('textarea')!;

        const plain = key(box, { key: 'Enter' });
        expect(plain.defaultPrevented).toBeFalse();
        expect(sent).toEqual([]);
        key(box, { key: 'Enter', ctrlKey: true });
        expect(sent).toEqual([{ text: 'Noon?', to: ['ada@example.test'], subject: 'Lunch' }]);

        page().sending.set(false);
        key(box, { key: 'Enter', metaKey: true });
        expect(sent.length).toBe(2);
    });

    it('several windows: minimized ones are bars to the left; a fourth closes the one unused longest, its draft kept', async () => {
        await compose(['a@example.test'], 'One', 'first');
        await compose(['b@example.test'], 'Two', 'second');
        await compose(['c@example.test'], 'Three', 'third');
        expect(bars().map(b => b.querySelector('.mbx__compose-bar-title')?.textContent?.trim())).toEqual(['One', 'Two']);
        expect(bars().map(b => b.querySelector('.mbx__compose-bar-to')?.textContent?.trim())).toEqual(['a@example.test', 'b@example.test']);
        const right = win()!.getBoundingClientRect().left;
        for (const bar of bars()) {
            expect(bar.getBoundingClientRect().right).withContext('a bar left of the open window').toBeLessThanOrEqual(right);
        }

        // "One" is used again, so "Two" is the one left unused longest.
        bars()[0].click();
        await settle();
        expect(page().composeSubject).toBe('One');
        expect(page().composeText).toBe('first');
        await compose(['d@example.test'], 'Four', 'fourth');

        expect(MAX_COMPOSE_WINDOWS).toBe(3);
        expect(bars().length + 1).toBe(3);
        expect(bars().map(b => b.querySelector('.mbx__compose-bar-title')?.textContent?.trim())).toEqual(['Three', 'One']);
        expect(page().composeSubject).withContext('the one being written in').toBe('Four');
        const kept = [...server.drafts.values()].map(d => d.subject).sort();
        expect(kept).withContext('the closed window\'s draft kept').toEqual(['One', 'Three', 'Two']);
        expect(server.of('create').map(c => c.body!.answers)).withContext('new messages answer nothing').toEqual([null, null, null]);
    });

    it('the one closed is the one left unused longest, never the one being opened', () => {
        const w = (id: number, lastUsed: number): ComposeWindowSnapshot => ({ id, lastUsed } as ComposeWindowSnapshot);
        // Three bars and the one being opened would be four: the bar unused longest closes.
        expect(windowsToClose([w(1, 5), w(2, 1), w(3, 9)]).map(x => x.id)).toEqual([2]);
        // Two bars and the new window are three, the most: nothing closes.
        expect(windowsToClose([w(1, 5), w(2, 1)])).toEqual([]);
    });

    it('From shows only when the mailbox has confirmed aliases, listing its own address and them; the choice is sent', async () => {
        await compose(['ada@example.test'], 'Hi', 'Hello');
        expect(win()!.querySelector('[data-testid="compose-from"]')).withContext('no alias').toBeNull();
        page().sendCompose();
        expect(sent[0].from).withContext('no From sent').toBeUndefined();
        page().closeCompose();

        aliases = { canManage: true, aliases: [
            { id: 'a1', address: 'sales@example.test', status: 'confirmed', requestedAt: '' },
            { id: 'a2', address: 'later@example.test', status: 'pending', requestedAt: '' },
        ] };
        // A mailbox read for the first time reads its aliases.
        (page() as unknown as { confirmedAliases: { set(v: unknown): void } }).confirmedAliases.set({});
        await compose(['ada@example.test'], 'Hi', 'Hello');
        const select = win()!.querySelector<HTMLSelectElement>('[data-testid="compose-from"]')!;
        expect([...select.options].map(o => o.value)).toEqual(['work@example.test', 'sales@example.test']);
        select.value = 'sales@example.test';
        select.dispatchEvent(new Event('change'));
        await settle();
        page().sending.set(false);
        page().sendCompose();
        // The window opened on the draft the first one left, and sends naming it.
        const first = [...server.drafts.keys()][0];
        expect(sent[1]).toEqual({ text: 'Hello', to: ['ada@example.test'], subject: 'Hi', from: 'sales@example.test', draftId: first });
    });

    it('Close closes the window and keeps the draft', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-close"]')!.click();
        await settle();
        expect(win()).toBeNull();
        expect(texts()).toEqual(['Noon?']);
        expect(server.of('delete')).toEqual([]);
    });

    it('Discard with no saved draft just closes: nothing deleted, no notice', async () => {
        await compose([], '', '');
        server.put({ id: 'other', text: 'another' });

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-discard"]')!.click();
        await settle();

        expect(win()).toBeNull();
        expect(shown).toEqual([]);
        expect(server.of('delete')).toEqual([]);
        expect([...server.drafts.keys()]).toEqual(['other']);
    });

    it('Discard of a saved draft deletes it with a 10 second Undo, which makes it again from its last content', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        await wait(700);
        const id = [...server.drafts.keys()][0];
        expect(texts()).toEqual(['Noon?']);

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-discard"]')!.click();
        await settle();
        expect(server.of('delete').map(c => c.id)).toEqual([id]);
        expect(server.drafts.size).toBe(0);
        expect(win()).toBeNull();
        expect(DISCARD_UNDO_MS).toBe(10_000);
        expect(shown.map(t => [t.type, t.message, t.action?.label])).toEqual([['info', 'Draft discarded. (10000 ms)', 'Undo']]);

        shown[0].action!.run();
        await settle();
        expect(server.of('create').length).withContext('made again').toBe(2);
        expect(server.of('create')[1].body).toEqual(jasmine.objectContaining({ to: ['ada@example.test'], subject: 'Lunch', text: 'Noon?', answers: null, quote: false }));
        expect(texts()).toEqual(['Noon?']);
        expect(win()).not.toBeNull();
        expect(page().composeText).toBe('Noon?');
        expect(page().composeSubject).toBe('Lunch');
    });

    it('a Discard while a save is on its way waits for it, then deletes the draft it made', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        server.hold();
        await wait(700);
        expect(server.waiting).withContext('the create is on its way').toBe(1);

        page().discardDraft();
        await settle();
        expect(win()).toBeNull();
        expect(server.of('delete')).withContext('nothing deleted before the save lands').toEqual([]);

        server.release();
        await settle();
        const made = server.of('create');
        expect(made.length).toBe(1);
        expect(server.of('delete').length).withContext('then the draft it made is deleted').toBe(1);
        expect(server.drafts.size).withContext('no draft survives the Discard').toBe(0);
        expect(shown.length).withContext('Undo is offered').toBe(1);
    });

    it('a Discard while a save is only owed: nothing is written, nothing deleted, no Undo', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        expect(server.drafts.size).withContext('the save is still owed').toBe(0);

        page().discardDraft();
        await wait(800);

        expect(server.of('create')).withContext('nothing written after the Discard').toEqual([]);
        expect(shown).toEqual([]);
        expect(removed).toEqual([]);
    });

    it('a save refused with 404 (deleted elsewhere) keeps the window and its text as a new draft, and says so', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        await wait(700);
        const first = [...server.drafts.keys()][0];
        server.drafts.delete(first);

        page().composeText = 'Noon? Or one.';
        page().onComposeChange();
        await wait(700);
        await settle();

        expect(server.of('save').map(c => c.id)).toEqual([first]);
        expect(infos).toEqual([DRAFT_GONE_KEPT]);
        expect(win()).withContext('the window stays').not.toBeNull();
        expect(page().composeText).toBe('Noon? Or one.');
        expect([...server.drafts.values()].map(d => [d.subject, d.text])).toEqual([['Lunch', 'Noon? Or one.']]);

        // The window writes the new draft from now on.
        page().composeText = 'Noon? Or one. Fine.';
        page().onComposeChange();
        await wait(700);
        expect(server.of('save').at(-1)?.id).toBe([...server.drafts.keys()][0]);
    });

    it('a minimized window follows its draft: a newer version is read again, a draft gone closes its bar', async () => {
        await compose(['a@example.test'], 'One', 'first');
        await compose(['b@example.test'], 'Two', 'second');
        await wait(700);
        const [one, two] = [...server.drafts.values()].map(d => d.id);

        server.put({ id: one, text: 'first, edited on the phone' });
        live.next({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: one, version: 2, answers: null });
        await settle();
        expect(server.of('read').map(c => c.id)).toEqual([one]);
        bars()[0].click();
        await settle();
        expect(page().composeText).withContext('the bar restores the newer draft').toBe('first, edited on the phone');

        server.drafts.delete(two);
        live.next({ type: 'mail.drafts.changed', mailboxId: 'mb1', draftId: two, version: null, answers: null });
        await settle();
        expect(bars().length).withContext('the window of a draft gone is closed').toBe(0);
        expect(page().composeText).toBe('first, edited on the phone');
    });
});
