import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
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
import { type EmailMailboxDto, type EmailMessageDetailDto, type EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * On a phone the mail page shows one pane at a time. Choosing a folder puts the folders away; Back closes the open
 * message, and a message still loading when Back is pressed does not open when its answer comes. The pane shown is
 * in the address, so the browser's Back closes it too. The page is built directly, not rendered; the address is a
 * query map the test moves, and the navigations the page asks for are recorded.
 */
describe('EmailMailboxPageComponent -- one pane at a time on a phone', () => {
    let details: Subject<EmailMessageDetailDto>;
    let query: BehaviorSubject<ParamMap>;
    let navigations: Array<{ pane: unknown; replaceUrl: boolean }>;
    let backs: number;

    /** The address as the browser would leave it: with this pane named, or none. */
    const address = (pane: string | null) => query.next(convertToParamMap(pane === null ? {} : { pane }));

    /** The page, at a phone's width or not, loaded at an address that may already name a pane (as the router replays it). */
    function build(phone = false, loadedAt: string | null = null): EmailMailboxPageComponent {
        details = new Subject<EmailMessageDetailDto>();
        query = new BehaviorSubject<ParamMap>(convertToParamMap(loadedAt === null ? {} : { pane: loadedAt }));
        navigations = [];
        backs = 0;
        spyOn(window, 'matchMedia').and.returnValue({ matches: phone } as MediaQueryList);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of([]),
                        getMessage: () => details,
                        listThread: () => of([]),
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS },
                },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                {
                    provide: Router,
                    useValue: {
                        events: NEVER,
                        navigate: (_c: unknown[], extras: { queryParams: Record<string, unknown>; replaceUrl: boolean }) => {
                            navigations.push({ pane: extras.queryParams['pane'], replaceUrl: extras.replaceUrl });
                            return Promise.resolve(true);
                        },
                    },
                },
                { provide: ActivatedRoute, useValue: { queryParamMap: query } },
                { provide: Location, useValue: { back: () => { backs += 1; } } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: NaviGraphService, useValue: {} },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });

        return TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
    }

    const message = { id: 'm1', seen: true, folder: 'INBOX' } as EmailMessageDto;
    const detail = { id: 'm1', subject: 'Hello' } as EmailMessageDetailDto;

    it('choosing a folder puts the folders away', () => {
        const page = build();
        page.phoneFolders.set(true);

        page.selectFolder('Archive');

        expect(page.phoneFolders()).toBe(false);
        expect(page.selectedFolder()).toBe('Archive');
    });

    it('Back closes the open message', () => {
        const page = build();
        page.openMessage(message);
        details.next(detail);
        expect(page.selectedMessage()).toEqual(detail);

        page.closeMessage();

        expect(page.selectedMessage()).toBeNull();
        expect(page.loadingDetail()).toBe(false);
    });

    it('a message still loading when Back is pressed does not open when it answers', () => {
        const page = build();
        page.openMessage(message);
        expect(page.loadingDetail()).toBe(true);

        page.closeMessage();
        details.next(detail);

        expect(page.loadingDetail()).toBe(false);
        expect(page.selectedMessage()).toBeNull();
    });

    it('on a phone, the folders and a message are entries in the history; the list to message step from the folders replaces', () => {
        const page = build(true);

        page.showPane('folders');
        address('folders');
        expect(page.phoneFolders()).toBe(true);
        page.openMessage(message);

        expect(navigations).toEqual([{ pane: 'folders', replaceUrl: false }, { pane: 'message', replaceUrl: true }]);
    });

    it("the browser's Back, taking the pane out of the address, closes it", () => {
        const page = build(true);
        page.openMessage(message);
        address('message');
        details.next(detail);
        expect(page.selectedMessage()).toEqual(detail);

        address(null);

        expect(page.selectedMessage()).toBeNull();
    });

    it("the page's own Back steps back through the history when the page added the entry", () => {
        const page = build(true);
        page.showPane('folders');
        address('folders');

        page.leavePane('folders');

        expect(backs).toBe(1);
        expect(navigations.length).toBe(1);
    });

    it('a message pane named on a load with nothing open is dropped from the address', () => {
        build(true);

        address('message');

        expect(navigations).toEqual([{ pane: null, replaceUrl: true }]);
    });

    it('a page loaded at ?pane=message (a reload, a shared link) drops it, and the next message is a history entry', () => {
        const page = build(true, 'message');
        expect(navigations).toEqual([{ pane: null, replaceUrl: true }]);
        address(null);

        page.openMessage(message);

        expect(navigations).toEqual([{ pane: null, replaceUrl: true }, { pane: 'message', replaceUrl: false }]);
    });

    it('at 600px and up, opening and closing a pane never touches the address', () => {
        const page = build(false);

        page.showPane('folders');
        page.openMessage(message);
        page.leavePane('message');

        expect(navigations).toEqual([]);
        expect(backs).toBe(0);
    });
});
