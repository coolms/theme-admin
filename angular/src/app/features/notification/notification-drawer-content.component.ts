import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    computed,
    inject,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

import {
    CmsItemInteractionsDirective,
    ConfirmDialogService,
    ContextMenuService,
    DrawerService,
    PageToolbarComponent,
    ToastService,
    type CmsRangeSelectionRequest,
    type CmsSelectionChange,
} from '@coolms/ui-angular';
import {
    NotificationApiService,
    type BulkActionResponse,
    type NotificationDto,
    type NotificationLink,
} from './notification-api.service';
import { NotificationPollingService } from './notification-polling.service';
import { NotificationSoundService } from './notification-sound.service';
import { NotificationStore } from './notification-store.service';

/**
 * Notification drawer content -- renders the row list with
 * mailbox-mode interactions, the toolbar surface via
 * `<app-page-toolbar treeSlug="navi.toolbar.notification">`, and
 * dispatches every action id (from toolbar buttons and the
 * right-click context menu alike) through the store's
 * `actionDispatched$` bus into a single switch.
 *
 * Mailbox semantics (Ship B.4, `selectionMode='mailbox'`): plain
 * click activates -- marks read if unread, navigates if `link`
 * is set, and closes the drawer once it navigates. Ctrl/Meta+click
 * toggles a row in selection. Shift+click requests a range; the
 * store computes it against the cached ordered list. Right-click
 * opens the context menu with the row's full record spread into
 * the predicate context so context-only NaviGraph nodes (`open`,
 * `dismiss-single`) can gate on `_hasLink` / `_single`.
 *
 * The admin shell's drawer wrapper renders the "Notifications"
 * title and the close button; this component renders the toolbar,
 * the sound-toggle (local UI state, not a backend action), and the
 * row list.
 *
 * Polling lifecycle stays on the bell component (its `ngOnInit`
 * calls `polling.start()`); the drawer content is mounted and
 * unmounted on every open / close and must not own the start /
 * stop signal.
 */
@Component({
    selector: 'app-notification-drawer-content',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, CmsItemInteractionsDirective, PageToolbarComponent],
    template: `
        <div class="cms-notification-drawer">

            <app-page-toolbar
                treeSlug="navi.toolbar.notification"
                [context]="toolbarContext()"
                [compact]="true"
                (actionClick)="onToolbarAction($event)">
                <button toolbar-right-extra
                        type="button"
                        class="cms-notification-drawer__sound-toggle"
                        [attr.aria-label]="sound.enabled() ? 'Mute notifications' : 'Unmute notifications'"
                        [attr.title]="sound.enabled() ? 'Mute notifications' : 'Unmute notifications'"
                        (click)="toggleSound()">
                    <i [class]="sound.enabled() ? 'bi bi-bell-fill' : 'bi bi-bell-slash'"></i>
                </button>
            </app-page-toolbar>

            <div class="cms-notification-drawer__list"
                 #listContainer
                 (scroll)="onListScroll()">
                @if (store.notifications().length === 0) {
                    <div class="cms-notification-drawer__empty">
                        No notifications
                    </div>
                } @else {
                    @for (n of store.notifications(); track n.id) {
                        <div class="cms-notification-row"
                             [class.cms-notification-row--unread]="!n.isRead"
                             [class.cms-notification-row--selected]="store.selectedIds().has(n.id)"
                             [class.cms-notification-row--flash]="store.flashingIds().has(n.id)"
                             cmsItemInteractions
                             [cmsItem]="n"
                             selectionMode="mailbox"
                             [currentSelection]="store.selectedItems()"
                             [rangeAnchor]="store.rangeAnchor()"
                             (selectionChanged)="onSelectionChanged($event)"
                             (rangeSelectionRequested)="onRangeRequested($event)"
                             (activated)="onActivate(n)"
                             (contextMenuRequested)="onContextMenu($event)">

                            <div class="cms-notification-row__primary d-flex align-items-start">
                                <div class="flex-grow-1 me-2" style="min-width: 0">
                                    <div class="small fw-semibold text-truncate">
                                        {{ displayTitle(n) }}
                                    </div>
                                    <div class="text-muted" style="font-size: .7rem">
                                        {{ n.createdAt | date:'short' }}
                                    </div>
                                    @if (extrasName(n); as name) {
                                        <div class="text-truncate"
                                             style="font-size: .8rem; margin-top: 2px">
                                            {{ name }}
                                        </div>
                                    }
                                </div>

                                @if (hasExpandable(n)) {
                                    <button type="button"
                                            class="btn btn-sm btn-link text-muted p-0 flex-shrink-0 me-2"
                                            [attr.title]="chevronTitle(n)"
                                            [attr.aria-label]="chevronTitle(n)"
                                            (click)="onChevronClick(n, $event)">
                                        <i [class]="chevronIcon(n)" style="font-size: .85rem"></i>
                                    </button>
                                }

                                <button type="button"
                                        class="btn btn-sm btn-link text-muted p-0 flex-shrink-0 me-2"
                                        [attr.title]="n.isRead ? 'Mark as unread' : 'Mark as read'"
                                        [attr.aria-label]="n.isRead ? 'Mark as unread' : 'Mark as read'"
                                        (click)="onEnvelopeClick(n, $event)">
                                    <i [class]="n.isRead ? 'bi bi-envelope-open' : 'bi bi-envelope-fill'"
                                       style="font-size: 1rem"></i>
                                </button>
                                <button type="button"
                                        class="btn btn-sm btn-link text-muted p-0 flex-shrink-0"
                                        title="Dismiss"
                                        (click)="onDismissClick(n, $event)">
                                    <i class="bi bi-x" style="font-size: 1rem"></i>
                                </button>
                            </div>

                            @if (hasBody(n) && store.expandedId() === n.id) {
                                <div class="cms-notification-row__body"
                                     [class.cms-notification-row__body--clickable]="hasLink(n)"
                                     (click)="onBodyClick(n, $event)">{{ renderedBody(n) }}</div>
                            }
                        </div>
                    }

                    @if (store.loadingMore()) {
                        <div class="cms-notification-drawer__loading-more">
                            <i class="bi bi-arrow-clockwise cms-notification-drawer__spin"></i>
                            Loading more...
                        </div>
                    } @else if (!store.hasMore()) {
                        <div class="cms-notification-drawer__end">No more notifications</div>
                    }
                }
            </div>

        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }
        .cms-notification-drawer {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }
        /* 1px hairline below the compact toolbar gives the action row a
           visual boundary against the list without reserving an extra
           padded band. The wrapper's p-3 supplies the top padding; the
           negative margin halves it so the gap above the toolbar
           roughly matches the gap below (padding-bottom .25rem + list
           margin-top .25rem ~= .5rem). */
        .cms-notification-drawer app-page-toolbar {
            display: block;
            margin-top: -.5rem;
            border-bottom: 1px solid var(--cms-border);
            padding-bottom: .25rem;
        }
        .cms-notification-drawer__sound-toggle {
            background: transparent;
            border: 0;
            padding: 0;
            color: var(--cms-text-muted, #6c757d);
            font-size: .85rem;
            line-height: 1;
            cursor: pointer;
        }
        .cms-notification-drawer__sound-toggle:hover {
            color: var(--cms-primary, #0d6efd);
        }
        .cms-notification-drawer__list {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            /* Negative horizontal margin lets rows reach the drawer's
               outer edge while the wrapper's p-3 padding pads the rest. */
            margin: 0 -1rem;
            /* Tight coupling to the hairline above the list. */
            margin-top: .25rem;
        }
        .cms-notification-drawer__empty {
            text-align: center;
            color: var(--cms-text-muted, #6c757d);
            font-size: .8rem;
            padding: 2rem 1rem;
        }
        .cms-notification-row {
            cursor: pointer;
            padding: .5rem 1rem;
            border-bottom: 1px solid var(--cms-border);
            transition: background-color .15s ease-out;
            user-select: none;
        }
        .cms-notification-row:hover {
            background-color: rgba(0, 0, 0, .03);
        }
        .cms-notification-row--unread {
            background-color: rgba(13, 110, 253, .04);
        }
        .cms-notification-row--unread .fw-semibold {
            color: var(--cms-primary, #0d6efd);
        }
        .cms-notification-row--selected {
            background-color: var(--cms-accent-light);
            border-left: 3px solid var(--cms-accent);
            padding-left: calc(1rem - 3px);
        }
        .cms-notification-row__body {
            margin: .5rem 0 .25rem 0;
            padding: .5rem .75rem;
            background: var(--cms-surface-muted, #f8f9fa);
            border-left: 2px solid var(--cms-border);
            border-radius: 0 var(--cms-radius) var(--cms-radius) 0;
            font-size: .8rem;
            line-height: 1.5;
            color: var(--cms-text);
            white-space: pre-wrap;
            word-break: break-word;
            /* Override the row's user-select: none for copyable body
               content; shift-click selection still works on the row
               primary because the body is below it. */
            user-select: text;
        }
        .cms-notification-row__body--clickable {
            cursor: pointer;
        }
        .cms-notification-row__body--clickable:hover {
            background: var(--cms-accent-light);
        }
        .cms-notification-drawer__loading-more,
        .cms-notification-drawer__end {
            text-align: center;
            padding: 1rem;
            color: var(--cms-text-muted);
            font-size: .75rem;
        }
        .cms-notification-drawer__spin {
            display: inline-block;
            animation: cms-notification-drawer-spin 1s linear infinite;
            margin-right: .375rem;
        }
        @keyframes cms-notification-drawer-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes coolms-notification-drawer-flash {
            0% { background-color: var(--cms-accent-light); }
            100% { background-color: transparent; }
        }
        .cms-notification-row--flash {
            animation: coolms-notification-drawer-flash 2s ease-out;
        }
    `],
})
export class NotificationDrawerContentComponent {
    protected readonly store = inject(NotificationStore);
    protected readonly sound = inject(NotificationSoundService);
    private readonly api = inject(NotificationApiService);
    private readonly polling = inject(NotificationPollingService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly router = inject(Router);
    private readonly drawer = inject(DrawerService);
    private readonly confirmDialog = inject(ConfirmDialogService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly listContainer = viewChild<ElementRef<HTMLElement>>('listContainer');

    protected readonly toolbarContext = computed<Record<string, unknown>>(() => ({
        _surface: 'toolbar',
        _kind: 'notification',
        _selectionCount: this.store.selectionCount(),
        // `_single` gates the bulk-action surface: nodes with
        // `_single eq false` only render at 2+ selections, so a
        // single right-click (which the directive normalizes to
        // selectionCount=1 via applyRightClick) cannot trigger bulk
        // buttons in the toolbar.
        _single: this.store.selectionCount() <= 1,
        _hasUnread: this.store.hasUnread(),
        _hasUnreadInSelection: this.store.hasUnreadInSelection(),
        _hasReadInSelection: this.store.hasReadInSelection(),
        // Ship Q -- `_hasAny` gates the `clear-all` button so the
        // toolbar hides it on an empty inbox.
        _hasAny: this.store.notifications().length > 0,
        // No focused row on the toolbar surface -- listed for predicate
        // parity with the context record so future toolbar nodes can
        // reference the same names without an undefined-field gotcha.
        _hasLink: false,
        _hasBody: false,
        _hasExpandable: false,
    }));

    constructor() {
        this.store.actionDispatched$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((action) => this.onToolbarAction(action));
    }

    /**
     * Row header text. Prefers `extras.title` when present (B.6
     * manual-send dialog + future publishers that follow the
     * convention) and falls back to the opaque `type` string for
     * legacy rows that predate the title convention.
     */
    protected displayTitle(n: NotificationDto): string {
        const title = n.extras?.['title'];
        if (typeof title === 'string' && title.length > 0) {
            return title;
        }
        return n.type;
    }

    /**
     * Pick a displayable detail from the notification's `extras`
     * field. The `name` key is the convention established by the
     * Document adopter (Sub-phase G); other adopters that follow the
     * same convention surface here without changes.
     */
    protected extrasName(n: NotificationDto): string | null {
        const raw = n.extras?.['name'];
        return typeof raw === 'string' && raw.length > 0 ? raw : null;
    }

    /**
     * Robust link presence check. API Platform's default normalization
     * omits null fields from JSON; even with the resource-level
     * `skip_null_values: false` flag flipped, the frontend should not
     * trust the field to be exactly `null` or a fully-shaped object.
     * Requires a non-null object with a non-empty `href` string.
     */
    protected hasLink(n: NotificationDto): boolean {
        const l = n.link;
        if (l === null || l === undefined) {
            return false;
        }
        if (typeof l !== 'object') {
            return false;
        }
        const href = (l).href;
        return typeof href === 'string' && href.length > 0;
    }

    /**
     * Body accessor used by the chevron / Open visibility predicate.
     * The body field is not part of the core DTO; consumers surface
     * it via the `body` key on `extras`. Returns true when a
     * non-empty string lives at that location.
     */
    protected hasBody(n: NotificationDto): boolean {
        const body = n.extras?.['body'];
        return typeof body === 'string' && body.length > 0;
    }

    protected hasExpandable(n: NotificationDto): boolean {
        return this.hasLink(n) || this.hasBody(n);
    }

    /**
     * Ship Q -- threshold of ~100px from the bottom triggers the
     * next backward-pagination fetch. The store guards against
     * concurrent loads and end-of-history, so a fast scrubber that
     * fires this handler many times is safe.
     */
    protected onListScroll(): void {
        const el = this.listContainer()?.nativeElement;
        if (!el) {
            return;
        }
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 100) {
            this.store.loadMore();
        }
    }

    protected onSelectionChanged(e: CmsSelectionChange<NotificationDto>): void {
        const ids = e.selection.map((n) => n.id);
        this.store.selectSet(ids);
    }

    protected onRangeRequested(e: CmsRangeSelectionRequest<NotificationDto>): void {
        this.store.selectRange(e.from, e.to, e.modifier);
    }

    /**
     * Activation (dblclick + chevron click on link-only + context
     * menu Open). Body rows expand instead of navigating, so the
     * navigation branch fires only when there is no body. First
     * expand also marks the row read; the mark-read fires before
     * any branch so navigation paths stay consistent.
     */
    protected onActivate(n: NotificationDto): void {
        if (!n.isRead) {
            this.markReadAsync(n);
        }

        if (this.hasBody(n)) {
            // Idempotent: setExpanded on the already-expanded row is
            // a no-op, so context-menu Open on an open row does not
            // collapse it.
            if (this.store.expandedId() !== n.id) {
                this.store.setExpanded(n.id);
            }
            return;
        }

        const link = n.link;
        if (this.hasLink(n) && link) {
            this.navigateLink(link);
            this.drawer.close();
        }
    }

    protected onContextMenu(payload: { item: NotificationDto; event: MouseEvent }): void {
        const focused = payload.item;
        this.store.setFocused(focused.id);

        const single = this.store.selectionCount() <= 1;
        const hasLink = this.hasLink(focused);
        const hasBody = this.hasBody(focused);
        const record: Record<string, unknown> = {
            _surface: 'context',
            _kind: 'notification',
            _selectionCount: this.store.selectionCount(),
            _hasUnread: this.store.hasUnread(),
            _hasUnreadInSelection: this.store.hasUnreadInSelection(),
            _hasReadInSelection: this.store.hasReadInSelection(),
            _single: single,
            _hasLink: hasLink,
            _hasBody: hasBody,
            _hasExpandable: hasLink || hasBody,
            ...focused,
        };

        this.contextMenu.openFromNodes(
            payload.event,
            this.store.toolbarNodes(),
            record,
            (action) => this.store.dispatchAction(action),
        );
    }

    protected onToolbarAction(actionId: string): void {
        switch (actionId) {
            case 'mark-all-read':
                this.markAllRead();
                return;

            case 'clear-all':
                this.confirmAndClearAll();
                return;

            case 'mark-read':
                this.runReadToggle(false);
                return;

            case 'mark-unread':
                this.runReadToggle(true);
                return;

            case 'dismiss':
                this.runDismiss();
                return;

            case 'open': {
                const f = this.store.focusedItem();
                if (f) {
                    this.onActivate(f);
                }
                return;
            }
        }
    }

    /**
     * Chevron click. For rows with body, the chevron is the expand
     * toggle; collapse on second click. For link-only rows, the
     * chevron is the navigate affordance and delegates to
     * `onActivate`. First expand marks the row read.
     *
     * stopPropagation keeps the row's selection-replace click from
     * firing alongside the chevron action.
     */
    protected onChevronClick(n: NotificationDto, event: Event): void {
        event.stopPropagation();
        if (this.hasBody(n)) {
            const wasExpanded = this.store.expandedId() === n.id;
            this.store.toggleExpanded(n.id);
            if (!wasExpanded && !n.isRead) {
                this.markReadAsync(n);
            }
            return;
        }
        this.onActivate(n);
    }

    /**
     * Body click. Navigates when the row has a link; otherwise the
     * body remains a copyable plain-text block (user-select: text on
     * `__body`). First click also marks the row read when the body
     * navigates.
     */
    protected onBodyClick(n: NotificationDto, event: Event): void {
        event.stopPropagation();
        if (!this.hasLink(n)) {
            return;
        }
        if (!n.isRead) {
            this.markReadAsync(n);
        }
        const link = n.link;
        if (link) {
            this.navigateLink(link);
            this.drawer.close();
        }
    }

    protected chevronIcon(n: NotificationDto): string {
        if (this.hasBody(n)) {
            return this.store.expandedId() === n.id
                ? 'bi bi-chevron-down'
                : 'bi bi-chevron-right';
        }
        return 'bi bi-chevron-right';
    }

    protected chevronTitle(n: NotificationDto): string {
        if (this.hasBody(n)) {
            return this.store.expandedId() === n.id ? 'Collapse' : 'Expand';
        }
        return 'Open';
    }

    protected getBody(n: NotificationDto): string {
        const body = n.extras?.['body'];
        return typeof body === 'string' ? body : '';
    }

    protected bodyFormat(n: NotificationDto): 'plain' | 'markdown' | 'dtmpl' {
        const fmt = n.extras?.['bodyFormat'];
        if (fmt === 'markdown' || fmt === 'dtmpl' || fmt === 'plain') {
            return fmt;
        }
        return 'plain';
    }

    /**
     * Returns the body string formatted for the current renderer.
     * This ship renders only `plain`; `markdown` and `dtmpl` fall
     * back to plain text with a one-time dev console warning so the
     * unimplemented renderer is visible during development without
     * spamming the console on every row paint.
     */
    protected renderedBody(n: NotificationDto): string {
        const fmt = this.bodyFormat(n);
        if (fmt !== 'plain') {
            this.warnOnceForFormat(fmt);
        }
        return this.getBody(n);
    }

    private markReadAsync(n: NotificationDto): void {
        this.api.markRead(n.id).subscribe({
            next: (updated) => this.store.updateOne(updated),
            error: (err: unknown) =>
                console.warn('[NotificationDrawer] mark-read failed', err),
        });
    }

    private readonly warnedFormats = new Set<string>();

    private warnOnceForFormat(format: string): void {
        if (this.warnedFormats.has(format)) {
            return;
        }
        this.warnedFormats.add(format);
        console.warn(
            `[NotificationDrawer] '${format}' body format not yet rendered; falling back to plain text.`,
        );
    }

    onDismissClick(n: NotificationDto, event: Event): void {
        event.stopPropagation();
        this.api.dismiss(n.id).subscribe({
            next: () => this.store.removeOne(n.id),
            error: (err: unknown) => console.warn('[NotificationDrawer] dismiss failed', err),
        });
    }

    onEnvelopeClick(n: NotificationDto, event: Event): void {
        event.stopPropagation();
        const call = n.isRead
            ? this.api.markUnread(n.id)
            : this.api.markRead(n.id);
        call.subscribe({
            next: (updated) => this.store.updateOne(updated),
            error: (err: unknown) => console.warn('[NotificationDrawer] mark toggle failed', err),
        });
    }

    markAllRead(): void {
        this.api.readAll().subscribe({
            next: () => this.polling.fetchNow(),
            error: (err: unknown) => console.warn('[NotificationDrawer] read-all failed', err),
        });
    }

    /**
     * Ship Q -- "Clear all" toolbar action. Confirms via the
     * canonical `ConfirmDialogService` (no-op on cancel), then
     * fires `/api/v1/notifications/_bulk/dismiss-all` and refreshes
     * the drawer through the polling service. Selection clears
     * implicitly via the refetch.
     */
    private confirmAndClearAll(): void {
        this.confirmDialog
            .open({
                title: 'Clear all notifications?',
                message: 'All notifications will be dismissed and removed from the drawer.',
                confirmLabel: 'Clear all',
                danger: true,
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((confirmed) => {
                if (!confirmed) {
                    return;
                }
                this.api.dismissAll()
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe({
                        next: () => {
                            this.toast.success('All notifications cleared.');
                            this.polling.fetchNow();
                        },
                        error: (err: Error) => {
                            this.toast.error(err.message || 'Failed to clear notifications.');
                        },
                    });
            });
    }

    toggleSound(): void {
        this.sound.toggle();
    }

    private navigateLink(link: NotificationLink): void {
        if (link.kind === 'route') {
            void this.router.navigateByUrl(link.href);
            return;
        }
        const target = link.target ?? '_blank';
        if (target === '_self') {
            window.location.href = link.href;
        } else {
            window.open(link.href, '_blank', 'noopener');
        }
    }

    /**
     * Route a read / unread toggle for the current selection. One-id
     * selections hit the per-id endpoint to preserve the single-action
     * audit trail; two-or-more selections hit the `_bulk` endpoint.
     */
    private runReadToggle(toUnread: boolean): void {
        const ids = Array.from(this.store.selectedIds());
        if (ids.length === 0) {
            return;
        }
        if (ids.length === 1) {
            const call = toUnread ? this.api.markUnread(ids[0]) : this.api.markRead(ids[0]);
            call.subscribe({
                next: (updated) => this.store.updateOne(updated),
                error: (err: unknown) =>
                    console.warn('[NotificationDrawer] mark toggle failed', err),
            });
            return;
        }
        const call = toUnread ? this.api.markUnreadBulk(ids) : this.api.markReadBulk(ids);
        this.runBulk(call);
    }

    private runDismiss(): void {
        const ids = Array.from(this.store.selectedIds());
        if (ids.length === 0) {
            return;
        }
        if (ids.length === 1) {
            const id = ids[0];
            this.api.dismiss(id).subscribe({
                next: () => this.store.removeOne(id),
                error: (err: unknown) =>
                    console.warn('[NotificationDrawer] dismiss failed', err),
            });
            return;
        }
        this.runBulk(this.api.dismissBulk(ids));
    }

    private runBulk(call: Observable<BulkActionResponse>): void {
        call.subscribe({
            next: () => {
                this.store.selectClear();
                this.polling.fetchNow();
            },
            error: (err: unknown) =>
                console.warn('[NotificationDrawer] bulk action failed', err),
        });
    }
}
