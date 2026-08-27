import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CmsRightPanelComponent } from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsFileDetailComponent } from './vfs-file-detail.component';

/**
 * Slot adapter for `content.panel.right` in the VFS File Manager
 * layout. Mounts VfsFileDetailComponent inside the shared
 * `<cms-right-panel>` chrome; header (icon + title + close X) is
 * driven by the `panelNode` signal so every module shows identical
 * panel chrome.
 *
 * Registered as 'VfsFileDetail' in ComponentRegistry (matches
 * file-manager.yaml).
 */
@Component({
    selector: 'app-vfs-file-detail-slot',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsRightPanelComponent, VfsFileDetailComponent],
    template: `
        @if (state.activeItem(); as node) {
            <cms-right-panel
                [node]="state.panelNode()"
                (closed)="onClose()">
                <app-vfs-file-detail [node]="node" />
            </cms-right-panel>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    `],
})
export class VfsFileDetailSlotComponent {
    readonly state = inject(VfsPageStateService);

    protected onClose(): void {
        this.state.panelOpen.set(false);
        this.state.activeItem.set(null);
    }
}
