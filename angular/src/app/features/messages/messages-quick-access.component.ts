import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { catchError, combineLatest, distinctUntilChanged, EMPTY, filter, map, merge, of, switchMap, timer } from 'rxjs';
import { AuthState, ElevationService, NaviGraphService } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { MessagesService } from './messages.service';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { MessagesQuickPanelComponent } from './messages-quick-panel.component';
import { navLocked, navOffers } from '../../shell/nav-offers';
import { afterElevation } from '../../shell/after-elevation';

/**
 * The Chat quick-access icon for the admin topbar.
 * Opens {@link MessagesQuickPanelComponent} in the global right drawer -- a
 * from-anywhere chat launcher. As of this is the PRIMARY entry (Chat
 * no longer has a left-sidebar item); the icon carries a live unread-count
 * badge so you see new messages from anywhere without opening anything.
 *
 * The badge is reactive to auth (re-subscribes when the user hydrates), live
 * via the per-user `chat.user.{uid}` channel ([]), and backed by a 30s
 * poll so your own reads (which don't push) clear it too. Best-effort -- a
 * failed fetch leaves the last count rather than flashing to zero.
 *
 * Hidden until a user is in scope (the login-page render before AuthState
 * hydrates has no current user).
 */
@Component({
    selector: 'app-messages-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (signedIn() && (offered() || locked())) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid var(--cms-chrome-edge);
                           border-radius: 20px; padding: 4px 10px"
                    [title]="locked() ? 'Chat -- needs an elevated session' : unread() > 0 ? unread() + ' unread' : 'Chat'"
                    [attr.aria-label]="locked() ? 'Chat, needs an elevated session' : 'Chat'"
                    (click)="onClick()">
                <i class="bi bi-chat-dots" style="font-size:.9rem"></i>
                @if (locked()) {
                    <i class="bi bi-lock-fill position-absolute" aria-hidden="true"
                       style="font-size:.55rem; top:-3px; right:-3px"></i>
                }
                @if (unread() > 0) {
                    <span class="badge rounded-pill bg-danger position-absolute"
                          style="top:-5px; right:-5px; font-size:.6rem; padding:.2em .4em; line-height:1"
                          aria-label="unread messages">
                        {{ unread() > 99 ? '99+' : unread() }}
                    </span>
                }
            </button>
        }
    `,
})
export class MessagesQuickAccessComponent {
    private readonly drawer     = inject(DrawerService);
    private readonly store      = inject(Store);
    private readonly api        = inject(MessagesService);
    private readonly live       = inject(MessagesLiveEventsService);
    private readonly presence   = inject(ChatPresenceLiveService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly elevation  = inject(ElevationService);
    private readonly nav        = inject(NaviGraphService).adminNav;

    /**
     * Its module's item in the admin navigation, as the server answered it to this account: outside the module's
     * group every call this tile makes is refused, so it neither shows nor asks (2026-10-06). Allowed only:
     * the unread count's polling and subscriptions start on this, never on a locked item.
     */
    readonly offered = navOffers(this.nav, '/api/v1/chat/conversations');

    /** The same item answered 'elevate': shown with a lock, and opening it asks for elevation first (2026-10-12). */
    readonly locked = navLocked(this.nav, '/api/v1/chat/conversations');

    readonly signedIn = computed<boolean>(() => !!this.store.selectSnapshot(AuthState.currentUser)?.id);

    /** Total unread across all of the current user's conversations. */
    readonly unread = signal<number>(0);

    /** How often the badge re-polls (catches the user's own reads, which don't push). */
    private static readonly POLL_MS = 30_000;

    constructor() {
        // Join the shared presence channel -- from HERE, the topbar, and
        // not from the Messages page. Being subscribed is what makes you appear
        // online to everyone else, and "online" has to keep meaning "has the
        // admin shell open", not "is looking at Messages right now": started on
        // the page, your dot would blink off the moment you opened Pages.
        combineLatest([this.store.select(AuthState.currentUser), toObservable(this.offered)])
            .pipe(
                map(([user, offered]) => (offered ? user?.id ?? null : null)),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(meId => (meId === null ? this.presence.stop() : this.presence.start()));

        // Re-derive the badge whenever the signed-in user changes; for a signed-in
        // user, recompute on a poll tick OR a live `chat.user.{uid}` nudge ([]).
        combineLatest([this.store.select(AuthState.currentUser), toObservable(this.offered)])
            .pipe(
                map(([user, offered]) => (offered ? user?.id ?? null : null)),
                distinctUntilChanged(),
                switchMap(meId => {
                    if (meId === null) {
                        return of(0);
                    }
                    return merge(
                        // Seed the badge once, unconditionally -- at t=0 the socket
                        // may already be up, and a gated first tick would leave the
                        // badge empty until someone messaged you.
                        of(0),
                        //  Then poll ONLY while realtime is down. This
                        // used to tick every 30s regardless, so a connected client
                        // still re-fetched the whole inbox -- and `listConversations`
                        // is the unpaged endpoint that runs two queries per
                        // conversation. Polling is the FALLBACK for "no Centrifugo
                        // installed / worker down", which is exactly how the page's
                        // own poll() already behaves.
                        timer(MessagesQuickAccessComponent.POLL_MS, MessagesQuickAccessComponent.POLL_MS)
                            .pipe(filter(() => !this.live.isConnected())),
                        this.live.watchUser(meId).pipe(catchError(() => EMPTY)),
                    ).pipe(
                        //  ONE number, not the whole inbox. This used to
                        // call `listConversations()` -- every conversation, with
                        // its participants enriched from the identity directory
                        // and a last-message preview each -- to subtract two
                        // integers per row and add them up. It is the most
                        // frequent reader of that endpoint, and it is also what
                        // kept the list unpaged: a badge that SUMS across the
                        // rows it was handed goes quietly wrong the moment the
                        // list is capped.
                        switchMap(() => this.api.fetchUnreadTotal().pipe(
                            catchError(() => EMPTY), // keep the last count on a transient failure
                        )),
                    );
                }),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(count => this.unread.set(count));
    }

    onClick(): void {
        if (this.locked()) {
            afterElevation(this.elevation, () => this.openPanel());
            return;
        }
        this.openPanel();
    }

    openPanel(): void {
        this.drawer.open(MessagesQuickPanelComponent, {}, 'Chat');
    }

}
