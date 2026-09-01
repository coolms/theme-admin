import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { EMPTY, catchError, distinctUntilChanged, filter, map, merge, of, switchMap, timer } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { countNewConversations } from './agent-queue.util';
import { DynamicChatService } from './dynamic-chat.service';
import { DynamicChatLiveEventsService } from './dynamic-chat-live-events.service';
import { DynamicChatQuickPanelComponent } from './dynamic-chat-quick-panel.component';

/**
 * DynamicChat agent-queue quick-access icon for the admin topbar,
 * Slice C of the ambient-chat redesign). Opens {@link DynamicChatQuickPanelComponent}
 * in the global right drawer — a from-anywhere visitor-queue launcher. As of
 * this is the PRIMARY entry (Dynamic Chat no longer has a left-sidebar
 * item); the icon carries a live **new-count badge** = the number of
 * conversations whose [] triage status is `new` (a visitor is waiting for a
 * reply), so a manager sees "someone needs answering" from anywhere.
 *
 * The queue has no realtime channel (the agent page already polls it), so the
 * badge is poll-driven on a fixed cadence. Best-effort — a failed fetch leaves
 * the last count rather than flashing to zero. Hidden until a user is in scope.
 */
@Component({
    selector: 'app-dynamic-chat-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (signedIn()) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px"
                    [title]="newCount() > 0 ? newCount() + ' awaiting a reply' : 'Dynamic Chat'"
                    aria-label="Dynamic Chat"
                    (click)="openPanel()">
                <i class="bi bi-headset" style="font-size:.9rem"></i>
                @if (newCount() > 0) {
                    <span class="badge rounded-pill bg-danger position-absolute"
                          style="top:-5px; right:-5px; font-size:.6rem; padding:.2em .4em; line-height:1"
                          aria-label="conversations awaiting a reply">
                        {{ newCount() > 99 ? '99+' : newCount() }}
                    </span>
                }
            </button>
        }
    `,
})
export class DynamicChatQuickAccessComponent {
    private readonly drawer     = inject(DrawerService);
    private readonly store      = inject(Store);
    private readonly api        = inject(DynamicChatService);
    private readonly live       = inject(DynamicChatLiveEventsService);
    private readonly destroyRef = inject(DestroyRef);

    /** WS connection state as a stream (built in the injection context). */
    private readonly connected$ = toObservable(this.live.isConnected);

    readonly signedIn = computed<boolean>(() => !!this.store.selectSnapshot(AuthState.currentUser)?.id);

    /** Conversations whose triage status is `new` — a visitor is waiting. */
    readonly newCount = signal<number>(0);

    /**
     * Fallback poll cadence. Realtime is the primary path now: the badge
     * refetches on a `queue.changed` nudge while the WS is connected; this timer
     * only fires when push is UNavailable (gated on `isConnected`), so it's a true
     * no-WS fallback rather than a parallel 20s poll on every admin page.
     */
    private static readonly POLL_MS = 20_000;

    constructor() {
        // Recompute the new-count badge while signed in; stop entirely when no
        // user is in scope (the login render before AuthState hydrates).
        this.store.select(AuthState.currentUser)
            .pipe(
                map(user => user?.id ?? null),
                distinctUntilChanged(),
                switchMap(meId => {
                    if (meId === null) {
                        return of(0);
                    }
                    // Refetch on: a realtime queue nudge (primary), each WS
                    // (re)connect (close any gap), OR a fallback timer tick — but
                    // only while the WS is DISCONNECTED.
                    return merge(
                        timer(0, DynamicChatQuickAccessComponent.POLL_MS)
                            .pipe(filter(() => !this.live.isConnected())),
                        this.live.watchQueue().pipe(catchError(() => EMPTY)),
                        this.connected$.pipe(distinctUntilChanged(), filter(connected => connected)),
                    ).pipe(
                        //  The fallback tick and the connect signal both fire at
                        // cold load, so `switchMap` aborts the first request and
                        // DevTools shows a cancelled `agent/conversations`. Left
                        // deliberately — see the note in `dynamic-chat.page.ts`:
                        // coalescing them was measured and delays the queue's
                        // first paint by more than the cancellation costs.
                        switchMap(() => this.api.listQueue().pipe(
                            map(list => countNewConversations(list)),
                            catchError(() => EMPTY), // keep the last count on a transient failure
                        )),
                    );
                }),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(count => this.newCount.set(count));
    }

    openPanel(): void {
        this.drawer.open(DynamicChatQuickPanelComponent, {}, 'Dynamic Chat');
    }

}
