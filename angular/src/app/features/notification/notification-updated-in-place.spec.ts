import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
import {
    CentrifugoClientService,
    ConfirmDialogService,
    ContextMenuService,
    DrawerService,
    ToastService,
} from '@coolms/ui-angular';

import { NotificationApiService, type NotificationDto } from './notification-api.service';
import { NotificationDrawerContentComponent } from './notification-drawer-content.component';
import { NotificationLiveEventsService } from './notification-live-events.service';
import { NotificationPollingService } from './notification-polling.service';
import { NotificationSoundService } from './notification-sound.service';
import { NotificationStore, newestFirst } from './notification-store.service';

function missedCalls(title: string, createdAt: string): NotificationDto {
    return {
        id: 'missed-1', type: 'rtc.call.missed', extras: { title }, authorUserId: null, createdAt,
        expiresAt: null, readAt: null, dismissedAt: null, isRead: false, link: null,
    };
}

const MENTION: NotificationDto = {
    id: 'mention-1', type: 'chat.mention', extras: { title: 'You were mentioned' }, authorUserId: null,
    createdAt: '2026-11-12T09:10:00+00:00', expiresAt: null, readAt: null, dismissedAt: null, isRead: false, link: null,
};

/**
 * A notification the server updates in place -- the same id with a new title and a later createdAt, as missed calls
 * from one conversation grouped into one -- comes with the same realtime ping as a new one. The drawer reads its first
 * page again and the row is replaced where it is, never added a second time, the list placed again newest first, and
 * the unread badge counts it once. The real store and the real re-read run here; the server is a stub.
 */
describe('A notification updated in place', () => {
    let pages: NotificationDto[][];
    let unread: number[];

    function setUp(): { polling: NotificationPollingService; store: NotificationStore } {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [NotificationDrawerContentComponent],
            providers: [
                {
                    provide: NotificationApiService,
                    useValue: {
                        list: () => of(pages.shift() ?? []),
                        unreadCount: () => of({ count: unread.shift() ?? 0 }),
                        markRead: () => NEVER,
                    },
                },
                { provide: NotificationSoundService, useValue: { enabled: signal(true), toggle: () => {}, ding: () => Promise.resolve() } },
                { provide: Store, useValue: { selectSnapshot: () => null, select: () => NEVER } },
                { provide: NaviGraphService, useValue: {} },
                { provide: NotificationLiveEventsService, useValue: {} },
                { provide: CentrifugoClientService, useValue: { isConnected: signal(true) } },
                { provide: ContextMenuService, useValue: {} },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: DrawerService, useValue: { close: () => {} } },
                { provide: Router, useValue: { navigate: () => Promise.resolve(true), navigateByUrl: () => Promise.resolve(true) } },
            ],
        });
        TestBed.overrideComponent(NotificationDrawerContentComponent, {
            set: { imports: [DatePipe], schemas: [NO_ERRORS_SCHEMA] },
        });
        return { polling: TestBed.inject(NotificationPollingService), store: TestBed.inject(NotificationStore) };
    }

    /** A realtime ping's re-read, past the re-read's debounce, and its answers applied. */
    async function ping(polling: NotificationPollingService, at: number): Promise<void> {
        jasmine.clock().mockDate(new Date(at));
        polling.fetchNow();
        // The re-read answers through a few promise steps; none waits on a timer.
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    }

    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('one row with the new title, at the top, and the unread badge unchanged', async () => {
        pages = [
            [MENTION, missedCalls('Missed call', '2026-11-12T09:00:00+00:00')],
            [missedCalls('3 missed calls', '2026-11-12T09:20:00+00:00'), MENTION],
        ];
        unread = [2, 2];
        const { polling, store } = setUp();
        const fixture = TestBed.createComponent(NotificationDrawerContentComponent);

        await ping(polling, Date.UTC(2026, 10, 12, 9, 5));
        fixture.detectChanges();
        expect(store.notifications().map(n => n.id)).toEqual(['mention-1', 'missed-1']);
        expect(store.unreadCount()).toBe(2);

        await ping(polling, Date.UTC(2026, 10, 12, 9, 21));
        fixture.detectChanges();

        const titles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.cms-notification-row .fw-semibold'))
            .map(t => t.textContent?.trim());
        expect(titles).withContext('one row for the id, the new title, at the top').toEqual(['3 missed calls', 'You were mentioned']);
        expect(store.notifications().filter(n => n.id === 'missed-1').length).toBe(1);
        expect(store.unreadCount()).withContext('counted once').toBe(2);
        expect(store.hasUnread()).toBeTrue();
    });

    it('a page that carries the same id twice, or out of order, is drawn once per id, newest first', () => {
        const older = missedCalls('Missed call', '2026-11-12T09:00:00+00:00');
        const newer = missedCalls('3 missed calls', '2026-11-12T09:20:00+00:00');

        expect(newestFirst([MENTION, newer, older]).map(n => [n.id, n.extras['title']])).toEqual([
            ['missed-1', '3 missed calls'],
            ['mention-1', 'You were mentioned'],
        ]);
    });
});
