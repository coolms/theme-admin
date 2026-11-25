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

/** The `eq` conditions the tree uses, as the graph service reads them. */
const holds = (when: unknown, ctx: Record<string, unknown>): boolean => {
    if (when === undefined || when === null) return true;
    const w = when as { field: string; value: unknown };
    return ctx[w.field] === w.value;
};

/** The composer draws a stronger edge and no ring while its text has the focus; the search field beside it draws the ring. */
describe('MessagesPageComponent -- the composer\'s focus', () => {
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

    const outline = (e: Element): string => getComputedStyle(e).outlineStyle;
    const edge = (e: Element): string => getComputedStyle(e).borderTopColor;

    /** What a token resolves to here. */
    function resolved(token: string): string {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    }
    const settled = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 250));

    /** The field: no ring, its own edge at rest and the stronger one with the focus, at one width and size. */
    async function plainField(field: HTMLTextAreaElement): Promise<void> {
        expect(edge(field)).withContext('at rest').toBe(resolved('--cms-border-input'));
        const size = [field.offsetWidth, field.offsetHeight];
        field.focus();
        expect(document.activeElement).toBe(field);
        await settled();
        expect(edge(field)).toBe(resolved('--cms-border-input-focus'));
        expect(outline(field)).toBe('none');
        expect(getComputedStyle(field).boxShadow).toBe('none');
        expect([field.offsetWidth, field.offsetHeight]).toEqual(size);
    }

    async function show(): Promise<void> {
        fixture = TestBed.createComponent(MessagesPageComponent);
        document.body.appendChild(el());
        fixture.detectChanges();
        fixture.componentInstance.selectedId.set('d1');
        fixture.detectChanges();
        for (let i = 0; i < 60 && !el().querySelector('.msg__composer-shell [contenteditable="true"]'); i++) {
            await new Promise<void>(resolve => setTimeout(resolve, 25));
            fixture.detectChanges();
        }
    }

    it('typing in the composer draws a stronger edge and no ring; a button in it, and the search field, draw theirs', async () => {
        await show();
        const shell = el().querySelector<HTMLElement>('.msg__composer-shell')!;
        const text = shell.querySelector<HTMLElement>('[contenteditable="true"]')!;
        const atRest = edge(shell);
        expect(atRest).toBe(resolved('--cms-border-input'));

        text.focus();
        expect(shell.contains(document.activeElement)).withContext('the text has the focus').toBeTrue();
        for (let e: HTMLElement | null = text; e !== null && shell.contains(e); e = e.parentElement) {
            expect(outline(e)).withContext(e.className).toBe('none');
        }
        expect(getComputedStyle(shell).boxShadow).toBe('none');
        const width = getComputedStyle(shell).borderTopWidth;
        await settled();
        expect(edge(shell)).withContext('the stronger edge').toBe(resolved('--cms-border-input-focus'));
        expect(edge(shell)).not.toBe(atRest);
        expect(width).toBe('1px');

        const button = shell.querySelector<HTMLButtonElement>('.msg__tool')!;
        button.focus();
        expect(document.activeElement).toBe(button);
        await settled();
        expect(edge(shell)).withContext('a button\'s focus leaves the edge at rest').toBe(atRest);

        const box = el().querySelector<HTMLElement>('.msg__search')!;
        box.querySelector('input')!.focus();
        expect(box.contains(document.activeElement)).toBeTrue();
        expect(outline(box)).withContext('the search field').toBe('solid');
    });

    it('a thread\'s reply: the same', async () => {
        await show();
        fixture.componentInstance.openThreadRoot.set({
            id: 'm1', conversationId: 'd1', seq: 1, type: 'text', body: 'Hello', bodyFormat: 'plain', senderParticipantId: 'p-u-d1',
            clientId: null, createdAt: '2026-11-20T10:00:00+00:00',
        } as unknown as ChatMessageDto);
        fixture.detectChanges();
        await plainField(el().querySelector<HTMLTextAreaElement>('.msg__tp-input')!);
    });

    it('the quick panel\'s field: the same', async () => {
        const panel = TestBed.createComponent(MessagesQuickPanelComponent);
        document.body.appendChild(panel.nativeElement as HTMLElement);
        panel.detectChanges();
        panel.componentInstance.openId.set('d1');
        panel.detectChanges();
        await plainField((panel.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('.mqp__input')!);
        (panel.nativeElement as HTMLElement).remove();
        panel.destroy();
    });
});
