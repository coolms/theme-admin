import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { EDITOR_MANIFEST_PROVIDER, provideCoolmsEditor } from '@coolms/editor-angular';
import { ContextMenuService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';

import { RtcCallService } from '../rtc/rtc-call.service';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { MessagesPageComponent } from './messages.page';
import { MessagesQuickPanelComponent } from './messages-quick-panel.component';
import { MessagesService } from './messages.service';
import type { ChatConversationDto } from './messages.types';

const person = (userId: string, displayName: string) => ({ participantId: 'p-' + userId, userId, displayName, kind: 'human', role: 'member' });
const conversation = (id: string, kind: string, title: string | null, updatedAt: string, viewerUnread = 0): ChatConversationDto => ({
    id, kind, title, status: 'open', lastSeq: 3, updatedAt, lastMessageAt: null, lastMessagePreview: null, viewerUnread,
    participants: [{ ...person('u1', 'Me'), presenceStatus: 'online' }, person('u-' + id, 'Person ' + id)],
}) as unknown as ChatConversationDto;
const at = (row: ChatConversationDto, lastMessageAt: string | null, createdAt: string): ChatConversationDto =>
    ({ ...row, lastMessageAt, createdAt, lastMessagePreview: lastMessageAt === null ? null : 'Hello' });
/** In the inbox's order: d1, g1, d2, then n1, which has no message. */
const ROWS: ChatConversationDto[] = [
    at(conversation('d1', 'direct', null, '2026-11-20T10:00:00+00:00', 2), '2026-11-20T10:00:00+00:00', '2026-11-01T10:00:00+00:00'),
    at(conversation('g1', 'group', 'Design team', '2026-11-20T09:00:00+00:00'), '2026-11-20T09:00:00+00:00', '2026-11-01T10:00:00+00:00'),
    at(conversation('d2', 'direct', null, '2026-11-20T08:00:00+00:00', 1), '2026-11-20T08:00:00+00:00', '2026-11-01T10:00:00+00:00'),
    at(conversation('n1', 'group', 'Empty', '2026-11-20T07:00:00+00:00'), null, '2026-11-02T10:00:00+00:00'),
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

/** The `eq` conditions the tree uses, as the graph service reads them. */
const holds = (when: unknown, ctx: Record<string, unknown>): boolean => {
    if (when === undefined || when === null) return true;
    const w = when as { field: string; value: unknown };
    return ctx[w.field] === w.value;
};

/**
 * A conversation's place is its last message's: opening it, reading it, a draft and a change of its settings leave it
 * where it is; a message, sent or received, brings it to the top. In the page's list and in the quick panel's.
 */
describe('Chat -- what moves a conversation in the list', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    /** What the server lists now. */
    let served: ChatConversationDto[];
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

    beforeEach(() => {
        served = ROWS.map(c => ({ ...c }));
        TestBed.configureTestingModule({
            imports: [MessagesPageComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: MessagesService,
                    useValue: new Proxy({
                        listConversations: () => of(served),
                        listChannels: () => of([]),
                        fetchOnline: () => of({}),
                        markRead: () => of(null),
                    } as Record<string, unknown>, { get: (known, name) => known[String(name)] ?? (() => NEVER) }),
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
                        loadTree: () => of(TREE),
                        isVisible: (n: NaviGraphNode, ctx: Record<string, unknown>) => holds(n.meta['showWhen'], ctx),
                        matchesShowWhen: (when: unknown, ctx: Record<string, unknown>) => holds(when, ctx),
                    },
                },
                { provide: ContextMenuService, useValue: { openFrom: jasmine.createSpy('openFrom'), menu: () => null, close: (): void => {} } },
                { provide: ToastService, useValue: { error: (): void => {} } },
                { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
                { provide: DateTimeFormatService, useValue: new Proxy({}, { get: () => () => '' }) },
                provideCoolmsEditor(),
                { provide: EDITOR_MANIFEST_PROVIDER, useValue: { getProfile: () => ({ contributors: [], allowedWidgets: [] }) } },
                { provide: RtcCallService, useValue: { activeCall: signal(null), place: (): void => {}, downloadRecording: (): void => {} } },
            ],
        });
    });
    afterEach(() => {
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    const NOW = '2026-11-21T10:00:00+00:00';
    const order = (): string[] => fixture.componentInstance.filteredConversations().map(c => c.id);
    /** The list read again, the changed row first, as a list sorted by the change would be. */
    const change = (id: string, over: Partial<ChatConversationDto>): void => {
        const row = { ...served.find(c => c.id === id)!, updatedAt: NOW, ...over };
        served = [row, ...served.filter(c => c.id !== id)];
        fixture.componentInstance.reloadList();
        fixture.detectChanges();
    };

    function show(): void {
        fixture = TestBed.createComponent(MessagesPageComponent);
        document.body.appendChild(el());
        fixture.detectChanges();
        expect(order()).withContext('as listed').toEqual(['d1', 'g1', 'd2', 'n1']);
    }

    it('opening one leaves it where it is, one with no message too', () => {
        show();
        for (const id of ['d2', 'n1']) {
            fixture.componentInstance.select(id);
            fixture.detectChanges();
            change(id, {});
            expect(order()).withContext(id).toEqual(['d1', 'g1', 'd2', 'n1']);
        }
    });

    it('reading one leaves it where it is', () => {
        show();
        change('d2', { viewerUnread: 0 });
        expect(order()).toEqual(['d1', 'g1', 'd2', 'n1']);
    });

    it('a draft leaves it where it is', () => {
        show();
        fixture.componentInstance.select('d2');
        fixture.componentInstance.onComposerInput('<p>Not sent yet</p>');
        fixture.detectChanges();
        expect(order()).toEqual(['d1', 'g1', 'd2', 'n1']);
    });

    it('a change of its settings leaves it where it is', () => {
        show();
        change('g1', { title: 'Design', viewerMuted: true });
        expect(order()).toEqual(['d1', 'g1', 'd2', 'n1']);
    });

    it('a message brings it to the top, received or sent', () => {
        show();
        change('d2', { lastMessageAt: '2026-11-21T09:00:00+00:00', lastMessageMine: false });
        expect(order()).withContext('received').toEqual(['d2', 'd1', 'g1', 'n1']);
        change('n1', { lastMessageAt: NOW, lastMessageMine: true });
        expect(order()).withContext('sent, its first').toEqual(['n1', 'd2', 'd1', 'g1']);
    });

    it('the quick panel: the same order, whatever order the server lists in', () => {
        const panel = TestBed.createComponent(MessagesQuickPanelComponent);
        panel.detectChanges();
        const listed = (): string[] => panel.componentInstance.listed().map(c => c.id);
        panel.componentInstance.conversations.set(ROWS);
        expect(listed()).toEqual(['d1', 'g1', 'd2', 'n1']);
        panel.componentInstance.conversations.set([{ ...ROWS[3], updatedAt: NOW }, { ...ROWS[2], updatedAt: NOW, viewerUnread: 0 }, ROWS[0], ROWS[1]]);
        expect(listed()).withContext('opened, or read').toEqual(['d1', 'g1', 'd2', 'n1']);
        panel.componentInstance.conversations.set([ROWS[0], ROWS[1], { ...ROWS[2], lastMessageAt: NOW }, ROWS[3]]);
        expect(listed()).withContext('a message').toEqual(['d2', 'd1', 'g1', 'n1']);
        panel.destroy();
    });
});
