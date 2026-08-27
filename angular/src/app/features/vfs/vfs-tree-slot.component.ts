import { ChangeDetectionStrategy, Component } from '@angular/core';
import { VfsTreeComponent } from './vfs-tree.component';

/**
 * Slot adapter for `content.panel.left` in the VFS File Manager layout.
 *
 * Thin wrapper around VfsTreeComponent. Tree navigation stays on VfsManagerState
 * for now — full decoupling to VfsPageStateService happens in 30.7.
 *
 * Registered as 'VfsTree' in ComponentRegistry (matches file-manager.yaml).
 */
@Component({
    selector: 'app-vfs-tree-slot',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [VfsTreeComponent],
    template: `<app-vfs-tree rootPath="/" />`,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }`],
})
export class VfsTreeSlotComponent {}
