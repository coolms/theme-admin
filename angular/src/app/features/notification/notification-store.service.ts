import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { NaviGraphService, NaviGraphNode, AppConfigState } from '@coolms/core-angular';
import { NotificationApiService, type NotificationDto } from './notification-api.service';
import { NotificationSoundService } from './notification-sound.service';

const FLASH_DURATION_MS = 2_000;

const PAGE_SIZE = 20;

/**
 * Notification Sub-phase E -- signal-based store of the bell's
 * authoritative view of the most-recent notifications and the
 * current unread count. Mutates from polling fetches and from
 * individual mark-read / dismiss responses.
 *
 * Ship B.4 widened the store with the drawer's mailbox-mode
 * selection state, an action-dispatch bus shared by the toolbar
 * and the right-click context menu, and a self-loaded
 * `navi.toolbar.notification` tree cached at root scope so the
 * drawer's `app-page-toolbar` resolves synchronously on every
 * mount. Selection persists across drawer re-mounts because the
 * store is `providedIn: 'root'`.
 *
 * `flashingIds` carries the ids that should currently render the
 * 2-second accent flash (matching the DataGrid and VFS Sub-phase
 * C row-flash pattern). The id leaves the set on a timer; the
 * bell component reads it through a `computed` style binding.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
    private readonly sound = inject(NotificationSoundService);
    private readonly naviGraph = inject(NaviGraphService);
    private readonly appStore = inject(Store);
    private readonly api = inject(NotificationApiService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly _notifications = signal<NotificationDto[]>([]);
    private readonly _unreadCount = signal<number>(0);
    private readonly _flashingIds = signal<ReadonlySet<string>>(new Set());
    private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());
    private readonly _focusedId = signal<string | null>(null);
    private readonly _expandedId = signal<string | null>(null);
    private readonly _loadingMore = signal<boolean>(false);
    private readonly _hasMore = signal<boolean>(true);

    readonly notifications = this._notifications.asReadonly();
    readonly unreadCount = this._unreadCount.asReadonly();
    readonly flashingIds = this._flashingIds.asReadonly();
    readonly selectedIds = this._selectedIds.asReadonly();
    readonly expandedId = this._expandedId.asReadonly();
    readonly loadingMore = this._loadingMore.asReadonly();
    readonly hasMore = this._hasMore.asReadonly();

    readonly hasUnread = computed(() => this._unreadCount() > 0);

    readonly selectionCount = computed(() => this._selectedIds().size);
    readonly hasSelection = computed(() => this._selectedIds().size > 0);

    /**
     * Anchor for range selection: the most recently added id in the
     * current selection, resolved against the ordered notifications
     * list so it has a position to compute ranges from. Null when
     * selection is empty.
     */
    readonly rangeAnchor = computed<NotificationDto | null>(() => {
        const ids = this._selectedIds();
        if (ids.size === 0) {
            return null;
        }
        let last = '';
        for (const id of ids) {
            last = id;
        }
        return this._notifications().find((n) => n.id === last) ?? null;
    });

    readonly selectedItems = computed<NotificationDto[]>(() =>
        this._notifications().filter((n) => this._selectedIds().has(n.id)),
    );

    readonly hasUnreadInSelection = computed(() =>
        this.selectedItems().some((n) => !n.isRead),
    );
    readonly hasReadInSelection = computed(() =>
        this.selectedItems().some((n) => n.isRead),
    );

    readonly focusedItem = computed<NotificationDto | null>(() => {
        const id = this._focusedId();
        if (id === null) {
            return null;
        }
        return this._notifications().find((n) => n.id === id) ?? null;
    });

    /**
     * Pre-loaded `navi.toolbar.notification` tree. Cached here so the
     * drawer's `<app-page-toolbar>` resolves synchronously on every
     * mount and right-click context-menu openers can hand the same
     * nodes to `ContextMenuService.openFromNodes` without a fetch
     * race. Mirrors the `DocumentPageStateService` pattern.
     */
    readonly toolbarNodes = signal<NaviGraphNode[]>([]);

    /**
     * Single channel for action ids dispatched from either the
     * toolbar buttons or the right-click context menu. The drawer
     * component subscribes once and funnels both paths through a
     * single switch.
     */
    readonly actionDispatched$ = new Subject<string>();

    constructor() {
        const pattern = this.appStore.selectSnapshot(AppConfigState.manifest)?.navi?.graphBySlug;
        if (pattern) {
            const url = pattern.replace('{slug}', 'navi.toolbar.notification');
            this.naviGraph
                .loadTree(url)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe((nodes) => this.toolbarNodes.set(nodes));
        }
    }

    /**
     * Replace the cached list. Ids that weren't present in the
     * previous snapshot are flashed (the only path that produces
     * a flash; per-row updates after mark-read do not flash). New
     * arrivals also trigger the audio ding through
     * `NotificationSoundService`, which handles enable + throttle
     * internally so the store does not need to gate the call.
     *
     * Selection is not auto-cleared on refetch: ids that disappear
     * from the list silently drop out of `selectedItems` via the
     * computed's filter; a subsequent bulk action against a stale
     * id returns `not_found` per the Ship A.1 bulk endpoint
     * contract, which the refetch then reconciles.
     */
    setNotifications(list: NotificationDto[]): void {
        const previousIds = new Set(this._notifications().map((n) => n.id));
        const newArrivalIds = list.filter((n) => !previousIds.has(n.id)).map((n) => n.id);
        this._notifications.set(list);
        if (newArrivalIds.length > 0) {
            this.flashIds(newArrivalIds);
            void this.sound.ding();
        }
        // Drop expansion when the expanded row is no longer in the
        // list (refetch removed it).
        const expanded = this._expandedId();
        if (expanded !== null && !list.some((n) => n.id === expanded)) {
            this._expandedId.set(null);
        }
        // Ship Q -- a full refresh resets the pagination cursor.
        // `_hasMore` flips on when the page is full and off when
        // fewer rows came back than the page size (no older history
        // beyond the current view).
        this._hasMore.set(list.length >= PAGE_SIZE);
    }

    /**
     * Append older notifications loaded via the drawer's
     * infinite-scroll. Deduplicates by id; never flashes or dings
     * (those signals are reserved for new arrivals at the top of
     * the inbox, not backfilled history).
     */
    appendNotifications(list: NotificationDto[]): void {
        if (list.length === 0) {
            this._hasMore.set(false);
            this._loadingMore.set(false);
            return;
        }
        const existingIds = new Set(this._notifications().map((n) => n.id));
        const fresh = list.filter((n) => !existingIds.has(n.id));
        if (fresh.length > 0) {
            this._notifications.update((curr) => [...curr, ...fresh]);
        }
        // Page-size heuristic for end-of-history detection: a short
        // page means the server had nothing older to send.
        if (list.length < PAGE_SIZE) {
            this._hasMore.set(false);
        }
        this._loadingMore.set(false);
    }

    /**
     * Ship Q -- fire the next backward-pagination fetch. No-ops
     * when a load is in flight, when the server has signalled
     * end-of-history, or when the cached list is empty (the
     * initial load handles that case). The oldest cached row's
     * `createdAt` becomes the upper bound via the RQL expression
     * `createdAt lt <iso>`; future search / type / unread filters
     * compose onto the same `filter` parameter.
     */
    loadMore(): void {
        if (this._loadingMore() || !this._hasMore()) {
            return;
        }
        const list = this._notifications();
        if (list.length === 0) {
            return;
        }
        const oldest = list[list.length - 1].createdAt;
        this._loadingMore.set(true);
        this.api.list({ filter: `createdAt lt ${oldest}`, limit: PAGE_SIZE })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (rows) => this.appendNotifications(rows),
                error: (err: unknown) => {
                    console.warn('[NotificationStore] loadMore failed', err);
                    this._loadingMore.set(false);
                },
            });
    }

    setUnreadCount(count: number): void {
        this._unreadCount.set(count);
    }

    /**
     * Replace a single cached notification by id. Used after
     * mark-read / mark-unread / undismiss returns the updated
     * row -- avoids a full refetch round-trip.
     *
     * Sub-phase S -- locally adjust `_unreadCount` based on the
     * read-state transition so the badge reflects the click
     * immediately. The next push ping or polling tick reconciles
     * with server-truth; `Math.max(0, ...)` keeps the count
     * non-negative if reconciliation lags and an extra mutation
     * slips through.
     */
    updateOne(updated: NotificationDto): void {
        const previous = this._notifications().find((n) => n.id === updated.id);
        this._notifications.update((list) =>
            list.map((n) => (n.id === updated.id ? updated : n)),
        );
        if (previous === undefined) {
            return;
        }
        if (!previous.isRead && updated.isRead) {
            this._unreadCount.update((c) => Math.max(0, c - 1));
        } else if (previous.isRead && !updated.isRead) {
            this._unreadCount.update((c) => c + 1);
        }
    }

    /**
     * Drop a single cached notification by id. Used after dismiss
     * succeeds -- dismissed rows are not part of the bell view.
     *
     * Sub-phase S -- decrement `_unreadCount` if the removed row
     * was unread so the badge reflects the dismiss immediately.
     * Ship B.4 -- also drop the id from selection so the
     * `selectedIds` set never references rows that no longer
     * exist in the cached list.
     */
    removeOne(id: string): void {
        const removed = this._notifications().find((n) => n.id === id);
        this._notifications.update((list) => list.filter((n) => n.id !== id));
        if (removed !== undefined && !removed.isRead) {
            this._unreadCount.update((c) => Math.max(0, c - 1));
        }
        if (this._selectedIds().has(id)) {
            this._selectedIds.update((set) => {
                const next = new Set(set);
                next.delete(id);
                return next;
            });
        }
        if (this._expandedId() === id) {
            this._expandedId.set(null);
        }
    }

    selectReplace(item: NotificationDto): void {
        this._selectedIds.set(new Set([item.id]));
    }

    selectToggle(item: NotificationDto): void {
        this._selectedIds.update((set) => {
            const next = new Set(set);
            if (next.has(item.id)) {
                next.delete(item.id);
            } else {
                next.add(item.id);
            }
            return next;
        });
    }

    selectRange(
        from: NotificationDto,
        to: NotificationDto,
        modifier: 'replace' | 'add',
    ): void {
        const list = this._notifications();
        const fromIdx = list.findIndex((n) => n.id === from.id);
        const toIdx = list.findIndex((n) => n.id === to.id);
        if (fromIdx < 0 || toIdx < 0) {
            return;
        }
        const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeIds = list.slice(lo, hi + 1).map((n) => n.id);
        this._selectedIds.update((set) => {
            const next = modifier === 'replace' ? new Set<string>() : new Set(set);
            for (const id of rangeIds) {
                next.add(id);
            }
            return next;
        });
    }

    selectClear(): void {
        this._selectedIds.set(new Set());
    }

    selectSet(ids: ReadonlyArray<string>): void {
        this._selectedIds.set(new Set(ids));
    }

    /**
     * Pin a specific row's id as the right-click focused row for the
     * duration of the context-menu interaction. The directive's
     * `applyRightClick` already aligns selection when the click lands
     * outside the current set; `_focusedId` is the orthogonal hook
     * for context-only nodes (`open`, `dismiss-single`) that need a
     * single row regardless of how big the selection is.
     */
    setFocused(id: string | null): void {
        this._focusedId.set(id);
    }

    dispatchAction(action: string): void {
        this.actionDispatched$.next(action);
    }

    /**
     * Toggle body expansion for a row. Single-expand semantics:
     * expanding a different row implicitly collapses the previous
     * one (the field holds a single id, not a Set). Re-toggling the
     * expanded row collapses it.
     */
    toggleExpanded(id: string): void {
        this._expandedId.update((curr) => (curr === id ? null : id));
    }

    setExpanded(id: string): void {
        this._expandedId.set(id);
    }

    clearExpanded(): void {
        this._expandedId.set(null);
    }

    private flashIds(ids: readonly string[]): void {
        this._flashingIds.update((set) => {
            const next = new Set(set);
            for (const id of ids) {
                next.add(id);
            }
            return next;
        });
        setTimeout(() => {
            this._flashingIds.update((set) => {
                const next = new Set(set);
                for (const id of ids) {
                    next.delete(id);
                }
                return next;
            });
        }, FLASH_DURATION_MS);
    }
}
