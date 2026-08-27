import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, inject, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DrawerService, ExplorerToolbarRowComponent, VfsNodeDto } from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsFilesComponent } from './vfs-files.component';

/**
 * Slot adapter for `content.main` in the VFS File Manager layout.
 *
 * Wraps VfsFilesComponent and intercepts DrawerService so that opening a file
 * detail calls `state.activeItem.set(node)` instead of the global drawer.
 *
 * Registered as 'VfsGrid' in ComponentRegistry (matches file-manager.yaml).
 */
@Component({
    selector: 'app-vfs-files-slot',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [VfsFilesComponent, ExplorerToolbarRowComponent],
    providers: [
        {
            provide: DrawerService,
            useFactory: (state: VfsPageStateService) => ({
                open: (_: unknown, inputs: Record<string, unknown>) => {
                    state.activeItem.set((inputs['node'] as VfsNodeDto) ?? null);
                },
                close:     () => state.activeItem.set(null),
                toggle:    () => {},
                isOpen:    signal(false),
                component: signal(null),
                inputs:    signal({}),
            }),
            deps: [VfsPageStateService],
        },
    ],
    template: `
        <!-- Breadcrumb row — first child of the main slot. Labels resolve
             server-side via /api/v1/vfs/breadcrumb (Node.title fallback to
             name), so the FE no longer needs a labelFor translator for
             /home/{uuid} -> display-name mapping. -->
        <app-explorer-toolbar-row
            [path]="state.currentPath()"
            (navigate)="state.navigateTo($event)" />
        <app-vfs-files />
    `,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; overflow: hidden; }`],
})
export class VfsFilesSlotComponent implements AfterViewInit {
    protected readonly state    = inject(VfsPageStateService);
    private readonly destroyRef = inject(DestroyRef);

    @ViewChild(VfsFilesComponent) filesComponent?: VfsFilesComponent;

    ngAfterViewInit(): void {
        this.state.uploadRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.filesComponent?.triggerFileInput());
    }
}
