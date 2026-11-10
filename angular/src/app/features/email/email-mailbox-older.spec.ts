import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, Observable, Subject, of } from 'rxjs';
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
import type { EmailMailboxDto, EmailMessageDto, ServerOlderMessagesDto, ServerSearchHitDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { type MailMessagesChangedEvent, readMessagesChanged } from './mail-messages-changed';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const hit = (n: number, extra: Partial<ServerSearchHitDto> = {}): ServerSearchHitDto => ({
    ref: `ref-${n}`, folder: 'Archive', uid: n, from: { name: `Sender ${n}`, address: `s${n}@example.test` },
    subject: `Subject ${n}`, date: '2019-03-04T10:00:00+03:00', sizeBytes: 2048, seen: true, flagged: false,
    local: false, localId: null, ...extra,
});

const refused = (status: number, reason: string, retryAfter?: string): HttpErrorResponse => new HttpErrorResponse({
    status,
    error: { type: `/errors/email/server-search/${reason}` },
    headers: retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
});

/**
 * A folder's mail older than the oldest held here: once the folder's own pages are read, "Load older from the server"
 * reads the server page by page and lists them under the list; a page never repeats a row; a stale cursor starts again
 * from the first page without a word; a rate limit counts down and asks once more. And in the reader: an evicted
 * message stays shown and says so; a deleted one does not. The page is built directly, not rendered.
 */
describe('EmailMailboxPageComponent -- older mail on demand', () => {
    const MAILBOX = { id: 'mb1', label: 'Work', serverSearch: { state: 'supported' } } as EmailMailboxDto;
    const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'Archive' }, { id: 'm2', folder: 'Archive' }];

    let asked: Array<{ folder: string; cursor: string | null }>;
    let replies: Array<Subject<ServerOlderMessagesDto>>;

    function build(): EmailMailboxPageComponent {
        asked = [];
        replies = [];
        const noop = (): void => undefined;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([MAILBOX]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(LISTED),
                        olderMessages: (_id: string, folder: string, cursor: string | null): Observable<ServerOlderMessagesDto> => {
                            asked.push({ folder, cursor });
                            const reply = new Subject<ServerOlderMessagesDto>();
                            replies.push(reply);
                            return reply;
                        },
                        openServerMessage: () => null,
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: noop, success: noop, info: noop } },
                { provide: Router, useValue: { events: NEVER } },
                { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
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
        page.selectedFolder.set('Archive');
        page.retryMessages();

        return page;
    }

    const answer = (hits: ServerSearchHitDto[], next: string | null): ServerOlderMessagesDto => ({ id: 'mb1', folder: 'Archive', hits, next });
    const last = (): Subject<ServerOlderMessagesDto> => replies[replies.length - 1];

    it('the folder\'s own pages read: older mail is asked for on the press only, then page by page by the cursor', () => {
        const page = build();
        expect(page.hasMore()).withContext('the folder\'s own pages are read').toBeFalse();
        expect(asked).withContext('nothing before the press').toEqual([]);

        page.loadOlder();
        expect(asked).toEqual([{ folder: 'Archive', cursor: null }]);
        last().next(answer([hit(1), hit(2)], 'c1'));
        expect(page.olderMessages.hits().map(h => h.ref)).toEqual(['ref-1', 'ref-2']);

        page.loadOlder();
        expect(asked[1]).toEqual({ folder: 'Archive', cursor: 'c1' });
        last().next(answer([hit(2), hit(3)], null));

        expect(page.olderMessages.hits().map(h => h.ref)).withContext('no row twice').toEqual(['ref-1', 'ref-2', 'ref-3']);
        expect(page.olderMessages.next()).toBeNull();
    });

    it('a held row the list already shows is known to the section, which does not show it again', () => {
        const page = build();
        page.loadOlder();
        last().next(answer([hit(1, { local: true, localId: 'm2' }), hit(2)], null));

        expect(page.listedIds().has('m2')).toBeTrue();
    });

    it('a stale cursor starts again from the first page, without a word', () => {
        const page = build();
        page.loadOlder();
        last().next(answer([hit(1)], 'c1'));
        page.olderMessages.more();
        last().error(refused(409, 'stale-cursor'));

        expect(asked.map(a => a.cursor)).toEqual([null, 'c1', null]);
        expect(page.olderMessages.view().kind).toBe('searching');
        last().next(answer([hit(9)], null));
        expect(page.olderMessages.hits().map(h => h.ref)).toEqual(['ref-9']);
    });

    it('rate-limited: counts down, asks once more at zero, then waits for the press', fakeAsync(() => {
        const page = build();
        page.loadOlder();
        last().error(refused(429, 'rate-limited', '3'));
        expect(page.olderMessages.view()).toEqual({ kind: 'rate-limited', seconds: 3, willRetry: true });

        tick(2000);
        expect(page.olderMessages.view()).toEqual({ kind: 'rate-limited', seconds: 1, willRetry: true });
        expect(asked.length).toBe(1);

        tick(1000);
        expect(asked.length).withContext('one more at zero').toBe(2);
        last().error(refused(429, 'rate-limited', '2'));
        tick(5000);
        expect(asked.length).withContext('no second asking on its own').toBe(2);
        expect(page.olderMessages.view()).toEqual({ kind: 'rate-limited', seconds: 0, willRetry: false });
    }));

    it('another folder starts again: the older rows shown are dropped', () => {
        const page = build();
        page.loadOlder();
        last().next(answer([hit(1)], 'c1'));

        page.selectedFolder.set('INBOX');
        page.retryMessages();

        expect(page.olderMessages.view().kind).toBe('idle');
        expect(page.olderMessages.hits()).toEqual([]);
    });

    describe('in the reader', () => {
        const gone = (seq: number, extra: Record<string, unknown>): MailMessagesChangedEvent => readMessagesChanged({
            type: 'mail.messages.changed', mailboxId: 'mb1', origin: 'sync', seq,
            changes: [{ id: 'm2', folder: 'Archive', gone: true, ...extra }], counts: {}, mailboxUnseen: 0,
        }) as MailMessagesChangedEvent;
        const apply = (page: EmailMailboxPageComponent, evt: MailMessagesChangedEvent): void =>
            (page as unknown as { onMessagesChanged(e: MailMessagesChangedEvent): void }).onMessagesChanged(evt);

        it('evicted: the message stays open and says it is no longer kept here; its row leaves the list', () => {
            const page = build();
            page.selectedMessage.set({ id: 'm2', folder: 'Archive', subject: 'Old invoice' } as never);

            apply(page, gone(10, { reason: 'evicted' }));

            expect(page.selectedMessage()?.id).toBe('m2');
            expect(page.openEvicted()).toBeTrue();
            expect(page.messages().map(m => m.id)).toEqual(['m1']);
        });

        it('deleted: its row leaves the list, and the reader says nothing new', () => {
            const page = build();
            page.selectedMessage.set({ id: 'm2', folder: 'Archive', subject: 'Old invoice' } as never);

            apply(page, gone(10, {}));

            expect(page.openEvicted()).toBeFalse();
            expect(page.messages().map(m => m.id)).toEqual(['m1']);
        });
    });
});
