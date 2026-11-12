import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, type WritableSignal, computed, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { ConfirmDialogService, ContextMenuService, DrawerService, ToastService } from '@coolms/ui-angular';

import { notificationActionTarget } from './notification-action';
import { NotificationApiService, type NotificationAction, type NotificationDto } from './notification-api.service';
import { NotificationDrawerContentComponent } from './notification-drawer-content.component';
import { NotificationPollingService } from './notification-polling.service';
import { NotificationSoundService } from './notification-sound.service';
import { NotificationStore } from './notification-store.service';

const MAILBOX_ID = '0193a1f2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const CONVERSATION_ID = '0193a1f2-0000-7000-8000-000000000001';

function reconnect(params: Record<string, string> = { mailboxId: MAILBOX_ID, section: 'reconnect' }): NotificationAction {
    return { label: 'reconnect', labelText: 'Reconnect', destination: { name: 'email.mailbox.settings', params } };
}

function row(overrides: Partial<NotificationDto> = {}): NotificationDto {
    return {
        id: 'n-1',
        type: 'email.mailbox.stopped',
        extras: { title: 'Support stopped fetching mail', body: 'The server refused the sign-in.' },
        authorUserId: null,
        createdAt: '2026-11-11T09:00:00+00:00',
        expiresAt: null,
        readAt: null,
        dismissedAt: null,
        isRead: false,
        link: null,
        ...overrides,
    };
}

/**
 * A notification's action, as the drawer shows it: a known destination with its required params is a real button
 * under the text, labelled in the admin's words (the server's labelText for a code it does not know), and pressing it
 * marks the row read and opens that mailbox's settings at the section. Anything else shows no button. The body stays
 * plain text and is never a link; the chevron only expands. The toolbar and the row's interaction directive are left
 * out of the rendering; the rest of the row is rendered as shipped.
 */
describe('NotificationDrawerContentComponent -- a notification\'s action', () => {
    describe('where an action goes', () => {
        it('email.mailbox.settings opens the mailbox at the section\'s pane, the first pane without one', () => {
            expect(notificationActionTarget(reconnect())).toEqual({
                label: 'Reconnect', presentation: 'button', commands: ['/email', { mailbox: MAILBOX_ID }], queryParams: { settings: 'connection' },
            });
            expect(notificationActionTarget({
                label: 'manage-access', labelText: 'Manage access',
                destination: { name: 'email.mailbox.settings', params: { mailboxId: MAILBOX_ID, section: 'delegations' } },
            })).toEqual({ label: 'Manage access', presentation: 'button', commands: ['/email', { mailbox: MAILBOX_ID }], queryParams: { settings: 'access' } });
            expect(notificationActionTarget(reconnect({ mailboxId: MAILBOX_ID }))?.queryParams).toEqual({ settings: 'general' });
        });

        it('a label code the admin has no words for shows the server\'s labelText', () => {
            const action = { ...reconnect(), label: 'check-storage', labelText: 'Check storage' };
            expect(notificationActionTarget(action)?.label).toBe('Check storage');
        });

        it('no action, an unknown destination or a missing mailboxId: no target', () => {
            expect(notificationActionTarget(null)).toBeNull();
            expect(notificationActionTarget(undefined)).toBeNull();
            expect(notificationActionTarget({ ...reconnect(), destination: { name: 'calendar.event', params: { mailboxId: MAILBOX_ID } } })).toBeNull();
            expect(notificationActionTarget(reconnect({ section: 'reconnect' }))).toBeNull();
            expect(notificationActionTarget(reconnect({ mailboxId: '', section: 'reconnect' }))).toBeNull();
        });
    });

    describe('in the drawer', () => {
        let fixture: ComponentFixture<NotificationDrawerContentComponent>;
        let rows: WritableSignal<NotificationDto[]>;
        let expandedId: WritableSignal<string | null>;
        let markRead: jasmine.Spy;
        let navigate: jasmine.Spy;
        let navigateByUrl: jasmine.Spy;
        let close: jasmine.Spy;

        function render(list: NotificationDto[]): HTMLElement {
            rows = signal(list);
            expandedId = signal<string | null>(null);
            // As the server answers: the row itself, read.
            markRead = jasmine.createSpy('markRead').and.callFake((id: string) =>
                of({ ...(rows().find(r => r.id === id) ?? row()), id, isRead: true, readAt: '2026-11-12T10:00:00+00:00' }));
            navigate = jasmine.createSpy('navigate').and.resolveTo(true);
            navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);
            close = jasmine.createSpy('close');
            const store = {
                notifications: rows.asReadonly(),
                selectedIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
                flashingIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
                selectedItems: computed(() => [] as NotificationDto[]),
                rangeAnchor: computed(() => null),
                expandedId: expandedId.asReadonly(),
                loadingMore: signal(false).asReadonly(),
                hasMore: signal(false).asReadonly(),
                selectionCount: computed(() => 0),
                hasUnread: computed(() => true),
                hasUnreadInSelection: computed(() => false),
                hasReadInSelection: computed(() => false),
                focusedItem: computed(() => null),
                toolbarNodes: signal([]),
                actionDispatched$: new Subject<string>(),
                toggleExpanded: (id: string) => expandedId.set(expandedId() === id ? null : id),
                setExpanded: (id: string) => expandedId.set(id),
                updateOne: (updated: NotificationDto) => rows.set(rows().map(r => (r.id === updated.id ? updated : r))),
                loadMore: () => {},
            };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                imports: [NotificationDrawerContentComponent],
                providers: [
                    { provide: NotificationStore, useValue: store },
                    { provide: NotificationSoundService, useValue: { enabled: signal(true), toggle: () => {} } },
                    { provide: NotificationApiService, useValue: { markRead } },
                    { provide: NotificationPollingService, useValue: { fetchNow: () => {} } },
                    { provide: ContextMenuService, useValue: {} },
                    { provide: ConfirmDialogService, useValue: {} },
                    { provide: ToastService, useValue: {} },
                    { provide: DrawerService, useValue: { close } },
                    { provide: Router, useValue: { navigate, navigateByUrl } },
                ],
            });
            TestBed.overrideComponent(NotificationDrawerContentComponent, {
                set: { imports: [DatePipe], schemas: [NO_ERRORS_SCHEMA] },
            });
            fixture = TestBed.createComponent(NotificationDrawerContentComponent);
            fixture.detectChanges();
            return fixture.nativeElement as HTMLElement;
        }

        const actionButton = (host: HTMLElement): HTMLButtonElement | null =>
            host.querySelector<HTMLButtonElement>('[data-test=notification-action]');
        const openLinkButton = (host: HTMLElement): HTMLButtonElement | null =>
            host.querySelector<HTMLButtonElement>('[data-test=notification-open-link]');
        /** The action button's classes, which the Open button shares. */
        const actionButtonClass = 'cms-btn cms-btn-sm';

        it('a known action is a button under the text, named by its label; pressing it reads the row and opens the settings', () => {
            const host = render([row({ action: reconnect() })]);
            const button = actionButton(host);

            expect(button).withContext('the button is drawn').not.toBeNull();
            expect(button?.tagName).toBe('BUTTON');
            expect(button?.type).toBe('button');
            expect(button?.className).toBe(actionButtonClass);
            expect(button?.textContent?.trim()).toBe('Reconnect');
            expect(button?.hasAttribute('aria-label')).withContext('named by its visible label').toBeFalse();
            const primary = host.querySelector('.cms-notification-row__primary') as HTMLElement;
            expect(primary.compareDocumentPosition(button as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
                .withContext('after the text').toBeTruthy();

            button?.click();

            expect(markRead).toHaveBeenCalledOnceWith('n-1');
            expect(navigate).toHaveBeenCalledOnceWith(['/email', { mailbox: MAILBOX_ID }], { queryParams: { settings: 'connection' } });
            expect(close).toHaveBeenCalledTimes(1);
            expect(navigateByUrl).not.toHaveBeenCalled();
        });

        it('in tab order the button comes after the text: after the expanded body', () => {
            const host = render([row({ action: reconnect() })]);
            expandedId.set('n-1');
            fixture.detectChanges();

            const body = host.querySelector('.cms-notification-row__body') as HTMLElement;
            const button = actionButton(host) as HTMLButtonElement;
            expect(body.textContent).toBe('The server refused the sign-in.');
            expect(body.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            const focusable = Array.from(host.querySelectorAll('button, a[href], [tabindex]'));
            expect(focusable[focusable.length - 1]).withContext('the last stop in the row').toBe(button);
        });

        it('a row already read is not marked read again', () => {
            const host = render([row({ action: reconnect(), isRead: true, readAt: '2026-11-11T09:05:00+00:00' })]);

            actionButton(host)?.click();

            expect(markRead).not.toHaveBeenCalled();
            expect(navigate).toHaveBeenCalledTimes(1);
        });

        it('the server\'s labelText for a code the admin has no words for', () => {
            const host = render([row({ action: { ...reconnect(), label: 'check-storage', labelText: 'Check storage' } })]);
            expect(actionButton(host)?.textContent?.trim()).toBe('Check storage');
        });

        for (const [name, action] of [
            ['no action', null],
            ['no action field at all', undefined],
            ['a destination the admin does not know', { ...reconnect(), destination: { name: 'calendar.event', params: { mailboxId: MAILBOX_ID } } }],
            ['a missing mailboxId', reconnect({ section: 'reconnect' })],
        ] as Array<[string, NotificationAction | null | undefined]>) {
            it(`${name}: no button, and the row otherwise the same`, () => {
                const host = render([row(undefined === action ? {} : { action })]);

                expect(actionButton(host)).toBeNull();
                expect(host.querySelector('.cms-notification-row .fw-semibold')?.textContent?.trim()).toBe('Support stopped fetching mail');
                expect(host.querySelector('.cms-notification-row button[aria-label="Expand"]')).withContext('the chevron').not.toBeNull();
            });
        }

        it('the body is plain text and never a link: markup shows as its source, a click on it goes nowhere', () => {
            const source = '**Reconnect** at [settings](/email)';
            const host = render([row({
                extras: { title: 'Support stopped', body: source, bodyFormat: 'markdown' },
                link: { kind: 'route', href: '/email', target: null },
            })]);
            expandedId.set('n-1');
            fixture.detectChanges();

            const body = host.querySelector('.cms-notification-row__body') as HTMLElement;
            expect(body.textContent).toBe(source);
            expect(body.querySelector('a, strong')).toBeNull();
            body.click();
            expect(navigateByUrl).not.toHaveBeenCalled();
            expect(navigate).not.toHaveBeenCalled();
            expect(markRead).not.toHaveBeenCalled();
        });

        it('the chevron only expands and collapses; a row with a link and no body has no chevron', () => {
            const host = render([
                row({ link: { kind: 'route', href: '/email', target: null } }),
                row({ id: 'n-2', extras: { title: 'A link only' }, link: { kind: 'route', href: '/email', target: null } }),
            ]);
            const rowsDrawn = host.querySelectorAll('.cms-notification-row');
            const chevron = rowsDrawn[0].querySelector('button[aria-label="Expand"]') as HTMLButtonElement;

            chevron.click();
            fixture.detectChanges();
            expect(expandedId()).toBe('n-1');
            expect(rowsDrawn[0].querySelector('button[aria-label="Collapse"]')).not.toBeNull();
            (rowsDrawn[0].querySelector('button[aria-label="Collapse"]') as HTMLButtonElement).click();
            expect(expandedId()).toBeNull();
            expect(navigateByUrl).not.toHaveBeenCalled();
            expect(rowsDrawn[1].querySelector('button[aria-label="Expand"], button[aria-label="Open"]')).toBeNull();
        });

        it('a row with both a link and an action: the action is the button, and opening the row follows no link', () => {
            const both = row({ extras: { title: 'Support stopped' }, link: { kind: 'route', href: '/elsewhere', target: null }, action: reconnect() });
            const host = render([both]);

            expect(actionButton(host)?.textContent?.trim()).toBe('Reconnect');
            expect(openLinkButton(host)).withContext('only the action\'s button').toBeNull();
            expect(host.querySelectorAll('.cms-notification-row__action button').length).toBe(1);
            (fixture.componentInstance as unknown as { onActivate(n: NotificationDto): void }).onActivate(both);
            expect(navigateByUrl).not.toHaveBeenCalled();

            actionButton(host)?.click();
            expect(navigate).toHaveBeenCalledOnceWith(['/email', { mailbox: MAILBOX_ID }], { queryParams: { settings: 'connection' } });
        });

        it('pressing a row with a link and no action reads it and goes nowhere: the link opens from its Open button only', () => {
            const linked = row({ extras: { title: 'A link only' }, link: { kind: 'route', href: '/content', target: null } });
            render([linked]);

            (fixture.componentInstance as unknown as { onActivate(n: NotificationDto): void }).onActivate(linked);

            expect(markRead).toHaveBeenCalledOnceWith('n-1');
            expect(navigateByUrl).not.toHaveBeenCalled();
            expect(navigate).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        });

        it('pressing a row with no action and no link reads it and goes nowhere', () => {
            const plain = row({ extras: { title: 'Backup finished' } });
            render([plain]);

            (fixture.componentInstance as unknown as { onActivate(n: NotificationDto): void }).onActivate(plain);

            expect(markRead).toHaveBeenCalledOnceWith('n-1');
            expect(navigateByUrl).not.toHaveBeenCalled();
            expect(navigate).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        });

        it('expanding a row with the chevron reads it, and navigates nowhere', () => {
            const host = render([row({ link: { kind: 'route', href: '/content', target: null } })]);

            (host.querySelector('button[aria-label="Expand"]') as HTMLButtonElement).click();

            expect(markRead).toHaveBeenCalledOnceWith('n-1');
            expect(navigateByUrl).not.toHaveBeenCalled();
            expect(navigate).not.toHaveBeenCalled();
        });

        it('a row with a link and no action shows an Open button under the text, which reads the row and goes to the link', () => {
            const host = render([row({ type: 'document.generated', extras: { title: 'Report ready' }, link: { kind: 'route', href: '/content/report', target: null } })]);
            const open = openLinkButton(host) as HTMLButtonElement;

            expect(open).withContext('the Open button').not.toBeNull();
            expect(open.tagName).toBe('BUTTON');
            expect(open.type).toBe('button');
            expect(open.textContent?.trim()).toBe('Open');
            expect(open.className).withContext('the action button\'s look').toBe(actionButtonClass);
            expect(open.closest('.cms-notification-row__action')).not.toBeNull();
            const primary = host.querySelector('.cms-notification-row__primary') as HTMLElement;
            expect(primary.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).withContext('under the text').toBeTruthy();

            open.click();

            expect(markRead).toHaveBeenCalledOnceWith('n-1');
            expect(navigateByUrl).toHaveBeenCalledOnceWith('/content/report');
            expect(close).toHaveBeenCalledTimes(1);
            expect(navigate).not.toHaveBeenCalled();
        });

        it('a row with a link and a body: the chevron only expands, and the Open button is what goes to the link', () => {
            const host = render([row({ link: { kind: 'route', href: '/content/report', target: null } })]);

            (host.querySelector('button[aria-label="Expand"]') as HTMLButtonElement).click();
            fixture.detectChanges();
            (host.querySelector('button[aria-label="Collapse"]') as HTMLButtonElement).click();
            fixture.detectChanges();
            expect(navigateByUrl).withContext('the chevron never navigates').not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();

            openLinkButton(host)?.click();
            expect(navigateByUrl).toHaveBeenCalledOnceWith('/content/report');
        });

        it('a row with neither a link nor an action shows no button under the text', () => {
            const host = render([row()]);

            expect(host.querySelector('.cms-notification-row__action')).toBeNull();
        });

        describe('how the server says to draw the action', () => {
            /** A missed call's or a mention's action: the row is the action, to its conversation in the chat. */
            const openConversation: NotificationAction = {
                label: 'open-conversation', labelText: 'Open conversation', presentation: 'row',
                destination: { name: 'chat.conversation', params: { conversationId: CONVERSATION_ID } },
            };
            const activate = (n: NotificationDto): void =>
                (fixture.componentInstance as unknown as { onActivate(n: NotificationDto): void }).onActivate(n);
            const rowEl = (host: HTMLElement): HTMLElement => host.querySelector('.cms-notification-row') as HTMLElement;
            const enter = (el: HTMLElement): void => {
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
                fixture.detectChanges();
            };

            it('presentation button draws the button, and the row is not interactive as a whole', () => {
                const host = render([row({ action: { ...reconnect(), presentation: 'button' } })]);

                expect(actionButton(host)?.textContent?.trim()).toBe('Reconnect');
                expect(rowEl(host).getAttribute('role')).toBeNull();
                expect(rowEl(host).hasAttribute('tabindex')).toBeFalse();
                expect(notificationActionTarget({ ...reconnect(), presentation: 'button' })?.presentation).toBe('button');
            });

            it('no presentation means a button', () => {
                const host = render([row({ action: reconnect() })]);

                expect(reconnect().presentation).toBeUndefined();
                expect(actionButton(host)).not.toBeNull();
                expect(rowEl(host).getAttribute('role')).toBeNull();
                expect(notificationActionTarget(reconnect())?.presentation).toBe('button');
            });

            it('presentation row with a known destination: no button; the row, named by its title and described by its label, opens it on Enter and on a click', () => {
                const n = row({ action: { ...reconnect(), presentation: 'row' } });
                const host = render([n]);
                const r = rowEl(host);

                expect(actionButton(host)).withContext('no button').toBeNull();
                expect(r.getAttribute('role')).toBe('link');
                expect(r.getAttribute('tabindex')).toBe('0');
                expect(r.getAttribute('aria-label')).withContext('the name is the title').toBe('Support stopped fetching mail');
                expect(r.getAttribute('aria-description')).withContext('the action is its description').toBe('Reconnect');

                enter(r);
                expect(markRead).toHaveBeenCalledOnceWith('n-1');
                expect(navigate).toHaveBeenCalledOnceWith(['/email', { mailbox: MAILBOX_ID }], { queryParams: { settings: 'connection' } });
                expect(close).toHaveBeenCalledTimes(1);

                activate(n);
                expect(navigate).withContext('a click opens it too').toHaveBeenCalledTimes(2);
                expect(navigateByUrl).not.toHaveBeenCalled();
            });

            it('Enter on a control inside such a row is that control\'s, not the row\'s', () => {
                const host = render([row({ action: { ...reconnect(), presentation: 'row' } })]);

                enter(rowEl(host).querySelector('button[aria-label="Expand"]') as HTMLElement);

                expect(navigate).not.toHaveBeenCalled();
            });

            it('a missed call\'s row to chat.conversation opens /chat?c=<id> on Enter and on a click, and reads the row; named "3 missed calls"', () => {
                expect(notificationActionTarget(openConversation)).toEqual({
                    label: 'Open conversation', presentation: 'row', commands: ['/chat'], queryParams: { c: CONVERSATION_ID },
                });
                const n = row({ type: 'rtc.call.missed', extras: { title: '3 missed calls' }, action: openConversation });
                const host = render([n]);
                const r = rowEl(host);

                expect(actionButton(host)).withContext('no button').toBeNull();
                expect(r.getAttribute('role')).toBe('link');
                expect(r.getAttribute('aria-label')).toBe('3 missed calls');
                expect(r.getAttribute('aria-description')).toBe('Open conversation');

                enter(r);
                expect(markRead).toHaveBeenCalledOnceWith('n-1');
                expect(navigate).toHaveBeenCalledOnceWith(['/chat'], { queryParams: { c: CONVERSATION_ID } });
                expect(close).toHaveBeenCalledTimes(1);

                activate(n);
                expect(navigate).withContext('a click opens it too').toHaveBeenCalledTimes(2);
                expect(navigateByUrl).not.toHaveBeenCalled();
            });

            it('a mention\'s row to chat.conversation opens its conversation on a click', () => {
                const n = row({ type: 'chat.mention', extras: { title: 'You were mentioned' }, action: openConversation });
                render([n]);

                activate(n);

                expect(markRead).toHaveBeenCalledOnceWith('n-1');
                expect(navigate).toHaveBeenCalledOnceWith(['/chat'], { queryParams: { c: CONVERSATION_ID } });
            });

            it('a row action to chat.conversation without a conversationId stays inert: no button, no role, pressing reads it and goes nowhere', () => {
                const noId: NotificationAction = { ...openConversation, destination: { name: 'chat.conversation', params: {} } };
                const n = row({ type: 'rtc.call.missed', extras: { title: 'Missed call' }, action: noId });
                const host = render([n]);
                const r = rowEl(host);

                expect(notificationActionTarget(noId)).toBeNull();
                expect(actionButton(host)).toBeNull();
                expect(r.getAttribute('role')).toBeNull();
                expect(r.hasAttribute('tabindex')).toBeFalse();
                expect(r.hasAttribute('aria-label')).toBeFalse();
                expect(r.hasAttribute('aria-description')).toBeFalse();

                enter(r);
                expect(markRead).withContext('Enter on an inert row that cannot take focus does nothing').not.toHaveBeenCalled();
                activate(n);
                expect(markRead).withContext('pressing it still reads it').toHaveBeenCalledOnceWith('n-1');
                expect(navigate).not.toHaveBeenCalled();
                expect(navigateByUrl).not.toHaveBeenCalled();
                expect(close).not.toHaveBeenCalled();
            });

            it('a row action to a destination the admin does not know stays inert: the admin never navigates by a notification\'s type', () => {
                const unknown: NotificationAction = { ...openConversation, destination: { name: 'calendar.event', params: { eventId: 'e-1' } } };
                const n = row({ type: 'chat.mention', extras: { title: 'You were mentioned' }, action: unknown });
                render([n]);

                activate(n);

                expect(navigate).not.toHaveBeenCalled();
                expect(navigateByUrl).not.toHaveBeenCalled();
            });
        });
    });
});
