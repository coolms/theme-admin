import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
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
import { type EmailMailboxDto, type EmailMessageList } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, type MailPreferences, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const KEY = 'coolms.email.lastMailboxId';
const MAILBOXES = [{ id: 'mb1', label: 'Work' }, { id: 'mb2', label: 'Home' }, { id: 'mb3', label: 'Shop' }] as EmailMailboxDto[];

/**
 * The mailbox the page opens on and keeps as the last one: the person's mail settings hold it. The browser's old key
 * is read once, where the settings hold none, moved to them and removed; settings that could not be read leave it.
 */
describe('EmailMailboxPageComponent -- the last mailbox, in the person\'s mail settings', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let settings: MailPreferences;
    let remember: jasmine.Spy;
    const page = (): EmailMailboxPageComponent => fixture.componentInstance;
    const settle = async (): Promise<void> => {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await new Promise(r => setTimeout(r, 20));
        }
        fixture.detectChanges();
    };
    async function render(): Promise<void> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        (fixture.nativeElement as HTMLElement).style.cssText = 'display: flex; flex-direction: column; width: 1440px; height: 700px';
        document.body.appendChild(fixture.nativeElement as HTMLElement);
        await settle();
    }

    beforeEach(() => {
        localStorage.removeItem(KEY);
        settings = { ...MAIL_PREFERENCE_DEFAULTS };
        remember = jasmine.createSpy('rememberLastMailbox');
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of(MAILBOXES),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: (): unknown => of(Object.assign([], { next: null, serverPages: null }) as EmailMessageList),
                        olderMessages: () => NEVER,
                        listThread: () => of([]),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(settings), current: () => settings, rememberLastMailbox: remember },
                },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' }
                            : sel === AppConfigState.manifest ? { navi: { graphBySlug: '/api/v1/navi/trees/{slug}/graph' } } : null),
                    },
                },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {}, menu: () => null, close: (): void => {} } },
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
        localStorage.removeItem(KEY);
    });

    it('opens on the last mailbox the settings hold, before the browser\'s old key, which is removed; nothing is saved', async () => {
        settings = { ...MAIL_PREFERENCE_DEFAULTS, lastMailboxId: 'mb2' };
        localStorage.setItem(KEY, 'mb3');
        await render();
        expect(page().selectedMailboxId()).toBe('mb2');
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(remember).not.toHaveBeenCalled();
    });

    it('with none in the settings, the browser\'s old key is used once: saved to the settings and removed', async () => {
        localStorage.setItem(KEY, 'mb3');
        await render();
        expect(page().selectedMailboxId()).toBe('mb3');
        expect(remember).toHaveBeenCalledOnceWith('mb3');
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('a browser key naming a mailbox not in the list: the first mailbox, nothing saved, the key removed, no error', async () => {
        localStorage.setItem(KEY, 'mb-gone');
        await render();
        expect(page().selectedMailboxId()).toBe('mb1');
        expect(remember).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('a last mailbox the settings read back as none (gone, or no longer readable): the first, nothing saved', async () => {
        settings = { ...MAIL_PREFERENCE_DEFAULTS };
        await render();
        expect(page().selectedMailboxId()).toBe('mb1');
        expect(remember).not.toHaveBeenCalled();
    });

    it('a last mailbox the list no longer has: the first, as ever', async () => {
        settings = { ...MAIL_PREFERENCE_DEFAULTS, lastMailboxId: 'mb-gone' };
        await render();
        expect(page().selectedMailboxId()).toBe('mb1');
    });

    it('settings that could not be read: the browser\'s key opens the page and stays; nothing is saved', async () => {
        settings = MAIL_PREFERENCE_DEFAULTS;
        localStorage.setItem(KEY, 'mb2');
        await render();
        expect(page().selectedMailboxId()).toBe('mb2');
        expect(localStorage.getItem(KEY)).toBe('mb2');
        expect(remember).not.toHaveBeenCalled();
    });

    it('a mailbox picked is saved to the settings, never to the browser; the one open is not saved again', async () => {
        settings = { ...MAIL_PREFERENCE_DEFAULTS, lastMailboxId: 'mb1' };
        await render();
        page().pickMailbox('mb2');
        expect(remember).toHaveBeenCalledOnceWith('mb2');
        expect(localStorage.getItem(KEY)).toBeNull();
        page().pickMailbox('mb2');
        expect(remember).toHaveBeenCalledTimes(1);
    });
});
