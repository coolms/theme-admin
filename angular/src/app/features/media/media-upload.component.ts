import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CmsDropzoneDirective } from '@coolms/ui-angular';
import { MediaService } from './media.service';
import { UploadProgress } from './media.types';

@Component({
    selector: 'app-media-upload',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsDropzoneDirective],
    template: `
        <!-- Drop zone -->
        <div class="media-upload-zone"
             [cmsDropzone]="{ accept: acceptList(), multiple: true }"
             (filesDropped)="processFiles($event)"
             (click)="fileInput.click()">
            <input #fileInput type="file" hidden multiple [accept]="accept()"
                   (change)="onFilesSelected($event)" />
            <div class="text-center py-4">
                <div style="font-size:2rem">☁️</div>
                <div class="fw-semibold">Drop files here or click to browse</div>
                <div class="text-muted small">{{ accept() || 'All files' }}</div>
            </div>
        </div>

        <!-- Progress list -->
        @for (item of uploads(); track item.file.name) {
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="text-muted" style="font-size:1.2rem">
                    {{ svc.mimeIcon(item.file.type) }}
                </span>
                <div class="flex-grow-1">
                    <div class="small fw-semibold">{{ item.file.name }}</div>
                    <div class="progress" style="height:4px">
                        <div class="progress-bar"
                             [class.bg-success]="item.status === 'done'"
                             [class.bg-danger]="item.status === 'error'"
                             [style.width.%]="item.progress"></div>
                    </div>
                </div>
                @if (item.status === 'done') { <span class="text-success">✓</span> }
                @if (item.status === 'error') { <span class="text-danger" [title]="item.error ?? ''">✗</span> }
            </div>
        }
    `,
    styles: [`
        .media-upload-zone {
            border: 2px dashed #dee2e6;
            border-radius: 8px;
            cursor: pointer;
            transition: border-color .2s, background .2s;
        }
        .media-upload-zone.cms-dropzone--active {
            border-color: #0d6efd;
            background: #f0f6ff;
        }
        .media-upload-zone:hover { border-color: #adb5bd; }
    `],
})
export class MediaUploadComponent {
    accept    = input<string>('');
    targetDir = input<string>('/media/images/public');
    uploaded  = output<string[]>();

    uploads  = signal<UploadProgress[]>([]);

    readonly svc        = inject(MediaService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * MIME patterns the dropzone uses to filter dropped files.
     * Splits the comma-separated `accept` input into entries the
     * shared directive understands (`type/*` or exact type).
     */
    protected readonly acceptList = computed<string[]>(() => {
        const raw = this.accept().trim();
        if (raw === '') return [];
        return raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    });

    onFilesSelected(event: Event): void {
        const files = Array.from((event.target as HTMLInputElement).files ?? []);
        this.processFiles(files);
    }

    processFiles(files: File[]): void {
        const doneIds: string[] = [];

        for (const file of files) {
            this.uploads.update(list => [
                ...list,
                { file, progress: 0, status: 'uploading' },
            ]);

            this.svc.upload(file, this.targetDir()).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(progress => {
                this.uploads.update(list =>
                    list.map(u => u.file === file ? progress : u)
                );
                if (progress.status === 'done' && progress.assetId) {
                    doneIds.push(progress.assetId);
                    if (doneIds.length === files.length) {
                        this.uploaded.emit([...doneIds]);
                    }
                }
            });
        }
    }
}
