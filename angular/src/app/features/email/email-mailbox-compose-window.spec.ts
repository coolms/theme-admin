import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of } from 'rxjs';
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
import { DISCARD_UNDO_MS, MAIL_EDITOR_PROFILE, MAX_COMPOSE_WINDOWS, windowsToClose, type ComposeWindowSnapshot } from './compose-windows';
import { EmailLiveEventsService } from './email-live-events.service';
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
 * with a 10 second Undo once a draft was saved. Rendered and laid out at 1400 x 800, fixed at the window's top left.
 */
describe('EmailMailboxPageComponent -- the compose window', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let sent: OutgoingEmailRequest[];
    let shown: Shown[];
    let drafts: Map<string, unknown>;
    let aliases: MailAliasesDto;
    let removed: string[];

    beforeEach(() => {
        sent = [];
        shown = [];
        removed = [];
        // This test's own store: the mock below closes over it, so a save still pending from an earlier test's
        // page writes into that page's store, never into this one.
        const store = new Map<string, unknown>();
        drafts = store;
        aliases = { canManage: false, aliases: [] };
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work', emailAddress: 'work@example.test' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
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
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: {
                        error: (): void => {}, success: (): void => {}, info: (): void => {},
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
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                {
                    provide: DraftStoreService,
                    useValue: {
                        load: (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null),
                        save: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
                        clear: (key: string) => void store.delete(key),
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

    it('Minimize leaves a bar with the subject and the recipients; a click on it restores the window', async () => {
        await compose(['ada@example.test', 'lin@example.test'], 'Lunch', 'Noon?');

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-minimize"]')!.click();
        await settle();
        expect(win()!.querySelector('.mbx__compose-body')).toBeTruthy();
        expect(getComputedStyle(win()!.querySelector('.mbx__compose-body')!).display).toBe('none');
        expect(win()!.querySelector('.mbx__compose-title-text')?.textContent?.trim()).toBe('Lunch');
        expect(win()!.querySelector('[data-testid="compose-recipients"]')?.textContent?.trim()).toBe('ada@example.test, lin@example.test');

        const subject = win()!.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!;
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
        expect((drafts.get('email.mb1.compose') as ComposeDraft).text).withContext('the draft kept').toBe('Noon?');
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
        const kept = [...drafts.values()].map(d => (d as ComposeDraft).subject).sort();
        expect(kept).withContext('the closed window\'s draft kept').toEqual(['One', 'Three', 'Two']);
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
        expect(sent[1]).toEqual({ text: 'Hello', to: ['ada@example.test'], subject: 'Hi', from: 'sales@example.test' });
    });

    it('Close closes the window and keeps the draft', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-close"]')!.click();
        await settle();
        expect(win()).toBeNull();
        expect((drafts.get('email.mb1.compose') as ComposeDraft).text).toBe('Noon?');
    });

    it('Discard with no saved draft just closes: nothing deleted, no notice', async () => {
        await compose([], '', '');
        drafts.set('email.mb1.compose.1', { text: 'another' });

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-discard"]')!.click();
        await settle();

        expect(win()).toBeNull();
        expect(shown).toEqual([]);
        expect([...drafts.keys()]).toEqual(['email.mb1.compose.1']);
    });

    it('Discard of a saved draft deletes it with a 10 second Undo, which brings it back in its window', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        await wait(700);
        expect(drafts.has('email.mb1.compose')).toBeTrue();

        win()!.querySelector<HTMLButtonElement>('[data-testid="compose-discard"]')!.click();
        await settle();
        expect(drafts.has('email.mb1.compose')).toBeFalse();
        expect(win()).toBeNull();
        expect(DISCARD_UNDO_MS).toBe(10_000);
        expect(shown.map(t => [t.type, t.message, t.action?.label])).toEqual([['info', 'Draft discarded. (10000 ms)', 'Undo']]);

        shown[0].action!.run();
        await settle();
        expect((drafts.get('email.mb1.compose') as ComposeDraft).text).toBe('Noon?');
        expect(win()).not.toBeNull();
        expect(page().composeText).toBe('Noon?');
        expect(page().composeSubject).toBe('Lunch');
    });

    it('a Discard while a save is still owed: the save is made, then deleted; no draft comes back after it', async () => {
        await compose(['ada@example.test'], 'Lunch', 'Noon?');
        expect(drafts.size).withContext('the save is still owed').toBe(0);

        page().discardDraft();
        expect(shown.length).withContext('it was a saved draft, so Undo is offered').toBe(1);
        await wait(800);

        expect(drafts.size).withContext('nothing written after the Discard').toBe(0);
        expect(removed).toEqual([]);
    });
});
