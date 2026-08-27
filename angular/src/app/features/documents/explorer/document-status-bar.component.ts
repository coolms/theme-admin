import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CmsLoaderComponent } from '@coolms/core-angular';

import { DocumentPageStateService } from './document-page-state.service';

/**
 * Footer status line — count + busy indicator. Mirrors
 * MediaStatusBar's role of giving the explorer layout *something* in
 * the footer slot so the bottom edge isn't a bare strip.
 */
@Component({
    selector: 'cms-document-status-bar',
    standalone: true,
    imports: [CmsLoaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cms-document-status-bar">
            <span>{{ totalCount() }} template{{ totalCount() === 1 ? '' : 's' }}</span>
            @if (selectedCount() > 0) {
                <span class="cms-document-status-bar__sep">·</span>
                <span>{{ selectedCount() }} selected</span>
            }
            @if (loading()) {
                <span class="cms-document-status-bar__sep">·</span>
                <cms-loader [inline]="true" />
                <span>Loading…</span>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
        }
        .cms-document-status-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px var(--cms-content-padding);
            font-size: 0.8rem;
            color: var(--cms-text-muted);
            border-top: 1px solid var(--cms-border-light);
        }
        .cms-document-status-bar__sep {
            color: var(--cms-text-muted);
        }
    `],
})
export class DocumentStatusBarComponent {
    private readonly state = inject(DocumentPageStateService);

    protected readonly totalCount = this.state.totalCount;
    protected readonly selectedCount = this.state.selectedCount;
    protected readonly loading = this.state.loading;
}
