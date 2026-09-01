import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { EMPTY, catchError, distinctUntilChanged, filter, map, merge, of, switchMap, timer } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { MessagesService } from './messages.service';
import { MessagesLiveEventsService } from './messages-live-events.service';
import { MessagesQuickPanelComponent } from './messages-quick-panel.component';

/**
 * Internal Messages quick-access icon for the admin topbar.
 * Opens {@link MessagesQuickPanelComponent} in the global right drawer — a
 * from-anywhere chat launcher. As of this is the PRIMARY entry (Messages
 * no longer has a left-sidebar item); the icon carries a live unread-count
 * badge so you see new messages from anywhere without opening anything.
 *
 * The badge is reactive to auth (re-subscribes when the user hydrates), live
 * via the per-user `chat.user.{uid}` channel ([]), and backed by a 30s
 * poll so your own reads (which don't push) clear it too. Best-effort — a
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
        @if (signedIn()) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px"
                    [title]="unread() > 0 ? unread() + ' unread' : 'Messages'"
                    aria-label="Messages"
                    (click)="openPanel()">
                <i class="bi bi-chat-dots" style="font-size:.9rem"></i>
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

    readonly signedIn = computed<boolean>(() => !!this.store.selectSnapshot(AuthState.currentUser)?.id);

    /** Total unread across all of the current user's conversations. */
    readonly unread = signal<number>(0);

    /** How often the badge re-polls (catches the user's own reads, which don't push). */
    private static readonly POLL_MS = 30_000;

    constructor() {
        // Join the shared presence channel — from HERE, the topbar, and
        // not from the Messages page. Being subscribed is what makes you appear
        // online to everyone else, and "online" has to keep meaning "has the
        // admin shell open", not "is looking at Messages right now": started on
        // the page, your dot would blink off the moment you opened Pages.
        this.store.select(AuthState.currentUser)
            .pipe(
                map(user => user?.id ?? null),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(meId => (meId === null ? this.presence.stop() : this.presence.start()));

        // Re-derive the badge whenever the signed-in user changes; for a signed-in
        // user, recompute on a poll tick OR a live `chat.user.{uid}` nudge ([]).
        this.store.select(AuthState.currentUser)
            .pipe(
                map(user => user?.id ?? null),
                distinctUntilChanged(),
                switchMap(meId => {
                    if (meId === null) {
                        return of(0);
                    }
                    return merge(
                        // Seed the badge once, unconditionally — at t=0 the socket
                        // may already be up, and a gated first tick would leave the
                        // badge empty until someone messaged you.
                        of(0),
                        //  Then poll ONLY while realtime is down. This
                        // used to tick every 30s regardless, so a connected client
                        // still re-fetched the whole inbox — and `listConversations`
                        // is the unpaged endpoint that runs two queries per
                        // conversation. Polling is the FALLBACK for "no Centrifugo
                        // installed / worker down", which is exactly how the page's
                        // own poll() already behaves.
                        timer(MessagesQuickAccessComponent.POLL_MS, MessagesQuickAccessComponent.POLL_MS)
                            .pipe(filter(() => !this.live.isConnected())),
                        this.live.watchUser(meId).pipe(catchError(() => EMPTY)),
                    ).pipe(
                        //  ONE number, not the whole inbox. This used to
                        // call `listConversations()` — every conversation, with
                        // its participants enriched from the identity directory
                        // and a last-message preview each — to subtract two
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

    openPanel(): void {
        this.drawer.open(MessagesQuickPanelComponent, {}, 'Messages');
    }

}
