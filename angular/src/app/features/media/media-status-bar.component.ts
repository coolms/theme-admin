import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { MediaPageStateService } from './media-page-state.service';

/**
 * Footer status bar — shows loading spinner, total count, and selection count.
 * Injected by ExplorerLayoutComponent via SlotComponent using ComponentRegistry key 'MediaStatusBar'.
 */
@Component({
    selector: 'app-media-status-bar',
    standalone: true,
    imports: [CmsLoaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="media-status-bar">
            @if (state.loading()) {
                <cms-loader [inline]="true" />
            }
            @if (!state.loading() && state.totalItems() > 0) {
                <span class="text-muted">
                    All {{ state.totalItems() }} file{{ state.totalItems() === 1 ? '' : 's' }} loaded
                </span>
            }
            @if (state.selectedIds().length > 0) {
                <span class="ms-3 text-secondary">
                    {{ state.selectedIds().length }} selected
                </span>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .media-status-bar {
            display: flex;
            align-items: center;
            padding: 4px 12px;
            font-size: .8125rem;
            border-top: 1px solid var(--cms-border);
            background: var(--cms-surface);
            min-height: 30px;
        }
    `],
})
export class MediaStatusBarComponent {
    readonly state = inject(MediaPageStateService);
}
