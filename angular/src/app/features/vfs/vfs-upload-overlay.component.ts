import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { VfsPageStateService } from './vfs-page-state.service';

@Component({
    selector: 'app-vfs-upload-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <!-- Drop zone highlight (shown during drag) -->
        @if (isDragging()) {
            <div class="vfs-drop-zone">
                <div class="vfs-drop-content">
                    <div style="font-size: 3rem">📂</div>
                    <div class="fw-semibold mt-2">Drop files to upload</div>
                    <div class="text-muted small mt-1">to {{ currentPath() }}</div>
                </div>
            </div>
        }

        <!-- Upload progress list (bottom-right, shown while uploading) -->
        @if (uploads().length > 0) {
            <div class="vfs-upload-progress-panel">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <span class="small fw-semibold">
                        Uploading {{ uploads().length }} file(s)
                    </span>
                    @if (allDone()) {
                        <button class="btn-close btn-sm" (click)="clearUploads()"></button>
                    }
                </div>

                @for (item of uploads(); track item.id) {
                    <div class="vfs-upload-item mb-2">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="small text-truncate" style="max-width: 200px">
                                {{ item.fileName }}
                            </span>
                            <span class="small ms-2"
                                  [class.text-success]="item.status === 'done'"
                                  [class.text-danger]="item.status === 'error'"
                                  [class.text-muted]="item.status === 'uploading'">
                                @if (item.status === 'done')      { ✓ }
                                @else if (item.status === 'error') { ✗ }
                                @else { {{ item.progress }}% }
                            </span>
                        </div>
                        <div class="progress" style="height: 4px">
                            <div class="progress-bar"
                                 [class.bg-success]="item.status === 'done'"
                                 [class.bg-danger]="item.status === 'error'"
                                 [style.width.%]="item.progress"
                                 role="progressbar">
                            </div>
                        </div>
                        @if (item.status === 'error' && item.error) {
                            <div class="text-danger small mt-1">{{ item.error }}</div>
                        }
                    </div>
                }
            </div>
        }
    `,
    styles: [`
        :host { display: contents; }

        .vfs-drop-zone {
            position: absolute; inset: 0; z-index: 100;
            background: var(--cms-info-light);
            border: 3px dashed var(--cms-primary);
            border-radius: var(--cms-radius-md, 8px);
            display: flex; align-items: center; justify-content: center;
            pointer-events: none;
        }
        .vfs-drop-content { text-align: center; color: var(--cms-primary); }

        .vfs-upload-progress-panel {
            position: absolute; bottom: 16px; right: 16px; z-index: 200;
            background: var(--cms-surface); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-md, 8px); padding: 12px 16px;
            min-width: 260px; max-width: 320px;
            box-shadow: var(--cms-shadow-md, 0 4px 12px rgba(0,0,0,.10));
        }
    `],
})
export class VfsUploadOverlayComponent {
    private readonly state = inject(VfsPageStateService);

    isDragging  = input.required<boolean>();
    uploads     = this.state.uploads;
    currentPath = this.state.currentPath;

    allDone = computed(() =>
        this.uploads().length > 0 &&
        this.uploads().every(u => u.status === 'done' || u.status === 'error'),
    );

    clearUploads(): void {
        this.state.clearUploads();
    }
}
