import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { Subscription, firstValueFrom } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import { CentrifugoClientService } from '@coolms/ui-angular';
import { NotificationApiService } from './notification-api.service';
import { NotificationChannels, NotificationLiveEventsService } from './notification-live-events.service';
import { NotificationStore } from './notification-store.service';

const POLL_INTERVAL_MS = 30_000;
const FETCH_DEBOUNCE_MS = 5_000;
const POLL_PAGE_SIZE = 20;

/**
 * Notification Sub-phase E -- canonical polling driver for the
 * bell. Ticks every 30 s while the tab is visible, pauses on
 * `visibilitychange -> hidden`, and triggers an immediate fetch
 * when the tab returns to visible.
 *
 * Sub-phase F layers Centrifugo push subscriptions on top:
 *   - `notifications.broadcast` subscribed once on `start()`
 *   - `notifications.user.{userId}` subscribed lazily when the
 *     authenticated user UUID becomes available, torn down on
 *     logout, and swapped on user-change
 *
 * Both push channels call `fetchNow()` on each ping; the 5-second
 * debounce prevents bursts of pings from spamming the API and
 * makes polling-plus-push race conditions idempotent. Polling
 * stays canonical -- push is the latency optimization.
 *
 * Sub-phase K suspends the 30-second tick while the Centrifugo
 * WebSocket is `connected`. The interval keeps running but its
 * handler short-circuits when push is healthy. On disconnect the
 * tick resumes immediately. The `start()`-time initial fetch and
 * the `visibilitychange -> visible` safety-net fetch fire
 * unconditionally regardless of connection state -- push cannot
 * deliver while the tab is hidden, and the initial mount must
 * always populate the badge before the first ping can arrive.
 *
 * `start()` is idempotent -- the bell calls it in `ngOnInit`
 * and a second call from any future re-mount is a no-op until
 * `stop()` has run. Cleanup binds to the bell component's
 * `DestroyRef`, so closing the admin shell tears down the
 * interval, visibility listener, and both push subscriptions.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPollingService {
    private readonly api = inject(NotificationApiService);
    private readonly store = inject(NotificationStore);
    private readonly authStore = inject(Store);
    private readonly liveEvents = inject(NotificationLiveEventsService);
    private readonly centrifugoClient = inject(CentrifugoClientService);
    private readonly destroyRef = inject(DestroyRef);

    private intervalId: ReturnType<typeof setInterval> | null = null;
    private lastFetchTimestamp = 0;
    private visibilityChangeHandler: (() => void) | null = null;
    private broadcastSubscription: Subscription | null = null;
    private userSubscription: Subscription | null = null;
    private currentUserId: string | null = null;

    /**
     * Mirrors `CentrifugoClientService.isConnected()` via the effect
     * below. Defaults to `true` so polling runs before the first
     * connection-state emission -- graceful degradation if push is
     * slow to come up or never connects at all.
     */
    private intervalActive = true;

    constructor() {
        effect(() => {
            this.intervalActive = !this.centrifugoClient.isConnected();
        });
    }

    start(): void {
        if (this.intervalId !== null) {
            return;
        }

        // Initial mount fetch -- bypass the debounce window so a
        // Centrifugo push ping arriving within 5 s of mount still
        // fires its own fetch. The debounce exists to coalesce
        // bursts of push pings, not to gate the bootstrap fetch
        // against the first legitimate ping that follows it.
        this.executeFetch();

        this.intervalId = setInterval(() => {
            if (!this.intervalActive) {
                return;
            }
            if (document.visibilityState === 'visible') {
                this.fetchNow();
            }
        }, POLL_INTERVAL_MS);

        this.visibilityChangeHandler = () => {
            if (document.visibilityState === 'visible') {
                // Bypass the `fetchNow()` debounce gate so a push ping
                // arriving within 5 s of tab focus still fires its own
                // fetch. Without this, switching to a tab and clicking
                // a feature button that produces a notification leaves
                // that tab's debounce window blocking the push refetch,
                // while other (hidden) tabs whose debounce has expired
                // happily refresh -- the multi-tab "I sent it from this
                // tab but the other tab received it" symptom.
                this.executeFetch();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);

        this.subscribeBroadcast();
        this.attachUserChannelReactor();

        this.destroyRef.onDestroy(() => this.stop());
    }

    /**
     * Trigger an immediate fetch unless the previous fetch was
     * within the 5 s debounce window. Sub-phase F's push handlers
     * call this on each Centrifugo ping.
     */
    fetchNow(): void {
        const now = Date.now();
        if (now - this.lastFetchTimestamp < FETCH_DEBOUNCE_MS) {
            return;
        }
        this.lastFetchTimestamp = now;
        this.executeFetch();
    }

    /**
     * Issue the actual list + unread-count requests. Bypasses the
     * `fetchNow()` debounce gate so callers that genuinely need an
     * unconditional fetch (initial mount bootstrap) cannot be
     * silenced by a recent debounce.
     */
    private executeFetch(): void {
        Promise.all([
            firstValueFrom(this.api.list({ limit: POLL_PAGE_SIZE })),
            firstValueFrom(this.api.unreadCount()),
        ])
            .then(([notifications, unreadResult]) => {
                this.store.setNotifications(notifications);
                this.store.setUnreadCount(unreadResult.count);
            })
            .catch((error: unknown) => {
                console.warn('[NotificationPollingService] fetch failed', error);
            });
    }

    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.visibilityChangeHandler !== null) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
            this.visibilityChangeHandler = null;
        }
        if (this.broadcastSubscription !== null) {
            this.broadcastSubscription.unsubscribe();
            this.broadcastSubscription = null;
        }
        if (this.userSubscription !== null) {
            this.userSubscription.unsubscribe();
            this.userSubscription = null;
        }
        this.currentUserId = null;
    }

    private subscribeBroadcast(): void {
        if (this.broadcastSubscription !== null) {
            return;
        }
        this.broadcastSubscription = this.liveEvents
            .watch(NotificationChannels.broadcast())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => this.fetchNow(),
                error: (err: unknown) => {
                    console.warn('[NotificationPollingService] broadcast subscription error', err);
                },
            });
    }

    private attachUserChannelReactor(): void {
        this.authStore
            .select(AuthState.currentUser)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(user => {
                const newUserId = user?.id ?? null;
                if (newUserId === this.currentUserId) {
                    return;
                }

                if (this.userSubscription !== null) {
                    this.userSubscription.unsubscribe();
                    this.userSubscription = null;
                }

                this.currentUserId = newUserId;

                if (newUserId !== null) {
                    this.userSubscription = this.liveEvents
                        .watch(NotificationChannels.user(newUserId))
                        .pipe(takeUntilDestroyed(this.destroyRef))
                        .subscribe({
                            next: () => this.fetchNow(),
                            error: (err: unknown) => {
                                console.warn('[NotificationPollingService] user subscription error', err);
                            },
                        });
                }
            });
    }
}
