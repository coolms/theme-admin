import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit,
    computed, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { EMPTY, catchError, debounceTime, distinctUntilChanged, filter, fromEvent, interval, merge, switchMap, timer } from 'rxjs';
import { AppConfigState, AuthState } from '@coolms/core-angular';
import {
    DateTimeFormatService,
    DateTimePipe,
    DayGroup,
    groupByDay,
    UserAvatarComponent,
    UserSearchSelectComponent,
} from '@coolms/ui-angular';
import { avatarUserFor, ChatAvatarUser } from './chat-avatar.util';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { conversationLabel, presenceDot, unreadFor } from './conversation-row.util';
import { advanceReadOverride, mayMarkRead } from './mark-read.util';
import { firstInboxPage, InboxPage, nextInboxPage, refreshWindow } from './inbox-paging.util';
import { MessagesService } from './messages.service';
import { ChatRoomNudge, MessagesLiveEventsService } from './messages-live-events.service';
import { ChatConversationDto, ChatMessageDto } from './messages.types';

/**
 * Messages quick-panel — the right-drawer content for the topbar
 * chat launcher ({@link MessagesQuickAccessComponent}), mirroring the Calendar
 * quick-panel pattern (). Two modes:
 *  - LIST: the current user's conversations (labeled by counterpart, live online
 *    dot , unread badge ) + a ＋New picker that opens a 1:1 DM ([]).
 *  - THREAD: tap a row to read + reply INLINE without leaving the page —
 *    recent messages + a quick composer + realtime ([]) + mark-read ([]).
 *    A ↗ button still jumps to the full `/admin/messages` view (the rich composer,
 *    attachments, emoji live there). The {@link DrawerService} auto-closes on
 *    `NavigationEnd`, so the jump closes the drawer for free.
 */
@Component({
    selector: 'app-messages-quick-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserSearchSelectComponent, UserAvatarComponent, DateTimePipe],
    template: `
        <div class="mqp">
            @if (openId()) {
                <!-- THREAD mode: read + reply inline. -->
                <div class="mqp__thead">
                    <button type="button" class="mqp__icon" (click)="back()" aria-label="Back">
                        <i class="bi bi-arrow-left"></i>
                    </button>
                    <app-user-avatar size="sm" [user]="rowAvatar(selectedConv())" [status]="rowStatus(selectedConv())" />
                    <span class="mqp__thead-name">{{ counterpartName(selectedConv()) }}</span>
                    <button type="button" class="mqp__icon" (click)="openFull()" title="Open in full view" aria-label="Open in full view">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </button>
                </div>

                <div #threadScroll class="mqp__msgs" (scroll)="onThreadScroll()">
                    @if (loadingOlder()) {
                        <p class="mqp__hint mqp__hint--older">Loading earlier…</p>
                    }
                    @if (threadLoading()) {
                        <p class="mqp__hint">Loading…</p>
                    } @else if (threadMessages().length === 0) {
                        <p class="mqp__hint">No messages yet. Say hello 👋</p>
                    }
                    @for (g of dayGroups(); track g.key) {
                        <div class="mqp__daysep">{{ g.label }}</div>
                        @for (m of g.items; track m.id) {
                        <div class="mqp__line" [class.mqp__line--mine]="isMine(m)">
                            <div class="mqp__bubble" [class.mqp__bubble--mine]="isMine(m)">
                                @if (isHtml(m)) {
                                    <span [innerHTML]="m.body"></span>
                                } @else {
                                    {{ m.body }}
                                }
                                <div class="mqp__meta">{{ m.createdAt | appDateTime:'time' }}</div>
                            </div>
                        </div>
                        }
                    }
                </div>

                <div class="mqp__composer">
                    <textarea class="mqp__input" rows="1" placeholder="Reply…"
                              [value]="composerText()"
                              (input)="composerText.set(asValue($event))"
                              (keydown)="onComposerKeydown($event)"></textarea>
                    <button type="button" class="mqp__send" [disabled]="!canSend()" (click)="sendReply()" aria-label="Send">
                        <i class="bi bi-send"></i>
                    </button>
                </div>
            } @else {
                <!-- LIST mode. -->
                <div class="mqp__head">
                    <button type="button" class="mqp__new" (click)="toggleNew()">
                        {{ showNew() ? 'Cancel' : '＋ New message' }}
                    </button>
                </div>

                @if (showNew()) {
                    <div class="mqp__picker">
                        <app-user-search-select
                                [apiUrl]="usersApiUrl()"
                                entityLabel="user"
                                placeholder="Message a user…"
                                extraFilter="isSystem eq false"
                                (valueChange)="onUserPicked($event)" />
                    </div>
                }

                @if (error()) {
                    <p class="mqp__err" (click)="error.set(null)">{{ error() }}</p>
                }

                @if (loading()) {
                    <p class="mqp__hint">Loading…</p>
                } @else if (conversations().length === 0) {
                    <p class="mqp__hint">No conversations yet. Start one with ＋ New message.</p>
                } @else {
                    <ul class="mqp__rows">
                        @for (c of conversations(); track c.id) {
                            <li>
                                <button type="button" class="mqp__row" (click)="open(c.id)">
                                    <app-user-avatar size="sm" [user]="rowAvatar(c)" [status]="rowStatus(c)" />
                                    <span class="mqp__row-name">{{ counterpartName(c) }}</span>
                                    @if (unreadCount(c) > 0) {
                                        <span class="mqp__badge">{{ unreadCount(c) }}</span>
                                    }
                                </button>
                            </li>
                        }
                    </ul>
                    @if (hasMore()) {
                        <!-- Inbox paging: the drawer holds one page, not the
                             whole inbox. Without this the older rows would simply be
                             absent, with nothing on screen saying so. -->
                        <button type="button" class="mqp__more" (click)="loadMore()"
                                [disabled]="loadingMore()">
                            {{ loadingMore() ? 'Loading…' : 'Load more' }}
                        </button>
                    }
                }

                <button type="button" class="mqp__open-full" (click)="openList()">
                    Open Messages <i class="bi bi-box-arrow-up-right"></i>
                </button>
            }
        </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }
        .mqp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .mqp__head { padding: .25rem 0 .6rem; flex-shrink: 0; }
        .mqp__new { width: 100%; border: 0; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); border-radius: var(--cms-radius-md, 8px); padding: .5rem .7rem; font: inherit; font-size: .85rem; cursor: pointer; }
        .mqp__picker { padding: 0 0 .6rem; flex-shrink: 0; }
        .mqp__err { margin: 0 0 .5rem; padding: .45rem .6rem; background: var(--cms-danger-light); color: var(--cms-danger-text); font-size: .8rem; border-radius: var(--cms-radius, 6px); cursor: pointer; }
        .mqp__hint { padding: 1rem .2rem; color: var(--cms-text-secondary, #6b7280); font-size: .85rem; }
        .mqp__rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
        .mqp__row { display: flex; align-items: center; gap: .55rem; width: 100%; text-align: left; border: 0; background: transparent; padding: .55rem .5rem; font: inherit; font-size: .9rem; cursor: pointer; border-radius: var(--cms-radius-md, 8px); color: var(--cms-text, #111827); }
        .mqp__row:hover { background: var(--cms-hover, #f3f4f6); }
        .mqp__row-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mqp__badge { flex: 0 0 auto; min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); font-size: .68rem; font-weight: 700; line-height: 1; }
        /* Inbox "Load more" — sits between the scrolling rows and the
           "Open Messages" footer, so both stay reachable. */
        .mqp__more { flex: 0 0 auto; width: 100%; border: 0; background: transparent; padding: .45rem .5rem; margin-top: .25rem; font: inherit; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius-md, 8px); cursor: pointer; }
        .mqp__more:hover:not(:disabled) { background: var(--cms-hover, #f3f4f6); color: var(--cms-text, #111827); }
        .mqp__more:disabled { cursor: default; opacity: .7; }
        .mqp__open-full { flex-shrink: 0; margin-top: .5rem; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; width: 100%; border: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface); color: var(--cms-text, #111827); border-radius: var(--cms-radius-md, 8px); padding: .5rem .7rem; font: inherit; font-size: .82rem; cursor: pointer; }
        .mqp__open-full:hover { background: var(--cms-hover, #f3f4f6); }

        /* THREAD mode */
        .mqp__thead { display: flex; align-items: center; gap: .5rem; padding: .2rem 0 .6rem; flex-shrink: 0; border-bottom: 1px solid var(--cms-border, #e5e7eb); margin-bottom: .5rem; }
        .mqp__thead-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: .9rem; }
        .mqp__icon { flex: 0 0 auto; border: 0; background: transparent; cursor: pointer; color: var(--cms-text-secondary, #6b7280); font-size: 1rem; padding: .3rem .4rem; border-radius: var(--cms-radius, 6px); }
        .mqp__icon:hover { background: var(--cms-hover, #f3f4f6); color: var(--cms-text, #111827); }
        .mqp__msgs { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: .3rem; padding: .2rem 0; }
        .mqp__line { display: flex; }
        .mqp__line--mine { justify-content: flex-end; }
        .mqp__bubble { max-width: 80%; padding: .4rem .6rem; border-radius: 12px; background: var(--cms-hover, #f3f4f6); color: var(--cms-text, #111827); font-size: .85rem; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
        .mqp__bubble--mine { background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); }
        .mqp__bubble :is(p) { margin: 0; }
        /* Per-bubble timestamp + per-day separator chip — same model as
         * the full Messages thread, scaled to the drawer. */
        .mqp__meta { margin-top: .15rem; font-size: .62rem; line-height: 1; text-align: right; color: var(--cms-text-secondary, #6b7280); font-variant-numeric: tabular-nums; }
        .mqp__bubble--mine .mqp__meta { color: rgba(255, 255, 255, .8); }
        .mqp__daysep { align-self: center; margin: .3rem 0 .1rem; padding: .12rem .55rem; font-size: .64rem; font-weight: 600; color: var(--cms-text-secondary, #6b7280); background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: 999px; }
        .mqp__hint--older { text-align: center; padding: .3rem; }
        .mqp__composer { flex-shrink: 0; display: flex; align-items: flex-end; gap: .4rem; padding-top: .5rem; border-top: 1px solid var(--cms-border, #e5e7eb); }
        .mqp__input { flex: 1 1 auto; resize: none; max-height: 110px; min-height: 38px; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); padding: .45rem .6rem; font: inherit; font-size: .85rem; }
        .mqp__send { flex: 0 0 auto; border: 0; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); border-radius: var(--cms-radius-md, 8px); width: 38px; height: 38px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        .mqp__send:disabled { opacity: .5; cursor: default; }
    `],
})
export class MessagesQuickPanelComponent implements OnInit {
    private readonly api        = inject(MessagesService);
    private readonly live       = inject(MessagesLiveEventsService);
    private readonly presenceLive = inject(ChatPresenceLiveService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly dtf        = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);

    readonly conversations = signal<ChatConversationDto[]>([]);
    readonly loading       = signal(false);
    readonly error         = signal<string | null>(null);
    readonly showNew       = signal(false);

    /**
     * Inbox paging — the drawer used to render EVERY conversation the
     * user had ever joined, and its background refresh re-fetched all of them.
     * A smaller page than the full page's: this is a peek list, not the inbox.
     * The rules (and the page's copy of this state) live in `inbox-paging.util`.
     */
    /**
     * Optimistic read cursors while a mark-read is in flight, keyed by
     * conversation id — the same mechanism the full page uses, so the
     * badge clears on read rather than on the next list refresh.
     */
    private readonly readSeqOverride = signal<Record<string, number>>({});

    private readonly CONV_PAGE = 20;
    readonly hasMore    = signal(false);
    readonly loadingMore = signal(false);
    private convOffset = 0;

    /** The open thread's conversation id, or null in LIST mode. */
    readonly openId         = signal<string | null>(null);
    readonly threadMessages = signal<ChatMessageDto[]>([]);
    readonly threadLoading  = signal(false);
    readonly composerText   = signal('');
    readonly sending        = signal(false);

    /** Thread bucketed into per-day groups for the date separators. */
    readonly dayGroups = computed<DayGroup<ChatMessageDto>[]>(
        () => groupByDay(this.threadMessages(), m => m.createdAt, this.dtf),
    );

    /** Lazy "load earlier" paging — open on the newest page, prepend on scroll-up. */
    private readonly PAGE = 30;
    readonly loadingOlder = signal(false);
    readonly hasMoreOlder = signal(false);

    /** Local high-water seq for the open thread (cursor for incremental refetch). */
    private lastSeq = 0;

    private readonly threadScroll = viewChild<ElementRef<HTMLElement>>('threadScroll');

    /**
     * Connection-derived ONLINE set — the counterparts holding a live
     * realtime connection, polled from `GET /chat/presence`; combined with the
     * self-set status via {@link effectiveStatus} for the avatar dot.
     */
    readonly presencePolled = signal<ReadonlySet<string>>(new Set());

    /**
     * PUSHED — the shared `presence.chat` channel, held open by the
     * topbar for the whole session. {@link presencePolled} is the fallback for a
     * client whose socket is down.
     */
    readonly presenceOnline = computed<ReadonlySet<string>>(
        () => (this.presenceLive.live() ? this.presenceLive.online() : this.presencePolled()),
    );

    /** Fallback re-poll cadence, used only while push is unavailable. */
    private readonly PRESENCE_POLL_MS = 20_000;

    /** Fallback list-refresh cadence — used ONLY while realtime is down. */
    private readonly LIST_POLL_MS = 20_000;

    readonly usersApiUrl = computed<string>(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? '';
    });

    /** The conversation currently open in THREAD mode (null in LIST mode). */
    readonly selectedConv = computed<ChatConversationDto | null>(() =>
        this.conversations().find(c => c.id === this.openId()) ?? null,
    );

    /** My participant id within the open conversation — marks "my" messages. */
    private readonly myParticipantId = computed<string | null>(() => {
        const me = this.meId;
        return this.selectedConv()?.participants?.find(p => p.userId === me)?.participantId ?? null;
    });

    readonly canSend = computed<boolean>(() =>
        !!this.openId() && this.composerText().trim().length > 0 && !this.sending(),
    );

    private get meId(): string | null {
        return this.store.selectSnapshot(AuthState.currentUser)?.id ?? null;
    }

    constructor() {
        // Online presence poll — re-poll while the drawer is open, and
        // NOT while the tab is hidden: each tick costs the server one
        // Centrifugo round trip per counterpart, for dots nobody is looking at.
        merge(
            interval(this.PRESENCE_POLL_MS).pipe(filter(() => 'hidden' !== document.visibilityState)),
            fromEvent(document, 'visibilitychange').pipe(filter(() => 'hidden' !== document.visibilityState)),
        )
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refreshPresence());

        // Realtime for the OPEN thread: (re)subscribe to its room channel
        // whenever the open conversation changes; refetch new messages on a nudge.
        toObservable(this.openId)
            .pipe(
                switchMap(id => (id === null ? EMPTY : this.live.watchRoom(id))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: nudge => this.onNudge(nudge),
                error: () => { /* realtime down — the thread still loads via REST */ },
            });

        //  The LIST kept whatever `ngOnInit` fetched, for as long as the drawer
        // stayed open. It had neither of the two paths the full page has
        // had/, so a conversation could go on receiving messages
        // with the panel showing a stale preview and a stale unread badge — and a
        // drawer left open all day never noticed. Both paths now:
        //  - my `chat.user.{uid}` channel, debounced, for the live case;
        //  - a poll ONLY while the socket is down, which is what polling is for
        // — the list read is unpaged, so a connected client must not
        //    re-fetch the whole inbox on a timer.
        const me = this.meId;
        merge(
            me ? this.live.watchUser(me).pipe(debounceTime(400), catchError(() => EMPTY)) : EMPTY,
            timer(this.LIST_POLL_MS, this.LIST_POLL_MS).pipe(filter(() => !this.live.isConnected())),
        )
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refreshList());

        // Realtime (re)connect catch-up (, mirroring the page): when the
        // transport comes up — first connect, or a reconnect after the outage the
        // poll above covered — pull the open thread's missed messages once and
        // re-read the list, so a gap can't linger until the next nudge.
        toObservable(this.live.isConnected)
            .pipe(distinctUntilChanged(), filter(connected => connected), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.catchUpOpenThread();
                this.refreshList();
            });
    }

    ngOnInit(): void {
        this.load();
    }

    /** A conversation's label: explicit title, else the other participants. */
    counterpartName(c: ChatConversationDto | null): string {
        // Shared with the page. This copy had no self-notes branch, so
        // the notes room read "Conversation" here and "Notes" there.
        return conversationLabel(c, this.meId);
    }

    /** Unread count for a row — the server's number, else derived. */
    unreadCount(c: ChatConversationDto): number {
        // Shared with the page, including the in-flight override.
        return unreadFor(c, this.meId, this.readSeqOverride()[c.id] ?? 0);
    }

    /** Avatar for a row — counterpart's photo if any, else colored initials. */
    rowAvatar(c: ChatConversationDto | null): ChatAvatarUser {
        const me = this.meId;
        const other = (c?.participants ?? []).find(p => p.userId && p.userId !== me);
        return avatarUserFor(other?.displayName ?? null, other?.userId ?? c?.id ?? null, other?.avatarUrl);
    }

    /** Counterpart's presence dot — connection-online ([]) with away/busy overlaid. */
    rowStatus(c: ChatConversationDto | null): string | null {
        const me = this.meId;
        const other = (c?.participants ?? []).find(p => p.userId && p.userId !== me);
        return this.effectiveStatus(other?.userId, other?.presenceStatus);
    }

    /**
     * Same rule as the full page: `offline`-manual or not-connected -> no dot;
     * connected + away/busy -> that; connected otherwise -> green `online`.
     */
    private effectiveStatus(userId: string | null | undefined, manual: string | null | undefined): string | null {
        // Shared with the page. This copy required a live connection
        // BEFORE honouring a self-set status, so someone who set Busy and closed
        // their tab showed a busy dot on the page and nothing here.
        return presenceDot(userId, manual, this.presenceOnline());
    }

    /**
     * FALLBACK poll of `/chat/presence` for the rows' counterparts; keep the last
     * set on error. A no-op while the pushed channel is live — the poll
     * is the no-realtime path, never a parallel one.
     */
    private refreshPresence(): void {
        if (this.presenceLive.live()) {
            return;
        }
        const me = this.meId;
        const ids = new Set<string>();
        for (const c of this.conversations()) {
            for (const p of c.participants ?? []) {
                if (p.userId && p.userId !== me) {
                    ids.add(p.userId);
                }
            }
        }
        if (ids.size === 0) {
            this.presencePolled.set(new Set());
            return;
        }
        this.api.fetchOnline([...ids]).subscribe({
            next: map => this.presencePolled.set(new Set(Object.keys(map).filter(uid => map[uid]))),
            error: () => { /* presence down — keep the last set, the dots just go stale */ },
        });
    }

    toggleNew(): void {
        this.showNew.update(v => !v);
    }

    onUserPicked(userId: string): void {
        if (!userId) {
            return;
        }
        this.showNew.set(false);
        this.api.openDirect(userId).subscribe({
            next: conv => {
                if (!this.conversations().some(c => c.id === conv.id)) {
                    this.conversations.set([conv, ...this.conversations()]);
                }
                this.open(conv.id);
            },
            error: (err: { status?: number }) =>
                this.error.set(err?.status === 404 ? 'User not found.' : 'Could not start the conversation.'),
        });
    }

    /** Open a thread INLINE in the drawer — load + mark read + subscribe live. */
    open(conversationId: string): void {
        this.openId.set(conversationId);
        this.threadMessages.set([]);
        this.composerText.set('');
        this.lastSeq = 0;
        this.hasMoreOlder.set(false);
        this.loadingOlder.set(false);
        // Marking read happens once the messages ARRIVE (see applyMessages) —
        // not here. At this point `lastSeq` is 0 and the only seq
        // available is the conversation row's, which is the SERVER's high-water:
        // claiming it would mark messages this panel has not fetched, and tell
        // their senders "Read".
        this.loadThread();
    }

    /** Leave the thread back to the list; refresh the list so badges reflect the read. */
    back(): void {
        this.openId.set(null);
        this.threadMessages.set([]);
        this.load();
    }

    /** Jump to the full `/admin/messages` view (the drawer auto-closes on navigation). */
    openFull(): void {
        const id = this.openId();
        void this.router.navigate(['/messages'], id ? { queryParams: { c: id } } : {});
    }

    openList(): void {
        void this.router.navigate(['/messages']);
    }

    isMine(m: ChatMessageDto): boolean {
        const mine = this.myParticipantId();
        return mine !== null && m.senderParticipantId === mine;
    }

    isHtml(m: ChatMessageDto): boolean {
        return m.bodyFormat === 'html' && !!m.body;
    }

    /** Bridge a textarea `(input)` event to its string value (avoids `$any` in template logic). */
    asValue(event: Event): string {
        return (event.target as HTMLTextAreaElement).value;
    }

    /** Enter sends; Shift+Enter / IME composition fall through to a newline. */
    onComposerKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            this.sendReply();
        }
    }

    sendReply(): void {
        const id = this.openId();
        const body = this.composerText().trim();
        if (!id || body === '' || this.sending()) {
            return;
        }
        this.sending.set(true);
        this.api.postMessage(id, body, this.uuid(), 'plain').subscribe({
            next: msg => {
                this.applyMessages([msg]);
                this.composerText.set('');
                this.sending.set(false);
                this.scrollSoon();
            },
            error: () => {
                this.error.set('Could not send your reply.');
                this.sending.set(false);
            },
        });
    }

    private loadThread(): void {
        const id = this.openId();
        if (!id) {
            return;
        }
        this.threadLoading.set(true);
        this.hasMoreOlder.set(false);
        // Open on the newest page; older pages load on scroll-up.
        this.api.listLatest(id, this.PAGE).subscribe({
            next: list => {
                this.applyMessages(list);
                this.threadLoading.set(false);
                this.hasMoreOlder.set(list.length >= this.PAGE);
                this.scrollSoon();
            },
            error: () => { this.error.set('Could not load the conversation.'); this.threadLoading.set(false); },
        });
    }

    /** Scroll-up lazy load — prepend the previous page, preserving the anchor. */
    onThreadScroll(): void {
        const el = this.threadScroll()?.nativeElement;
        if (!el || el.scrollTop > 40) {
            return;
        }
        if (this.hasMoreOlder() && !this.loadingOlder() && !this.threadLoading()) {
            this.loadOlder();
        }
    }

    private loadOlder(): void {
        const id = this.openId();
        const msgs = this.threadMessages();
        if (!id || msgs.length === 0) {
            return;
        }
        const oldestSeq = msgs[0].seq;
        const el = this.threadScroll()?.nativeElement;
        const prevHeight = el?.scrollHeight ?? 0;
        const prevTop = el?.scrollTop ?? 0;
        const prevLen = msgs.length;
        this.loadingOlder.set(true);
        this.api.listBefore(id, oldestSeq, this.PAGE).subscribe({
            next: list => {
                this.applyMessages(list);
                this.loadingOlder.set(false);
                const added = this.threadMessages().length - prevLen;
                this.hasMoreOlder.set(list.length >= this.PAGE && added > 0);
                if (added > 0 && el) {
                    setTimeout(() => { el.scrollTop = prevTop + (el.scrollHeight - prevHeight); }, 0);
                }
            },
            error: () => { this.loadingOlder.set(false); },
        });
    }

    /** A realtime nudge arrived — pull anything past our local high-water. */
    private onNudge(nudge: ChatRoomNudge): void {
        const id = this.openId();
        if (id === null || nudge.conversationId !== id || nudge.type !== 'message.posted' || nudge.seq <= this.lastSeq) {
            return;
        }
        this.api.listMessages(id, this.lastSeq).subscribe({
            next: list => { this.applyMessages(list); this.scrollSoon(); },
            error: () => { /* transient — the next nudge or a reopen catches up */ },
        });
    }

    /** Merge messages into the thread (dedupe by id, sort by seq), advancing `lastSeq`. */
    private applyMessages(incoming: ChatMessageDto[]): void {
        if (incoming.length === 0) {
            return;
        }
        const byId = new Map(this.threadMessages().map(m => [m.id, m]));
        for (const m of incoming) {
            byId.set(m.id, m);
        }
        const merged = [...byId.values()].sort((a, b) => a.seq - b.seq);
        this.lastSeq = merged.length ? merged[merged.length - 1].seq : this.lastSeq;
        this.threadMessages.set(merged);

        // The thread is open and on screen, so what just arrived counts as read
        // — and now there IS a client-side seq to claim. Mirrors the full
        // page, which the panel had no equivalent of: opening a thread here used
        // to mark read up to the SERVER's `lastSeq` and nothing ever corrected it.
        const id = this.openId();
        const conv = null === id ? null : this.conversations().find(c => c.id === id);
        //  The `excluded` guard is new here: the page has always refused
        // to mark read for an owner-excluded viewer because the server refuses
        // the call, and this copy asked anyway.
        if (conv !== undefined && conv !== null && mayMarkRead(conv, this.lastSeq)) {
            this.markConversationRead(conv, this.lastSeq);
        }
    }

    /**
     * Mark the conversation read up to `upTo` server-side + optimistically clear
     * its list badge. `upTo` is the seq this panel HOLDS, never
     * the conversation row's server-side `lastSeq`.
     */
    private markConversationRead(conv: ChatConversationDto, upTo: number): void {
        if (upTo <= 0) {
            return;
        }
        //  The optimistic cursor goes in the OVERRIDE map, which is what the
        // badge consults. This used to edit the participant roster
        // instead — somewhere `unreadFor` never looks once the server sends
        // `viewerUnread`, so the clear was invisible and the badge waited for the
        // next list refresh.
        this.readSeqOverride.update(m => advanceReadOverride(m, conv.id, upTo));
        this.api.markRead(conv.id, upTo).subscribe({ error: () => { /* cursor only moves forward; harmless */ } });
    }

    private scrollSoon(): void {
        setTimeout(() => {
            const el = this.threadScroll()?.nativeElement;
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }, 0);
    }

    private uuid(): string {
        try {
            if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
                return crypto.randomUUID();
            }
        } catch { /* fall through */ }
        return `cid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }

    private load(): void {
        this.loading.set(true);
        // Same window rule as the background refresh: on first open there
        // is nothing loaded and this is one page, but `back()` also comes through
        // here — and stepping out of a thread should not collapse the pages the
        // user had loaded before stepping in.
        const want = refreshWindow(this.CONV_PAGE, this.conversations().length);
        this.api.listConversations(want).subscribe({
            next: list => {
                this.applyInboxPage(firstInboxPage(list, want));
                this.loading.set(false);
                this.refreshPresence();
            },
            error: () => { this.error.set('Could not load your conversations.'); this.loading.set(false); },
        });
    }

    /** Append the next page of rows — the rules live in `inbox-paging.util`. */
    loadMore(): void {
        if (this.loadingMore() || !this.hasMore()) {
            return;
        }
        this.loadingMore.set(true);
        this.api.listConversations(this.CONV_PAGE, this.convOffset).subscribe({
            next: list => {
                this.loadingMore.set(false);
                this.applyInboxPage(nextInboxPage(this.inboxPage(), list, this.CONV_PAGE));
                this.refreshPresence();
            },
            error: () => { this.loadingMore.set(false); },
        });
    }

    /** The paging state, reassembled from the signals that hold it. */
    private inboxPage(): InboxPage<ChatConversationDto> {
        return { rows: this.conversations(), offset: this.convOffset, hasMore: this.hasMore() };
    }

    private applyInboxPage(page: InboxPage<ChatConversationDto>): void {
        this.conversations.set([...page.rows]);
        this.convOffset = page.offset;
        this.hasMore.set(page.hasMore);
    }

    /**
     * Background list refresh — same read as {@link load}, but it never
     * raises the spinner and never surfaces an error: a failed background poll
     * should leave the rows you are reading alone, not replace them with a
     * message about it. The open thread is unaffected (it is keyed by `openId`,
     * not by an object identity in this list).
     */
    private refreshList(): void {
        // Re-read as many rows as are ON SCREEN, not one page — a
        // background refresh that dropped back to the first page would erase
        // every "Load more" the user had clicked, while they were reading.
        const want = refreshWindow(this.CONV_PAGE, this.conversations().length);
        this.api.listConversations(want).subscribe({
            next: list => {
                this.applyInboxPage(firstInboxPage(list, want));
                // Presence follows the SAME visibility gate as its own poll —
                // otherwise the fallback list refresh (which runs while the socket
                // is down, hidden tab or not) would quietly put the per-counterpart
                // Centrifugo round trips back on a tab nobody is looking at.
                if ('hidden' !== document.visibilityState) {
                    this.refreshPresence();
                }
            },
            error: () => { /* transient — the next tick or nudge refreshes */ },
        });
    }

    /**
     * Pull anything the OPEN thread missed while the transport was down.
     * Same incremental read as a nudge: everything past our local high-water.
     */
    private catchUpOpenThread(): void {
        const id = this.openId();
        if (id === null) {
            return;
        }
        this.api.listMessages(id, this.lastSeq).subscribe({
            next: list => { this.applyMessages(list); this.scrollSoon(); },
            error: () => { /* transient — the next nudge or a reopen catches up */ },
        });
    }
}
