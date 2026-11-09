import { TestBed, fakeAsync, tick } from '@angular/core/testing';
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
import type { EmailMailboxDto, ServerSearchAnswerDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/**
 * The mail page's search box: the stored messages and the open mailbox's server are searched once typing pauses for
 * 600 ms or at Enter, never per key; the other mailboxes' servers only when their row is pressed. The page is built
 * directly, not rendered.
 */
describe('EmailMailboxPageComponent -- hybrid search', () => {
    const MAILBOXES: EmailMailboxDto[] = [
        { id: 'mb1', label: 'Work', serverSearch: { state: 'supported' } },
        { id: 'mb2', label: 'Home', serverSearch: { state: 'unknown' } },
        { id: 'mb3', label: 'Old', serverSearch: { state: 'supported' } },
    ];

    let serverAsked: Array<{ mailboxId: string; q: string }>;
    let serverReplies: Map<string, Subject<ServerSearchAnswerDto>>;
    let localAsked: string[];

    function build(): EmailMailboxPageComponent {
        serverAsked = [];
        serverReplies = new Map();
        localAsked = [];
        const noop = (): void => undefined;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of(MAILBOXES),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of([]),
                        searchMessages: (query: { q: string }) => {
                            localAsked.push(query.q);
                            return of([]);
                        },
                        serverSearch: (mailboxId: string, q: string): Observable<ServerSearchAnswerDto> => {
                            serverAsked.push({ mailboxId, q });
                            const reply = new Subject<ServerSearchAnswerDto>();
                            serverReplies.set(mailboxId, reply);
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
        page.mailboxes.set(MAILBOXES);
        page.selectedMailboxId.set('mb1');

        return page;
    }

    /** Types into the box as the template's two-way binding does. */
    const type = (page: EmailMailboxPageComponent, text: string): void => {
        page.searchQuery = text;
        page.onSearchTyped(text);
    };

    it('no server search while typing; one 600 ms after typing pauses; the stored messages with it', fakeAsync(() => {
        const page = build();
        for (const text of ['i', 'in', 'inv', 'invo', 'invoice']) {
            type(page, text);
            tick(200);
        }
        expect(serverAsked).withContext('nothing per key').toEqual([]);

        tick(399);
        expect(serverAsked).withContext('599 ms after the last key').toEqual([]);

        tick(1);
        expect(serverAsked).withContext('one, for the open mailbox').toEqual([{ mailboxId: 'mb1', q: 'invoice' }]);
        expect(localAsked).toEqual(['invoice']);

        tick(3000);
        expect(serverAsked.length).withContext('one search for one pause').toBe(1);
        page.clearSearch();
    }));

    it('Enter searches at once, and the pause it ended asks nothing more', fakeAsync(() => {
        const page = build();
        type(page, 'report');
        tick(100);
        page.onSearchEnter();

        expect(serverAsked).withContext('Enter does not wait').toEqual([{ mailboxId: 'mb1', q: 'report' }]);

        tick(2000);
        expect(serverAsked.length).toBe(1);
        page.clearSearch();
    }));

    it('a pause on the query already shown asks nothing; Enter on it asks again', fakeAsync(() => {
        const page = build();
        type(page, 'report');
        tick(600);
        type(page, 'report ');
        tick(600);
        expect(serverAsked.length).withContext('the same trimmed query, after a pause').toBe(1);

        page.onSearchEnter();
        expect(serverAsked.length).withContext('Enter is asked for').toBe(2);
        page.clearSearch();
    }));

    it('what was typed before the first mailbox opened is kept and searched; switching mailboxes ends it', fakeAsync(() => {
        const page = build();
        page.selectedMailboxId.set(null);
        type(page, 'invoice');
        tick(600);
        expect(serverAsked).withContext('no mailbox open yet').toEqual([]);

        page.selectMailbox('mb1');

        expect(page.searchQuery).withContext('the first open keeps the box').toBe('invoice');
        expect(page.searchActive()).toBeTrue();
        expect(serverAsked).withContext('and searches the mailbox it opened').toEqual([{ mailboxId: 'mb1', q: 'invoice' }]);
        expect(localAsked).toEqual(['invoice']);

        page.selectMailbox('mb1');
        expect(page.searchQuery).withContext('the same mailbox again is no switch').toBe('invoice');

        page.selectMailbox('mb2');
        expect(page.searchQuery).withContext('a switch clears the box').toBe('');
        expect(page.searchActive()).toBeFalse();
        tick(3000);
        expect(serverAsked.length).withContext('nothing more asked').toBe(1);
    }));

    it('a pause still pending when the first mailbox opens asks nothing twice', fakeAsync(() => {
        const page = build();
        page.selectedMailboxId.set(null);
        type(page, 'invoice');
        tick(100);
        page.selectMailbox('mb1');
        tick(1000);

        expect(serverAsked).toEqual([{ mailboxId: 'mb1', q: 'invoice' }]);
        page.clearSearch();
    }));

    it('the other mailboxes are searched only on the press, one after another', fakeAsync(() => {
        const page = build();
        type(page, 'report');
        tick(600);
        serverReplies.get('mb1')?.next({ q: 'report', state: 'supported', hits: [], next: null, capped: false });
        tick(5000);
        expect(serverAsked.map(a => a.mailboxId)).withContext('the open mailbox only, until pressed').toEqual(['mb1']);

        page.searchOtherMailboxes();
        expect(serverAsked.map(a => a.mailboxId)).withContext('the first other mailbox').toEqual(['mb1', 'mb2']);
        expect(page.otherServerSearches.sections().map(s => s.title)).toEqual(['Home', 'Old']);

        serverReplies.get('mb2')?.next({ q: 'report', state: 'supported', hits: [], next: null, capped: false });
        expect(serverAsked.map(a => a.mailboxId)).withContext('the next once the first answered').toEqual(['mb1', 'mb2', 'mb3']);
        expect(serverAsked.every(a => a.q === 'report')).toBeTrue();

        type(page, 'other');
        tick(600);
        expect(page.otherServerSearches.sections()).withContext('a new query drops them until pressed again').toEqual([]);
        page.clearSearch();
    }));
});
