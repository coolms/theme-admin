import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthState, ElevationService, NaviGraphService } from '@coolms/core-angular';
import { navLocked, navOffers } from '../../shell/nav-offers';
import { afterElevation } from '../../shell/after-elevation';
/**
 * Email quick-access icon for the admin topbar -- a from-anywhere launcher for the
 * mailbox client at `/admin/email`, sitting in the right-side action cluster next
 * to Messages / DynamicChat / Notifications. A plain nav button (no drawer panel):
 * Email is a full-page workspace, so the icon routes straight to it.
 *
 * Styling mirrors the sibling quick-access buttons (rounded pill, white-on-dark).
 * Hidden until a user is in scope (the login-page render before AuthState hydrates
 * has no current user).
 */
@Component({
    selector: 'app-email-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (signedIn() && (offered() || locked())) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid var(--cms-chrome-edge);
                           border-radius: 20px; padding: 4px 10px"
                    [title]="label()"
                    [attr.aria-label]="label()"
                    (click)="onClick()">
                <i class="bi bi-envelope" style="font-size:.9rem"></i>
                @if (locked()) {
                    <i class="bi bi-lock-fill position-absolute" aria-hidden="true"
                       style="font-size:.55rem; top:-3px; right:-3px"></i>
                }
            </button>
        }
    `,
})
export class EmailQuickAccessComponent {
    private readonly store     = inject(Store);
    private readonly router    = inject(Router);
    private readonly elevation = inject(ElevationService);
    private readonly nav       = inject(NaviGraphService).adminNav;

    /**
     * Its module's item in the admin navigation, as the server answered it to this account: outside the module's
     * group every call this tile makes is refused, so it neither shows nor asks (Dmitry, 2026-10-06).
     */
    readonly offered = navOffers(this.nav, '/api/v1/email/mailboxes');

    /** The same item answered 'elevate': shown with a lock, and opening it asks for elevation first (2026-10-12). */
    readonly locked = navLocked(this.nav, '/api/v1/email/mailboxes');

    readonly label = computed(() => 'Email' + (this.locked() ? ' -- needs an elevated session' : ''));

    // eslint-disable-next-line @typescript-eslint/unbound-method -- ngxs static selector reference, same pattern as the sibling quick-access components
    readonly signedIn = computed<boolean>(() => this.store.selectSnapshot(AuthState.currentUser)?.id != null);

    onClick(): void {
        if (this.locked()) {
            afterElevation(this.elevation, () => this.open());
            return;
        }
        this.open();
    }

    open(): void {
        void this.router.navigate(['/email']);
    }
}
