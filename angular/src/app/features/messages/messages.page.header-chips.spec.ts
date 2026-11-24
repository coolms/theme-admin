import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { ContextMenuService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';

import { RtcCallService } from '../rtc/rtc-call.service';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { conversationFiltersOf, conversationsShown } from './conversation-filter.util';
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

describe('conversationFiltersOf / conversationsShown', () => {
    const shownIn = (ctx: Record<string, unknown>) => (n: NaviGraphNode) => holds(n.meta['showWhen'], ctx);

    it('the chips are the tree\'s filter nodes this context shows, in order; the default is the one it marks', () => {
        expect(conversationFiltersOf(TREE, shownIn({ _anyUnread: false })).options.map(o => o.label)).toEqual(['All', 'Direct', 'Groups']);
        const all = conversationFiltersOf(TREE, shownIn({ _anyUnread: true }));
        expect(all.options).toEqual([
            { id: 'all', label: 'All' }, { id: 'direct', label: 'Direct' }, { id: 'group', label: 'Groups' }, { id: 'unread', label: 'Unread' },
        ]);
        expect(all.initial).toBe('all');
        expect(conversationFiltersOf([], shownIn({})).initial).toBeNull();
    });

    it('keeps every row for all, the unread for unread, the rows of that kind otherwise', () => {
        const unread = (c: ChatConversationDto) => c.id === 'd1';
        expect(conversationsShown(ROWS, 'all', unread).map(c => c.id)).toEqual(['d1', 'g1', 'd2', 'n1']);
        expect(conversationsShown(ROWS, 'direct', unread).map(c => c.id)).toEqual(['d1', 'd2']);
        expect(conversationsShown(ROWS, 'group', unread).map(c => c.id)).toEqual(['g1']);
        expect(conversationsShown(ROWS, 'unread', unread).map(c => c.id)).toEqual(['d1']);
        expect(conversationsShown(ROWS, null, unread).length).toBe(4);
    });
});

/** Chat's page header (the tree's title, New chat beside the status control) and the conversation list's chips. */
describe('MessagesPageComponent -- the header and the list\'s chips', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    let tree: NaviGraphNode[];
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const part = (selector: string): HTMLElement => el().querySelector<HTMLElement>(selector)!;
    const names = (): string[] => [...el().querySelectorAll('.msg__row-name')].map(n => n.textContent!.trim());
    const chips = (): string[] => [...el().querySelectorAll('[data-test="chat-chips"] [role="radio"]')].map(c => c.textContent!.trim());
    const choose = (value: string): void => {
        part(`[data-test="chat-chips"] [data-chip="${value}"]`).click();
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
        expect(part('.msg__list-head').querySelectorAll('button').length).toBe(0);
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

    it('over the list: the search, then the tree\'s chips, its default chosen; Unread shown while a row is unread', () => {
        render();
        const search = part('.msg__search');
        const group = part('[data-test="chat-chips"]');
        expect(group.getBoundingClientRect().top).toBeGreaterThanOrEqual(search.getBoundingClientRect().bottom);
        expect(chips()).toEqual(['All', 'Direct', 'Groups', 'Unread']);
        expect(group.querySelector('[data-chip="all"]')!.getAttribute('aria-checked')).toBe('true');
        expect(names().length).toBe(4);

        fixture.componentInstance.conversations.set(ROWS.map(c => ({ ...c, viewerUnread: 0 }) as ChatConversationDto));
        fixture.detectChanges();
        expect(chips()).toEqual(['All', 'Direct', 'Groups']);
    });

    it('a chip keeps the conversations it names; the search narrows within it', () => {
        render();
        choose('group');
        expect(names()).toEqual(['Design team']);
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
    });

    it('a chip that keeps none says so; a chosen chip the tree stops showing gives way to the default', () => {
        render();
        choose('unread');
        fixture.componentInstance.conversations.set(ROWS.map(c => ({ ...c, viewerUnread: 0 }) as ChatConversationDto));
        fixture.detectChanges();
        expect(fixture.componentInstance.listFilter()).toBe('all');
        expect(names().length).toBe(4);

        fixture.componentInstance.conversations.set(ROWS.filter(c => c.kind !== 'group'));
        fixture.detectChanges();
        choose('group');
        expect(part('[data-test="chat-filter-empty"]').textContent!.trim()).toBe('No conversations under Groups.');
    });
});
