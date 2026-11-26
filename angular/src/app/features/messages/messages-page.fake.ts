import { type EnvironmentProviders, type Provider, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { EDITOR_MANIFEST_PROVIDER, provideCoolmsEditor } from '@coolms/editor-angular';
import { ContextMenuService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';

import { RtcCallService } from '../rtc/rtc-call.service';
import { type ChatAddressFake } from './chat-address.fake';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { MessagesService } from './messages.service';
import type { ChatConversationDto } from './messages.types';

const person = (userId: string, displayName: string) => ({ participantId: 'p-' + userId, userId, displayName, kind: 'human', role: 'member' });

/** A direct conversation with one other person, its last message at this time. */
export function fakeConversation(id: string, lastMessageAt: string): ChatConversationDto {
    return {
        id, kind: 'direct', title: null, status: 'open', lastSeq: 3, updatedAt: lastMessageAt, lastMessageAt, createdAt: lastMessageAt,
        lastMessagePreview: 'Hello', viewerUnread: 0,
        participants: [{ ...person('u1', 'Me'), presenceStatus: 'online' }, person('u-' + id, 'Person ' + id)],
    };
}

/** The conversations the stand-in server lists, in its order. */
export const FAKE_ROWS: readonly ChatConversationDto[] = [
    fakeConversation('d1', '2026-11-20T10:00:00+00:00'),
    fakeConversation('d2', '2026-11-20T09:00:00+00:00'),
    fakeConversation('d3', '2026-11-20T08:00:00+00:00'),
];

/** What the stand-in server answers. */
export interface FakeChatServer {
    /** The inbox's rows. */
    readonly rows: readonly ChatConversationDto[];
    /** A conversation the person may read but not on the inbox's first page. */
    readonly older?: readonly ChatConversationDto[];
    /** The one-row reads asked for, by id. */
    readonly reads: string[];
}

/**
 * The chat page's stand-in services: the server lists `rows`; a one-row read answers a listed or older conversation
 * and refuses (404) any other id, as it does for one the person may not read.
 */
export function chatPageProviders(server: FakeChatServer, address: ChatAddressFake): Array<Provider | EnvironmentProviders> {
    const one = (id: string): Observable<ChatConversationDto> => {
        server.reads.push(id);
        const row = [...server.rows, ...(server.older ?? [])].find(c => c.id === id);
        return row === undefined ? throwError(() => ({ status: 404 })) : of({ ...row });
    };
    const known: Record<string, unknown> = {
        listConversations: () => of(server.rows.map(c => ({ ...c }))),
        getConversation: one,
        listChannels: () => of([]),
        fetchOnline: () => of({}),
        markRead: () => of(null),
    };
    return [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
            provide: MessagesService,
            useValue: new Proxy(known, { get: (target, name) => target[String(name)] ?? (() => NEVER) }),
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
        ...address.providers,
        { provide: DateTimeFormatService, useValue: new Proxy({}, { get: () => () => '' }) },
        provideCoolmsEditor(),
        { provide: EDITOR_MANIFEST_PROVIDER, useValue: { getProfile: () => ({ contributors: [], allowedWidgets: [] }) } },
        { provide: RtcCallService, useValue: { activeCall: signal(null), place: (): void => {}, downloadRecording: (): void => {} } },
    ];
}

/** The media query the page asks for a phone's width; the same as Mail's. */
export const PHONE_QUERY = '(max-width: 599.98px)';
