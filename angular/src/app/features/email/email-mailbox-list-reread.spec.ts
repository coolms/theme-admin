import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, Subject, of } from 'rxjs';
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
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import { type EmailMailboxDto, type EmailMessageDto } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const LISTED: EmailMessageDto[] = [
    { id: 'm1', folder: 'INBOX', subject: 'Desk move on Friday' },
    { id: 'm2', folder: 'INBOX', subject: 'Statement for October' },
];

/**
 * A list read again: the first read of a folder says Loading; a read of the same list again keeps its rows and shows
 * a thin bar over their top until the answer, whether it comes or fails; another folder's first read shows no bar.
 */
describe('EmailMailboxPageComponent -- a list read again keeps its rows', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let answers: Subject<EmailMessageDto[]>[];

    beforeEach(() => {
        answers = [];
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: (): Observable<EmailMessageDto[]> => {
                            const answer = new Subject<EmailMessageDto[]>();
                            answers.push(answer);
                            return answer;
                        },
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
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
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const scroll = (): HTMLElement => el().querySelector<HTMLElement>('[data-test="list-scroll"]')!;
    const bar = (): HTMLElement | null => scroll().querySelector<HTMLElement>('[data-test="list-progress"]');
    const rows = (): number => scroll().querySelectorAll('.mbx__row').length;
    const loadingLine = (): boolean => Array.from(scroll().querySelectorAll('.mbx__note')).some(n => n.textContent?.trim() === 'Loading…');
    const last = (): Subject<EmailMessageDto[]> => answers[answers.length - 1];

    /** The mailbox's first folder read, answered with its two rows. */
    function firstRead(): void {
        expect(answers.length).withContext('the page asked for the folder').toBeGreaterThan(0);
        fixture.detectChanges();
        expect(loadingLine()).withContext('the first read says Loading').toBeTrue();
        expect(bar()).withContext('and shows no bar: there are no rows to keep').toBeNull();
        last().next(LISTED);
        fixture.detectChanges();
        expect(rows()).toBe(2);
    }

    it('keeps the rows under a thin bar while the same list is read again, and drops the bar on its answer', () => {
        firstRead();

        fixture.componentInstance.retryMessages();
        fixture.detectChanges();

        expect(rows()).withContext('the rows stay while the list is read again').toBe(2);
        expect(loadingLine()).withContext('no Loading line in place of them').toBeFalse();
        expect(bar()).withContext('the thin bar shows').not.toBeNull();
        expect(scroll().firstElementChild).withContext('at the top of the list').toBe(bar());
        expect(bar()!.getAttribute('role')).toBe('progressbar');
        expect(bar()!.getBoundingClientRect().height).withContext('thin').toBeLessThanOrEqual(3);

        last().next([...LISTED, { id: 'm3', folder: 'INBOX', subject: 'Lunch' }]);
        fixture.detectChanges();

        expect(bar()).withContext('the answer takes the bar away').toBeNull();
        expect(rows()).toBe(3);
    });

    it('drops the bar when the read again fails', () => {
        firstRead();

        fixture.componentInstance.retryMessages();
        fixture.detectChanges();
        expect(bar()).not.toBeNull();

        last().error(new Error('gone'));
        fixture.detectChanges();

        expect(bar()).toBeNull();
    });

    it('shows no bar for another folder\'s first read', () => {
        firstRead();

        fixture.componentInstance.selectFolder('Archive');
        fixture.detectChanges();

        expect(fixture.componentInstance.loadingMessages()).toBeTrue();
        expect(bar()).withContext('another list is not this one read again').toBeNull();
    });
});
