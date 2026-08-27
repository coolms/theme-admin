import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { DrawerService } from '@coolms/ui-angular';
import { NotificationDrawerContentComponent } from './notification-drawer-content.component';
import { NotificationPollingService } from './notification-polling.service';
import { NotificationStore } from './notification-store.service';

/**
 * Notification Sub-phase J -- topbar bell reduced to icon + badge
 * + drawer trigger. Sub-phase E originally shipped a positional
 * dropdown rendered by this component directly; that markup moved
 * to `NotificationDrawerContentComponent` and the bell now opens
 * it via `DrawerService.open(...)`.
 *
 * Polling lifecycle stays here: `ngOnInit` calls `polling.start()`,
 * which is idempotent and cleans up via the polling service's
 * `DestroyRef` registration. The drawer content is mounted and
 * unmounted on each open / close, so it cannot own the start /
 * stop signal -- the bell mounts once and lives the whole admin
 * session.
 *
 * `DrawerService` is single-content: opening notifications while
 * another drawer panel is open replaces that panel. This matches
 * the existing precedent of every other `DrawerService` consumer
 * (e.g., `VfsFileDetailComponent`).
 */
@Component({
    selector: 'app-notification-bell',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button type="button"
                class="btn btn-sm position-relative text-white"
                style="background: rgba(255,255,255,.08);
                       border: 1px solid rgba(255,255,255,.12);
                       border-radius: 20px; padding: 4px 10px"
                title="Notifications"
                (click)="open()">
            <i class="bi bi-bell" style="font-size:.9rem"></i>
            @if (store.hasUnread()) {
                <span class="position-absolute translate-middle badge rounded-pill bg-danger"
                      style="top: 4px; right: -4px; font-size: .6rem; padding: 2px 5px;">
                    {{ store.unreadCount() }}
                </span>
            }
        </button>
    `,
})
export class NotificationBellComponent implements OnInit {
    protected readonly store = inject(NotificationStore);
    private readonly polling = inject(NotificationPollingService);
    private readonly drawer = inject(DrawerService);

    ngOnInit(): void {
        this.polling.start();
    }

    open(): void {
        this.drawer.open(NotificationDrawerContentComponent, {}, 'Notifications');
    }
}
