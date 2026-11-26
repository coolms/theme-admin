import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { EDITOR_MANIFEST_PROVIDER, provideCoolmsEditor } from '@coolms/editor-angular';
import { ContextMenuService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';

import { RtcCallService } from '../rtc/rtc-call.service';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { ChatAddressFake } from './chat-address.fake';
import { MessagesPageComponent } from './messages.page';
import { MessagesQuickPanelComponent } from './messages-quick-panel.component';
import { MessagesService } from './messages.service';
import type { ChatConversationDto, ChatMessageDto } from './messages.types';

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

const message = (id: string, body: string, bodyFormat: string): ChatMessageDto => ({
    id, conversationId: 'd1', seq: 1, type: 'text', body, bodyFormat, senderParticipantId: 'p-u-d1', clientId: null, createdAt: '2026-11-20T10:00:00+00:00',
}) as unknown as ChatMessageDto;

/** A message's addresses are links in both kinds of body, and nothing written in one is read as HTML. */
describe('MessagesPageComponent -- links in a message', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [MessagesPageComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: MessagesService,
                    useValue: new Proxy({
                        listConversations: () => of(ROWS),
                        listChannels: () => of([]),
                        fetchOnline: () => of({}),
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
                ...new ChatAddressFake().providers,
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

    function show(...messages: ChatMessageDto[]): void {
        fixture = TestBed.createComponent(MessagesPageComponent);
        document.body.appendChild(el());
        fixture.detectChanges();
        fixture.componentInstance.selectedId.set('d1');
        fixture.componentInstance.messages.set(messages);
        fixture.detectChanges();
    }
    const links = (): Array<[string | null, string | null, string, string]> =>
        Array.from(el().querySelectorAll<HTMLAnchorElement>('.msg__body a')).map(a => [a.getAttribute('href'), a.textContent, a.target, a.rel]);

    it('a plain body: its addresses are links in a new tab, the rest is text', () => {
        const body = 'See https://example.com/a or write to s.taylor@example.test. <img src=x onerror=alert(1)> javascript:alert(1)';
        show(message('m1', body, 'plain'));
        expect(links()).toEqual([
            ['https://example.com/a', 'https://example.com/a', '_blank', 'noopener noreferrer'],
            ['mailto:s.taylor@example.test', 's.taylor@example.test', '_blank', 'noopener noreferrer'],
        ]);
        const drawn = el().querySelector('[data-test="plain-body"]')!;
        expect(drawn.textContent).toBe(body);
        expect(drawn.querySelector('img')).toBeNull();
    });

    it('a mention and a channel beside or inside an address are themselves, and the body reads as it was written', () => {
        const said = {
            ...message('m3', '<p>@s.taylor&#64;example.test see https://example.com/(#general, anna&#64;Smith.example and https://example.com/b</p>', 'html'),
            mentions: [{ userId: 'u-d1', label: 's.taylor@example.test' }, { userId: 'u-g1', label: 'Smith' }],
        } as unknown as ChatMessageDto;
        show(said);
        fixture.componentInstance.channels.set([{ id: 'c1', title: 'General', slug: 'general', joined: true }] as never);
        fixture.detectChanges();
        expect(Array.from(el().querySelectorAll('.msg__mention')).map(m => m.textContent)).toEqual(['@s.taylor@example.test', '@Smith']);
        expect(el().querySelector('.msg__chanref')?.textContent).toBe('#general');
        expect(links().map(l => l[0])).toEqual(['https://example.com/(', 'https://example.com/b']);
        expect(el().querySelector('.msg__body')!.textContent).toBe('@s.taylor@example.test see https://example.com/(#general, anna@Smith.example and https://example.com/b');
    });

    it('an HTML body: the same, once Angular has sanitised it', () => {
        show(message('m2', '<p>See https://example.com/a &amp; <code>https://example.com/c</code></p>', 'html'));
        expect(links()).toEqual([['https://example.com/a', 'https://example.com/a', '_blank', 'noopener noreferrer']]);
    });

    it('the quick panel: both kinds of body the same', () => {
        const panel = TestBed.createComponent(MessagesQuickPanelComponent);
        document.body.appendChild(panel.nativeElement as HTMLElement);
        panel.detectChanges();
        panel.componentInstance.openId.set('d1');
        panel.componentInstance.threadMessages.set([
            message('m4', 'See https://example.com/a <img src=x>', 'plain'), message('m5', '<p>s.taylor&#64;example.test</p>', 'html'),
        ]);
        panel.componentInstance.threadLoading.set(false);
        panel.detectChanges();
        const bubbles = Array.from((panel.nativeElement as HTMLElement).querySelectorAll('.mqp__bubble'));
        expect(bubbles.map(b => Array.from(b.querySelectorAll('a')).map(a => [a.getAttribute('href'), a.target, a.rel]))).toEqual([
            [['https://example.com/a', '_blank', 'noopener noreferrer']], [['mailto:s.taylor@example.test', '_blank', 'noopener noreferrer']],
        ]);
        expect(bubbles[0].querySelector('img')).toBeNull();
        expect(bubbles[0].textContent).toContain('See https://example.com/a <img src=x>');
        (panel.nativeElement as HTMLElement).remove();
        panel.destroy();
    });
});
