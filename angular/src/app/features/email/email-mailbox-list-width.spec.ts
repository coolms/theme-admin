import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AuthState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
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
import { type EmailMailboxDto, type EmailMessageDto, type EmailMessageList } from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MAIL_PANE_CACHE_KEYS } from './mail-panes.directive';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const FOLDER = 'INBOX';
const LONG = 'A very long line that runs on and on '.repeat(12).trim();

const stored = (id: string, subject: string, extra: Partial<EmailMessageDto> = {}): EmailMessageDto => ({
    id, mailboxId: 'mb1', folder: FOLDER, subject, fromAddress: 'a@example.test', seen: true, flagged: false,
    fromServer: false, ref: null, sentAt: '2026-11-11T09:00:00+00:00', ...extra,
});
const server = (ref: string, subject: string, extra: Record<string, unknown> = {}): EmailMessageDto => ({
    mailboxId: 'mb1', folder: FOLDER, uid: 7, subject, fromAddress: 'b@example.test', seen: false, flagged: false,
    fromServer: true, ref, sentAt: '2026-11-11T08:00:00+00:00', ...extra,
}) as unknown as EmailMessageDto;
const page = (rows: EmailMessageDto[]): EmailMessageList => Object.assign([...rows], { next: null, serverPages: null });

/**
 * A row of the message list is the list's width, however long its sender, subject and snippet: those end in an
 * ellipsis, the star and the date stay in view at the right, and the list never scrolls sideways. A server row lines
 * up with a stored one. Real layout in the browser, at the grid's widths with three panes and with two.
 */
describe('EmailMailboxPageComponent -- the list\'s rows fit the list', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;

    beforeEach(() => {
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
        localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of({ folders: [{ folder: FOLDER, name: 'Inbox', selectable: true, children: [], total: 3, unseen: 1 }], canCreateTop: false, held: false }),
                        listMessages: () => of(page([
                            stored('m-1', LONG, { fromName: LONG, snippet: LONG, flagged: true }),
                            server('r-2', LONG, { fromName: LONG, snippet: LONG }),
                            stored('m-3', 'Short', { snippet: 'Short' }),
                        ])),
                        olderMessages: () => NEVER,
                        listThread: () => of([]),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS), current: () => MAIL_PREFERENCE_DEFAULTS } },
                { provide: ToastService, useValue: { error: (): void => {}, success: (): void => {}, info: (): void => {} } },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                { provide: Store, useValue: { selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' } : null) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                {
                    provide: DateTimeFormatService,
                    useValue: { auto: () => '11 Nov 2026, 09:00', date: () => '', time: () => '', dateTime: () => '' },
                },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: { openFromNodes: (): void => {} } },
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
    });

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const rows = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('.mbx__row'));
    const box = (e: Element): DOMRect => e.getBoundingClientRect();
    /** The ResizeObserver's answer, the virtual viewport's draw after a microtask and a frame, and the redraws. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 20)));
        }
        fixture.detectChanges();
    }
    /** The page in a box this wide (the grid takes its whole width), the folder's rows drawn. */
    async function render(width: number): Promise<void> {
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        el().style.cssText = `display: flex; flex-direction: column; width: ${width}px; height: 700px`;
        document.body.appendChild(el());
        await settle();
        fixture.componentInstance.selectFolder(FOLDER);
        await settle();
    }

    for (const width of [1440, 760]) {
        it(`at ${width}px a row with a very long sender, subject and snippet is the list's width, nothing scrolls sideways`, async () => {
            await render(width);
            const list = part('.mbx__list');
            const region = part('[data-test="list-scroll"]');
            const viewport = part('[data-test="list-rows"]');
            const listBox = box(list);
            expect(rows().length).withContext('the rows are drawn').toBe(3);
            expect(listBox.width).withContext('the list is laid out').toBeGreaterThan(200);

            expect(viewport.scrollWidth).withContext('the rows viewport overflows nothing sideways').toBe(viewport.clientWidth);
            expect(region.scrollWidth).withContext('the list\'s scroll region has no sideways scroll').toBe(region.clientWidth);

            const [long, fromServer] = rows();
            expect(box(long).width).withContext('the row is the list\'s width').toBe(region.clientWidth);
            expect(box(long).right).withContext('the row\'s right edge is within the list').toBeLessThanOrEqual(listBox.right);

            const inside = (e: HTMLElement, what: string): void => {
                const b = box(e);
                expect(b.width).withContext(`${what} has a size`).toBeGreaterThan(0);
                expect(b.left).withContext(`${what}'s left`).toBeGreaterThanOrEqual(listBox.left);
                expect(b.right).withContext(`${what}'s right`).toBeLessThanOrEqual(listBox.right);
            };
            inside(long.querySelector<HTMLElement>('[data-part="star"]')!, 'the star');
            inside(long.querySelector<HTMLElement>('.mbx__row-date')!, 'the date');

            for (const cls of ['.mbx__row-from', '.mbx__row-subject', '.mbx__row-snippet']) {
                const text = long.querySelector<HTMLElement>(cls)!;
                const style = getComputedStyle(text);
                expect(style.textOverflow).withContext(`${cls} ends in an ellipsis`).toBe('ellipsis');
                expect(text.scrollWidth).withContext(`${cls} is clipped`).toBeGreaterThan(text.clientWidth);
                inside(text, cls);
            }

            // The server row's empty room keeps its sender, subject and date in line with the stored row's.
            const at = (r: HTMLElement, cls: string): DOMRect => box(r.querySelector(cls)!);
            expect(box(fromServer).width).withContext('the server row is the list\'s width').toBe(region.clientWidth);
            expect(at(fromServer, '.mbx__row-from').left).toBe(at(long, '.mbx__row-from').left);
            expect(at(fromServer, '.mbx__row-subject').left).toBe(at(long, '.mbx__row-subject').left);
            expect(at(fromServer, '.mbx__row-subject').right).toBe(at(long, '.mbx__row-subject').right);
            expect(at(fromServer, '.mbx__row-date').right).toBe(at(long, '.mbx__row-date').right);
        });
    }
});
