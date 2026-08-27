import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { VfsNodeDto } from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';

/**
 * Footer status bar — shows loading spinner, item counts (dirs + files), and selection count.
 * Injected by ExplorerLayoutComponent via SlotComponent using ComponentRegistry key 'VfsStatusBar'.
 */
@Component({
    selector: 'app-vfs-status-bar',
    standalone: true,
    imports: [CmsLoaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="vfs-status-bar">
            @if (loading()) {
                <cms-loader [inline]="true" />
            }
            @if (!loading() && total() > 0) {
                <span class="text-muted">
                    {{ dirCount() }} dir{{ dirCount() === 1 ? '' : 's' }},
                    {{ fileCount() }} file{{ fileCount() === 1 ? '' : 's' }}
                </span>
            }
            @if (!loading() && total() === 0) {
                <span class="text-muted">Empty directory</span>
            }
            @if (selectedCount() > 0) {
                <span class="ms-3 text-secondary">
                    {{ selectedCount() }} selected
                </span>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .vfs-status-bar {
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
export class VfsStatusBarComponent {
    private readonly state = inject(VfsPageStateService);

    readonly nodes         = this.state.nodes as () => VfsNodeDto[];
    readonly loading       = this.state.loading;
    readonly selectedNodes = this.state.selectedNodes as () => VfsNodeDto[];

    readonly total         = computed(() => this.nodes().length);
    readonly dirCount      = computed(() => this.nodes().filter(n => n.type === 'directory').length);
    readonly fileCount     = computed(() => this.nodes().filter(n => n.type !== 'directory').length);
    readonly selectedCount = computed(() => this.selectedNodes().length);
}
