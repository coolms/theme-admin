import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of, throwError } from 'rxjs';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { ContextMenuService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';

import { RtcCallService } from '../rtc/rtc-call.service';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { conversationsShown } from './conversation-filter.util';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { MessagesPageComponent } from './messages.page';
import { MessagesService } from './messages.service';
import type { ChatConversationDto } from './messages.types';

const person = (userId: string, displayName: string) => ({ participantId: 'p-' + userId, userId, displayName, kind: 'human', role: 'member' });
const conversation = (id: string, kind: string, title: string | null, updatedAt: string, viewerUnread = 0): ChatConversationDto => ({
    id, kind, title, status: 'open', lastSeq: 3, updatedAt, lastMessageAt: null, lastMessagePreview: null, viewerUnread,
    participants: [{ ...person('u1', 'Me'), presenceStatus: 'online' }, person('u-' + id, 'Person ' + id)],
}) as unknown as ChatConversationDto;
const ROWS: ChatConversationDto[] = [
    conversation('d1', 'direct', null, '2026-11-20T10:00:00+00:00', 2),
    conversation('g1', 'group', 'Design team', '2026-11-20T09:00:00+00:00'),
    conversation('d2', 'direct', null, '2026-11-20T08:00:00+00:00'),
    conversation('n1', 'self_notes', null, '2026-11-20T07:00:00+00:00'),
];

const node = (path: string, sortOrder: number, meta: Record<string, unknown>): NaviGraphNode => ({
    id: 'n' + path, path, title: String(meta['label'] ?? ''), parentId: null, sortOrder, isActive: true, isVisible: true, children: [], meta,
}) as unknown as NaviGraphNode;
/** navi.toolbar.chat.list as the server serves it. */
const TREE: NaviGraphNode[] = [
    node('/title', 10, { label: 'Chat', action: 'title' }),
    node('/new-conversation', 20, { icon: 'pencil-square', label: 'New chat', action: 'new-conversation', position: 'header', primary: true }),
    node('/filter-all', 30, { label: 'All', action: 'filter', value: 'all', default: true }),
    node('/filter-direct', 40, { label: 'Direct', action: 'filter', value: 'direct' }),
    node('/filter-groups', 50, { label: 'Groups', action: 'filter', value: 'group' }),
    node('/filter-unread', 60, { label: 'Unread', action: 'filter', value: 'unread', showWhen: { field: '_anyUnread', op: 'eq', value: true } }),
];
const CHANNELS = node('/browse-channels', 25, { icon: 'hash', label: 'Browse channels', action: 'browse-channels', position: 'header' });

/** The `eq` conditions the tree uses, as the graph service reads them. */
const holds = (when: unknown, ctx: Record<string, unknown>): boolean => {
    if (when === undefined || when === null) return true;
    const w = when as { field: string; value: unknown };
    return ctx[w.field] === w.value;
};

describe('conversationsShown', () => {
    it('keeps every row for all, the unread for unread, the rows of that kind otherwise', () => {
        const unread = (c: ChatConversationDto) => c.id === 'd1';
        expect(conversationsShown(ROWS, 'all', unread).map(c => c.id)).toEqual(['d1', 'g1', 'd2', 'n1']);
        expect(conversationsShown(ROWS, 'direct', unread).map(c => c.id)).toEqual(['d1', 'd2']);
        expect(conversationsShown(ROWS, 'group', unread).map(c => c.id)).toEqual(['g1']);
        expect(conversationsShown(ROWS, 'unread', unread).map(c => c.id)).toEqual(['d1']);
        expect(conversationsShown(ROWS, null, unread).length).toBe(4);
    });
});

/** Chat's page header (the tree's title, New chat beside the status control) and the conversation list's filter. */
describe('MessagesPageComponent -- the header and the list\'s filter', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    let tree: NaviGraphNode[];
    /** The window is at a phone's width. */
    let phone: boolean;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const names = (): string[] => [...el().querySelectorAll('.msg__row-name')].map(n => n.textContent!.trim());
    const title = (): string => part('cms-page-header h1').textContent!.trim();
    const filterButton = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-test="chat-filter"] button');
    /** The filter's menu as the page opens it: its choices, and what choosing one does. */
    function openFilter(): { items: { id: string; label: string; checked: boolean }[]; act: (id: string) => void } {
        const menu = TestBed.inject(ContextMenuService) as unknown as { openFrom: jasmine.Spy };
        filterButton()!.click();
        const args = menu.openFrom.calls.mostRecent().args;
        return { items: args[1], act: args[2] };
    }
    const choose = (value: string): void => {
        fixture.detectChanges();
        openFilter().act(value);
        fixture.detectChanges();
    };
    const noneUnread = (): void => {
        fixture.componentInstance.conversations.set(ROWS.map(c => ({ ...c, viewerUnread: 0 }) as ChatConversationDto));
        fixture.detectChanges();
    };

    function render(): void {
        fixture = TestBed.createComponent(MessagesPageComponent);
        el().style.cssText = 'display: flex; flex-direction: column; width: 1200px; height: 700px';
        document.body.appendChild(el());
        fixture.detectChanges();
        fixture.detectChanges();
    }

    beforeEach(() => {
        tree = TREE;
        phone = false;
        const media = window.matchMedia.bind(window);
        spyOn(window, 'matchMedia').and.callFake((query: string) => (query === '(max-width: 599.98px)'
            ? { matches: phone, addEventListener: (): void => {}, removeEventListener: (): void => {} } as unknown as MediaQueryList
            : media(query)));
        TestBed.configureTestingModule({
            imports: [MessagesPageComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: MessagesService,
                    useValue: {
                        listConversations: () => of(ROWS),
                        listChannels: () => of([]),
                        fetchOnline: () => of({}),
                        setStatus: () => of(null),
                    },
                },
                { provide: MessagesLiveEventsService, useValue: { watchRoom: () => NEVER, watchUser: () => NEVER, isConnected: signal(false) } },
                { provide: ChatPresenceLiveService, useValue: { live: signal(true), online: signal(new Set<string>()) } },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? { id: 'u1' }
                            : sel === AppConfigState.manifest ? { navi: { graphBySlug: '/api/v1/navi/trees/{slug}/graph' } } : null),
                    },
                },
                {
                    provide: NaviGraphService,
                    useValue: {
                        loadTree: () => of(tree),
                        isVisible: (n: NaviGraphNode, ctx: Record<string, unknown>) => holds(n.meta['showWhen'], ctx),
                        matchesShowWhen: (when: unknown, ctx: Record<string, unknown>) => holds(when, ctx),
                    },
                },
                { provide: ContextMenuService, useValue: { openFrom: jasmine.createSpy('openFrom'), menu: () => null, close: (): void => {} } },
                { provide: ToastService, useValue: { error: (): void => {} } },
                { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
                { provide: DateTimeFormatService, useValue: { row: () => '', auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: RtcCallService, useValue: { activeCall: signal(null), place: (): void => {}, downloadRecording: (): void => {} } },
            ],
        });
    });
    afterEach(() => {
        el().remove();
        fixture.destroy();
    });

    it('the page header holds the tree\'s title, the Online status, then New chat, the one filled button; no empty More', () => {
        render();
        const header = part('cms-page-header');
        expect(header.querySelector('h1')!.textContent!.trim()).toBe('Chat');
        const actions = header.querySelector<HTMLElement>('.page-header__actions')!;
        const order = [...actions.querySelectorAll('.msg__status, [data-action]')]
            .map(n => (n.classList.contains('msg__status') ? 'status' : n.getAttribute('data-action')));
        expect(order).toEqual(['status', 'primary']);
        const newChat = actions.querySelector<HTMLElement>('[data-action="primary"]')!;
        expect(newChat.textContent!.trim()).toBe('New chat');
        expect(newChat.classList).toContain('cms-btn-primary');
        expect(header.querySelectorAll('.cms-btn-primary').length).toBe(1);
        expect(actions.querySelector('.msg__status-label')!.textContent!.trim()).toBe('Online');
    });

    it('New chat opens the new-conversation picker; the column has no New and no Channels of its own', () => {
        render();
        const toggled = spyOn(fixture.componentInstance, 'toggleNew');
        part('cms-page-header [data-action="primary"]').click();
        expect(toggled).toHaveBeenCalledTimes(1);
        expect(part('.msg__list-head').querySelectorAll('button:not(.cms-filter-menu)').length).toBe(0);
    });

    it('the tree\'s other header nodes are under More: Browse channels opens the channels list', () => {
        tree = [...TREE, CHANNELS];
        render();
        const channels = spyOn(fixture.componentInstance, 'toggleChannels');
        const more = part('cms-page-header [data-action="more"]');
        more.click();
        const menu = TestBed.inject(ContextMenuService) as unknown as { openFrom: jasmine.Spy };
        const items = menu.openFrom.calls.mostRecent().args[1] as { id: string; label: string }[];
        expect(items.map(i => i.label)).toEqual(['Browse channels']);
        fixture.componentInstance.onHeaderAction(items[0].id);
        expect(channels).toHaveBeenCalledTimes(1);
    });

    it('the header is a band with a rule under it, the conversations under it', () => {
        render();
        const band = part('cms-page-header .page-header');
        expect(getComputedStyle(band).borderBottomStyle).toBe('solid');
        expect(part('.msg').getBoundingClientRect().top).toBeGreaterThanOrEqual(band.getBoundingClientRect().bottom);
    });

    it('the column\'s header row: Conversations at the start, the filter at its end, the tree\'s default chosen', () => {
        render();
        const head = part('.msg__list-head');
        const name = part('.msg__list-label');
        const b = filterButton()!;
        expect(name.textContent!.trim()).toBe('Conversations');
        expect(name.getAttribute('title')).toBe('Conversations');
        expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
        expect(head.contains(b)).toBeTrue();
        expect(el().querySelectorAll('[data-test="chat-filter"]').length).toBe(1);
        expect(head.getBoundingClientRect().right - b.getBoundingClientRect().right).toBeLessThanOrEqual(14);
        expect(part('.msg__search').getBoundingClientRect().top).toBeGreaterThanOrEqual(head.getBoundingClientRect().bottom);
        expect(b.getAttribute('aria-label')).toBe('Show: All');
        expect(b.querySelector('.bi-funnel')).not.toBeNull();
        expect(names().length).toBe(4);
    });

    it('the menu holds the tree\'s filters in its order, the current one marked; Unread while a row is unread', () => {
        render();
        expect(openFilter().items.map(i => i.label)).toEqual(['All', 'Direct', 'Groups', 'Unread']);
        expect(openFilter().items.filter(i => i.checked).map(i => i.id)).toEqual(['all']);

        noneUnread();
        expect(openFilter().items.map(i => i.label)).toEqual(['All', 'Direct', 'Groups']);
    });

    it('a filter keeps the conversations it names and is said on the button; the search narrows within it', () => {
        render();
        choose('group');
        expect(names()).toEqual(['Design team']);
        expect(filterButton()!.textContent!.trim()).toBe('Groups');
        choose('unread');
        expect(names()).toEqual(['Person d1']);
        choose('direct');
        expect(names().length).toBe(2);
        fixture.componentInstance.convQuery.set('Person d2');
        fixture.detectChanges();
        expect(names()).toEqual(['Person d2']);
        fixture.componentInstance.convQuery.set('');
        choose('all');
        expect(names().length).toBe(4);
        expect(filterButton()!.querySelector('.bi-funnel')).not.toBeNull();
    });

    it('the chosen filter stays while it is chosen, though the tree no longer shows it; left, it is offered no more', () => {
        render();
        choose('unread');
        noneUnread();
        expect(fixture.componentInstance.listFilter()).toBe('unread');
        expect(filterButton()!.textContent!.trim()).toBe('Unread');
        expect(openFilter().items.map(i => i.label)).toEqual(['All', 'Direct', 'Groups', 'Unread']);
        expect(names().length).toBe(0);
        expect(part('[data-test="chat-filter-empty"]').textContent!.trim()).toBe('No conversations under Unread.');

        choose('all');
        expect(openFilter().items.map(i => i.label)).toEqual(['All', 'Direct', 'Groups']);
        expect(names().length).toBe(4);
    });

    it('a value that names no filter of the tree reads as the default', () => {
        render();
        fixture.componentInstance.chosenFilter.set('gone');
        fixture.detectChanges();
        expect(fixture.componentInstance.listFilter()).toBe('all');
        expect(filterButton()!.querySelector('.bi-funnel')).not.toBeNull();
        expect(names().length).toBe(4);
    });

    it('a filter that keeps none says so; a choice starts the list from its top', () => {
        render();
        const rows = part('.msg__rows');
        rows.style.cssText = 'height: 40px; flex: none; overflow-y: auto';
        rows.scrollTop = 30;
        expect(rows.scrollTop).toBe(30);
        choose('direct');
        expect(rows.scrollTop).toBe(0);

        fixture.componentInstance.conversations.set(ROWS.filter(c => c.kind !== 'group'));
        fixture.detectChanges();
        choose('group');
        expect(part('[data-test="chat-filter-empty"]').textContent!.trim()).toBe('No conversations under Groups.');
    });

    it('a tree with fewer than two filters shown has no filter button', () => {
        tree = TREE.filter(n => !n.path.startsWith('/filter') || n.path === '/filter-all');
        render();
        expect(filterButton()).toBeNull();
        expect(names().length).toBe(4);
    });

    it('a filter whose value the page cannot apply is not in the menu, a kind of conversation is', () => {
        tree = [...TREE, node('/filter-odd', 70, { label: 'Odd', action: 'filter', value: 'odd' }),
            node('/filter-notes', 80, { label: 'Notes', action: 'filter', value: 'self_notes' })];
        render();
        expect(openFilter().items.map(i => i.label)).toEqual(['All', 'Direct', 'Groups', 'Unread', 'Notes']);
        fixture.componentInstance.chosenFilter.set('odd');
        fixture.detectChanges();
        expect(fixture.componentInstance.listFilter()).toBe('all');
        choose('self_notes');
        expect(names().length).toBe(1);
    });

    it('a tree that declares no filters has no filter button and keeps every row, whatever value was kept; phone or not', () => {
        for (const narrow of [false, true]) {
            phone = narrow;
            tree = TREE.filter(n => !n.path.startsWith('/filter'));
            render();
            fixture.componentInstance.chosenFilter.set('unread');
            fixture.detectChanges();
            expect(filterButton()).toBeNull();
            expect(fixture.componentInstance.listFilter()).toBeNull();
            expect(names().length).toBe(4);
            expect(title()).toBe('Chat');
            if (!narrow) {
                el().remove();
                fixture.destroy();
            }
        }
    });

    it('a tree that does not load has no filter button, and every row', () => {
        (TestBed.inject(NaviGraphService) as unknown as { loadTree: () => unknown }).loadTree = () => throwError(() => new Error('unavailable'));
        render();
        expect(filterButton()).toBeNull();
        expect(names().length).toBe(4);
    });

    it('while the public channels stand in the list\'s place there is no filter', () => {
        render();
        fixture.componentInstance.showChannels.set(true);
        fixture.detectChanges();
        expect(filterButton()).toBeNull();
        expect(part('.msg__list-label').textContent!.trim()).toBe('Conversations');
    });

    it('on a phone: no header row, the filter an icon beside the search, an active one said in the page\'s title', () => {
        phone = true;
        render();
        expect(el().querySelector('.msg__list-head')).toBeNull();
        const b = filterButton()!;
        expect(el().querySelectorAll('[data-test="chat-filter"]').length).toBe(1);
        const search = part('.msg__search').getBoundingClientRect();
        expect(b.getBoundingClientRect().left).toBeGreaterThanOrEqual(search.right);
        expect(b.getBoundingClientRect().top).toBeLessThan(search.bottom);
        expect(title()).toBe('Chat');

        choose('unread');
        expect(title()).toBe('Chat \u00b7 Unread');
        expect(filterButton()!.textContent!.trim()).withContext('still an icon').toBe('');
        expect(filterButton()!.classList).withContext('with the accent').toContain('cms-filter-menu--active');
        expect(filterButton()!.getAttribute('aria-label')).toBe('Show: Unread');

        fixture.componentInstance.showChannels.set(true);
        fixture.detectChanges();
        expect(title()).withContext('the channels are not filtered').toBe('Chat');
        fixture.componentInstance.showChannels.set(false);
        choose('all');
        expect(title()).toBe('Chat');
    });

    it('wider than a phone the title never says the filter', () => {
        render();
        choose('unread');
        expect(title()).toBe('Chat');
    });
});
