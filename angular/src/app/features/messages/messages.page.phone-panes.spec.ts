import { ApplicationRef, signal } from '@angular/core';
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
import { MessagesService } from './messages.service';
import type { ChatConversationDto, ChatMessageDto } from './messages.types';

const person = (userId: string, displayName: string) => ({ participantId: 'p-' + userId, userId, displayName, kind: 'human', role: 'member' });
const conversation = (id: string, lastMessageAt: string): ChatConversationDto => ({
    id, kind: 'direct', title: null, status: 'open', lastSeq: 3, updatedAt: lastMessageAt, lastMessageAt, createdAt: lastMessageAt,
    lastMessagePreview: 'Hello', viewerUnread: 0,
    participants: [{ ...person('u1', 'Me'), presenceStatus: 'online' }, person('u-' + id, 'Person ' + id)],
}) as unknown as ChatConversationDto;
const ROWS: ChatConversationDto[] = [
    conversation('d1', '2026-11-20T10:00:00+00:00'),
    conversation('d2', '2026-11-20T09:00:00+00:00'),
    conversation('d3', '2026-11-20T08:00:00+00:00'),
];

/** The query the page asks for a phone's width; the same as Mail's. */
const PHONE_QUERY = '(max-width: 599.98px)';

/**
 * At a phone's width Chat shows one pane at a time, as Mail does: the list with nothing open; the open conversation
 * filling the page with a Back that returns to the list, the focus on the row it came from. At a desktop's width both
 * panes stand side by side and there is no Back. The page is rendered in the browser at each width, with the stand-in
 * services, the phone's width answered by the media query the page asks.
 */
describe('Chat -- one pane at a time on a phone', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const q = (sel: string): HTMLElement | null => el().querySelector<HTMLElement>(sel);
    const shown = (node: HTMLElement | null): boolean => node !== null && getComputedStyle(node).display !== 'none' && node.offsetWidth > 0;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [MessagesPageComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: MessagesService,
                    useValue: new Proxy({
                        listConversations: () => of(ROWS.map(c => ({ ...c }))),
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
                    useValue: { loadTree: () => of([] as NaviGraphNode[]), isVisible: () => true, matchesShowWhen: () => true },
                },
                { provide: ContextMenuService, useValue: { openFrom: (): void => {}, menu: () => null, close: (): void => {} } },
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

    /** The page drawn this wide, the window answering the phone's query as a window that wide would. */
    function show(width: number): void {
        const original = window.matchMedia.bind(window);
        spyOn(window, 'matchMedia').and.callFake((query: string) => (query === PHONE_QUERY
            ? { matches: width < 600, media: query, addEventListener: (): void => {}, removeEventListener: (): void => {} } as unknown as MediaQueryList
            : original(query)));
        fixture = TestBed.createComponent(MessagesPageComponent);
        el().style.width = width + 'px';
        el().style.height = '700px';
        document.body.appendChild(el());
        fixture.detectChanges();
        expect(el().querySelectorAll('.msg__row').length).withContext('the rows drawn').toBe(3);
    }

    function open(id: string): void {
        (q(`.msg__row[data-conversation="${id}"]`) as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(fixture.componentInstance.selectedId()).withContext('opened').toBe(id);
    }

    it('on a phone with nothing open: the list fills the page, the conversation pane is not shown', () => {
        show(390);
        const page = q('.msg')!;
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(q('.msg__list')!.offsetWidth).withContext('list width').toBe(page.clientWidth);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(shown(q('[data-test="chat-phone-back"]'))).withContext('back').toBe(false);
    });

    it('on a phone with one open: the conversation fills the page with Back, the list is not shown', () => {
        show(390);
        open('d2');
        const page = q('.msg')!;
        const thread = q('.msg__thread')!;
        expect(shown(thread)).withContext('conversation pane').toBe(true);
        expect(thread.offsetWidth).withContext('conversation width').toBe(page.clientWidth);
        expect(shown(q('.msg__list'))).withContext('list').toBe(false);
        const back = q('[data-test="chat-phone-back"]') as HTMLButtonElement;
        expect(shown(back)).withContext('back shown').toBe(true);
        expect(back.tagName).toBe('BUTTON');
        expect(back.tabIndex).withContext('in the tab order').toBe(0);
        expect(back.disabled).toBe(false);
        expect(back.textContent?.trim()).withContext('its name').toBe('Back');
        expect(back.parentElement).withContext('Back is in the conversation pane').toBe(thread);
    });

    it('on a phone, Back returns to the list with the focus on the row it came from', () => {
        show(390);
        open('d2');
        const back = q('[data-test="chat-phone-back"]') as HTMLButtonElement;
        back.focus();
        back.click();
        fixture.detectChanges();
        TestBed.inject(ApplicationRef).tick();

        expect(fixture.componentInstance.selectedId()).withContext('closed').toBeNull();
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(document.activeElement).withContext('focus').toBe(q('.msg__row[data-conversation="d2"]'));
    });

    it('on a phone, a thread opened in the conversation fills the page in its place', () => {
        show(390);
        open('d1');
        fixture.componentInstance.openThreadRoot.set({ id: 'm1', conversationId: 'd1', seq: 1, body: 'Root', replyCount: 0 } as unknown as ChatMessageDto);
        fixture.detectChanges();
        const page = q('.msg')!;
        expect(shown(q('.msg__tp'))).withContext('thread panel').toBe(true);
        expect(q('.msg__tp')!.offsetWidth).withContext('thread panel width').toBe(page.clientWidth);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(shown(q('.msg__list'))).withContext('list').toBe(false);
    });

    it('on a desktop: the list and the conversation side by side, no Back', () => {
        show(1200);
        expect(shown(q('.msg__list'))).withContext('list, nothing open').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane, nothing open').toBe(true);
        open('d2');
        const list = q('.msg__list')!;
        const thread = q('.msg__thread')!;
        expect(shown(list)).withContext('list').toBe(true);
        expect(shown(thread)).withContext('conversation pane').toBe(true);
        expect(list.getBoundingClientRect().right).withContext('list left of the conversation').toBeLessThanOrEqual(thread.getBoundingClientRect().left);
        expect(thread.offsetWidth).withContext('conversation shares the width').toBeLessThan(q('.msg')!.clientWidth - 200);
        expect(shown(q('[data-test="chat-phone-back"]'))).withContext('back').toBe(false);
    });
});
