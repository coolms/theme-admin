import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { BehaviorSubject, NEVER, of } from 'rxjs';
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
import type { EmailBulkResultDto, EmailMailboxDto, EmailMessageDetailDto, EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { nextOpenAfter } from './mail-open-next';

/**
 * After Archive or Delete of the open message: side by side, the message that took its place opens (the one above when
 * it was the last), marked read as any message opened; with none left the pane empties. One pane at a time, the list
 * shows. After an action on checked rows that held the open message, the nearest unchecked one opens, below first.
 * The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- the next message after Archive or Delete', () => {
    const MAILBOX = { id: 'mb1', label: 'Work' } as EmailMailboxDto;
    const FIVE: EmailMessageDto[] = ['m1', 'm2', 'm3', 'm4', 'm5'].map(id => ({
        id, folder: 'INBOX', subject: id, canArchive: true, seen: id !== 'm2',
    }));

    let opened: string[];
    let markedRead: string[];
    let backs: number;
    let query: BehaviorSubject<ParamMap>;
    let refuse: Set<string>;
    /** What the server no longer lists in the folder: a read of the list after an action reads it so. */
    let serverGone: Set<string>;
    let serverRead: Set<string>;

    function build(options: { phone?: boolean; listed?: EmailMessageDto[] } = {}): EmailMailboxPageComponent {
        opened = [];
        markedRead = [];
        backs = 0;
        refuse = new Set<string>();
        serverGone = new Set<string>();
        serverRead = new Set<string>();
        query = new BehaviorSubject<ParamMap>(convertToParamMap({}));
        const listed = options.listed ?? FIVE;
        const noop = (): void => undefined;
        const bulk = (ids: readonly string[], outcome: 'moved' | 'archived', folder: string): EmailBulkResultDto => ({
            results: ids.map(id => {
                if (refuse.has(id)) {
                    return { id, outcome: 'refused' as const, folder: 'INBOX', reason: 'failed' };
                }
                serverGone.add(id);
                return { id, outcome, folder };
            }),
        });
        const media = { matches: options.phone === true } as MediaQueryList;
        if (jasmine.isSpy(window.matchMedia)) {
            (window.matchMedia as jasmine.Spy).and.returnValue(media);
        } else {
            spyOn(window, 'matchMedia').and.returnValue(media);
        }
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [], canCreateTop: false, held: false }),
                        listMessages: () => of(listed.filter(m => !serverGone.has(m.id)).map(m => (serverRead.has(m.id) ? { ...m, seen: true } : m))),
                        getMessage: (id: string) => {
                            opened.push(id);
                            return of({ ...listed.find(m => m.id === id)!, bodyText: 'Hello' } as EmailMessageDetailDto);
                        },
                        listThread: () => of([]),
                        markSeen: (id: string) => {
                            markedRead.push(id);
                            serverRead.add(id);
                            return of(null);
                        },
                        archiveMessage: (id: string) => {
                            serverGone.add(id);
                            return of({ id, folder: 'Archive' });
                        },
                        archiveMessages: (ids: readonly string[]) => of(bulk(ids, 'archived', 'Archive')),
                        deleteMessages: (ids: readonly string[]) => of(bulk(ids, 'moved', 'Trash')),
                        moveMessage: (id: string) => {
                            serverGone.add(id);
                            return of(null);
                        },
                    },
                },
                {
                    provide: MailPreferencesService,
                    useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS },
                },
                { provide: ToastService, useValue: { error: noop, success: noop, info: noop, show: () => 1 } },
                {
                    provide: Router,
                    useValue: { events: NEVER, navigate: () => Promise.resolve(true) },
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
                { provide: CrumbNamesService, useValue: { setTail: noop } },
                { provide: MailboxSettingsModal, useValue: {} },
            ],
        });
        const page = TestBed.runInInjectionContext(() => new EmailMailboxPageComponent());
        page.mailboxes.set([MAILBOX]);
        page.selectedMailboxId.set('mb1');
        page.selectedFolder.set('INBOX');
        page.retryMessages();

        return page;
    }

    /** Opens a row by the page's own open, as a click does; what it opened is then forgotten. */
    const open = (page: EmailMailboxPageComponent, id: string): void => {
        page.openMessage(page.messages().find(m => m.id === id)!);
        opened = [];
        markedRead = [];
    };
    const ids = (page: EmailMailboxPageComponent): string[] => page.messages().map(m => m.id);

    describe('side by side', () => {
        it('Archive of the open message opens the one that took its place', () => {
            const page = build();
            open(page, 'm3');

            page.onDetailAction('archive');

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(opened).toEqual(['m4']);
            expect(page.selectedMessage()?.id).toBe('m4');
        });

        it('Delete of the open message, the last in the list, opens the one above', () => {
            const page = build();
            open(page, 'm5');

            page.onDetailAction('delete');

            expect(ids(page)).toEqual(['m1', 'm2', 'm3', 'm4']);
            expect(opened).toEqual(['m4']);
            expect(page.selectedMessage()?.id).toBe('m4');
        });

        it('the message that opens is marked read by the same rule as any message opened', () => {
            const page = build();
            open(page, 'm1');

            page.onDetailAction('delete');

            expect(opened).toEqual(['m2']);
            expect(markedRead).withContext('m2 was unread').toEqual(['m2']);
            expect(page.messages().find(m => m.id === 'm2')?.seen).toBeTrue();

            const read = build();
            open(read, 'm2');
            read.onDetailAction('archive');
            expect(opened).toEqual(['m3']);
            expect(markedRead).withContext('m3 was read already').toEqual([]);
        });

        it('with none left, the message pane is empty', () => {
            const page = build({ listed: [FIVE[0]] });
            open(page, 'm1');

            page.onDetailAction('archive');

            expect(ids(page)).toEqual([]);
            expect(opened).toEqual([]);
            expect(page.selectedMessage()).toBeNull();
            expect(page.loadingDetail()).toBeFalse();
        });

        it('a row other than the open one leaves the open message open', () => {
            const page = build();
            open(page, 'm3');

            page.onMessageAction('delete', ['m1']);

            expect(ids(page)).toEqual(['m2', 'm3', 'm4', 'm5']);
            expect(opened).toEqual([]);
            expect(page.selectedMessage()?.id).toBe('m3');
        });
    });

    describe('checked rows', () => {
        it('when the open message was among them, the nearest unchecked opens, the one below first', () => {
            const page = build();
            open(page, 'm3');
            page.selectedIds.set(new Set(['m2', 'm3', 'm4']));

            page.onBulkAction('archive');

            // m1 and m5 are both two rows away: the one below opens.
            expect(ids(page)).toEqual(['m1', 'm5']);
            expect(opened).toEqual(['m5']);
            expect(page.selectedMessage()?.id).toBe('m5');
        });

        it('with nothing unchecked below, the nearest above opens', () => {
            const page = build();
            open(page, 'm4');
            page.selectedIds.set(new Set(['m3', 'm4', 'm5']));

            page.onBulkAction('delete');

            expect(ids(page)).toEqual(['m1', 'm2']);
            expect(opened).toEqual(['m2']);
        });

        it('a checked row the server refused stays, and is not the one that opens', () => {
            const page = build();
            open(page, 'm3');
            page.selectedIds.set(new Set(['m3', 'm4']));
            refuse.add('m4');

            page.onBulkAction('delete');

            expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            expect(opened).withContext('m4, below, was checked: the nearest unchecked is m2, above').toEqual(['m2']);
        });

        it('with every row checked, the message pane is empty', () => {
            const page = build();
            open(page, 'm2');
            page.selectedIds.set(new Set(FIVE.map(m => m.id)));

            page.onBulkAction('archive');

            expect(ids(page)).toEqual([]);
            expect(opened).toEqual([]);
            expect(page.selectedMessage()).toBeNull();
        });

        it('when the open message was not among them, it stays open', () => {
            const page = build();
            open(page, 'm1');
            page.selectedIds.set(new Set(['m3', 'm4']));

            page.onBulkAction('archive');

            expect(opened).toEqual([]);
            expect(page.selectedMessage()?.id).toBe('m1');
        });
    });

    describe('one pane at a time', () => {
        for (const action of ['archive', 'delete']) {
            it(`${action} of the open message goes back to the list, opening nothing`, () => {
                const page = build({ phone: true });
                open(page, 'm3');
                query.next(convertToParamMap({ pane: 'message' }));

                page.onDetailAction(action);

                expect(opened).toEqual([]);
                expect(page.selectedMessage()).toBeNull();
                expect(backs).withContext("the page's own Back").toBe(1);
                query.next(convertToParamMap({}));
                expect(page.selectedMessage()).toBeNull();
                expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
            });
        }
    });

    it('Move follows the same rule: the open message moved away, the one that took its place opens', () => {
        const page = build();
        open(page, 'm3');

        page.bulkMoveTo('Projects', new Set(['m3']));

        expect(ids(page)).toEqual(['m1', 'm2', 'm4', 'm5']);
        expect(opened).toEqual(['m4']);
        expect(page.selectedMessage()?.id).toBe('m4');
    });

    it('nextOpenAfter: the nearest row neither removed nor acted on, below first; null when none or not listed', () => {
        const order = ['a', 'b', 'c', 'd', 'e'];
        const set = (...xs: string[]) => new Set(xs);
        expect(nextOpenAfter(order, 'c', set('c'), set('c'))).toBe('d');
        expect(nextOpenAfter(order, 'e', set('e'), set('e'))).toBe('d');
        expect(nextOpenAfter(order, 'a', set('a'), set('a'))).toBe('b');
        expect(nextOpenAfter(order, 'c', set('b', 'c', 'd'), set('b', 'c', 'd'))).toBe('e');
        expect(nextOpenAfter(order, 'b', set('b', 'c', 'd'), set('b', 'c', 'd'))).toBe('a');
        expect(nextOpenAfter(order, 'c', set('c'), set('c', 'd'))).toBe('b');
        expect(nextOpenAfter(order, 'c', set(...order), set(...order))).toBeNull();
        expect(nextOpenAfter(order, 'x', set('x'), set('x'))).toBeNull();
        expect(nextOpenAfter(['a'], 'a', set('a'), set('a'))).toBeNull();
    });
});
