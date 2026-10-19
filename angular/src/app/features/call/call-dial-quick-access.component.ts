import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState, ElevationService, NaviGraphService } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { CallDialPanelComponent } from './call-dial-panel.component';
import { navLocked, navOffers } from '../../shell/nav-offers';
import { afterElevation } from '../../shell/after-elevation';

/**
 * The topbar "dial a number" launcher. A phone-outbound icon in
 * the right-side quick-access cluster that opens the {@link CallDialPanelComponent}
 * dial pad in the shared right drawer (the messages/calendar quick-access
 * pattern). Click-to-dial over the existing `POST /call/originate`.
 *
 * Shown to any signed-in user (mirrors the sibling quick-access buttons); the
 * real gate is server-side -- the originate endpoint is VFS-gated to call
 * operators, and the panel prompts for a device if none is set.
 */
@Component({
    selector: 'app-call-dial-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (signedIn() && (offered() || locked())) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid var(--cms-chrome-edge);
                           border-radius: 20px; padding: 4px 10px"
                    [title]="label()" [attr.aria-label]="label()"
                    (click)="onClick()">
                <i class="bi bi-telephone-outbound" style="font-size:.9rem"></i>
                @if (locked()) {
                    <i class="bi bi-lock-fill position-absolute" aria-hidden="true"
                       style="font-size:.55rem; top:-3px; right:-3px"></i>
                }
            </button>
        }
    `,
})
export class CallDialQuickAccessComponent {
    private readonly drawer    = inject(DrawerService);
    private readonly store     = inject(Store);
    private readonly elevation = inject(ElevationService);
    private readonly nav       = inject(NaviGraphService).adminNav;

    /**
     * Its module's item in the admin navigation, as the server answered it to this account: outside the module's
     * group every call this tile makes is refused, so it neither shows nor asks (Dmitry, 2026-10-06).
     */
    readonly offered = navOffers(this.nav, '/api/v1/call/records');

    /** The same item answered 'elevate': shown with a lock, and opening it asks for elevation first (2026-10-12). */
    readonly locked = navLocked(this.nav, '/api/v1/call/records');

    readonly label = computed(() => 'Dial a number' + (this.locked() ? ' -- needs an elevated session' : ''));

    readonly signedIn = computed(() => !!this.store.selectSnapshot(AuthState.currentUser)?.id);

    onClick(): void {
        if (this.locked()) {
            afterElevation(this.elevation, () => this.open());
            return;
        }
        this.open();
    }

    open(): void {
        this.drawer.open(CallDialPanelComponent, {}, 'Dial a number');
    }
}
