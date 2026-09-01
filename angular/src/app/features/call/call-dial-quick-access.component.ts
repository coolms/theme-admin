import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { CallDialPanelComponent } from './call-dial-panel.component';

/**
 * The topbar "dial a number" launcher. A phone-outbound icon in
 * the right-side quick-access cluster that opens the {@link CallDialPanelComponent}
 * dial pad in the shared right drawer (the messages/calendar quick-access
 * pattern). Click-to-dial over the existing `POST /call/originate`.
 *
 * Shown to any signed-in user (mirrors the sibling quick-access buttons); the
 * real gate is server-side — the originate endpoint is VFS-gated to call
 * operators, and the panel prompts for a device if none is set.
 */
@Component({
    selector: 'app-call-dial-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (signedIn()) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px"
                    title="Dial a number" aria-label="Dial a number"
                    (click)="open()">
                <i class="bi bi-telephone-outbound" style="font-size:.9rem"></i>
            </button>
        }
    `,
})
export class CallDialQuickAccessComponent {
    private readonly drawer = inject(DrawerService);
    private readonly store  = inject(Store);

    readonly signedIn = computed(() => !!this.store.selectSnapshot(AuthState.currentUser)?.id);

    open(): void {
        this.drawer.open(CallDialPanelComponent, {}, 'Dial a number');
    }
}
