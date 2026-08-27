import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
/**
 * Email quick-access icon for the admin topbar — a from-anywhere launcher for the
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
        @if (signedIn()) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px"
                    title="Email"
                    aria-label="Email"
                    (click)="open()">
                <i class="bi bi-envelope" style="font-size:.9rem"></i>
            </button>
        }
    `,
})
export class EmailQuickAccessComponent {
    private readonly store  = inject(Store);
    private readonly router = inject(Router);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- ngxs static selector reference, same pattern as the sibling quick-access components
    readonly signedIn = computed<boolean>(() => this.store.selectSnapshot(AuthState.currentUser)?.id != null);

    open(): void {
        void this.router.navigate(['/email']);
    }
}
