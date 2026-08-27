import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { AppConfigState, AuthState, ErrorHandlerService } from '@coolms/core-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { UploadItem } from '@coolms/ui-angular';

@Injectable()
export class VfsUploadService {
    private readonly http   = inject(HttpClient);
    private readonly store  = inject(Store);
    private readonly state  = inject(VfsPageStateService);
    private readonly errors = inject(ErrorHandlerService);

    /**
     * Upload multiple files to the current directory.
     * Each file is uploaded independently with its own progress tracking.
     */
    uploadFiles(files: FileList | File[]): void {
        const currentPath = this.state.currentPath();
        for (const file of Array.from(files)) {
            this.uploadOne(file, currentPath);
        }
    }

    private uploadOne(file: File, dirPath: string): void {
        const id       = crypto.randomUUID();
        const filePath = dirPath.replace(/\/$/, '') + '/' + file.name;

        const item: UploadItem = {
            id, fileName: file.name, progress: 0, status: 'uploading',
        };
        this.state.startUpload(item);

        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url      = `${manifest?.apiBase ?? ''}/vfs/files/upload`;
        const token    = this.store.selectSnapshot(AuthState.accessToken);

        const formData = new FormData();
        formData.append('path', filePath);
        formData.append('file', file, file.name);

        this.http.post(url, formData, {
            headers:        { Authorization: `Bearer ${token ?? ''}` },
            reportProgress: true,
            observe:        'events',
        }).subscribe({
            next: event => {
                if (event.type === HttpEventType.UploadProgress) {
                    const progress = event.total
                        ? Math.round(100 * event.loaded / event.total)
                        : 0;
                    this.state.updateUpload(id, progress, 'uploading');
                } else if (event.type === HttpEventType.Response) {
                    this.state.updateUpload(id, 100, 'done');
                    this.maybeReload();
                }
            },
            error: err => {
                const message = this.errors.humanize(err);
                this.state.updateUpload(id, 0, 'error', message);
            },
        });
    }

    /**
     * Reload directory once ALL uploads are done or errored.
     * Clears the upload list after a short delay so the user sees 100%.
     */
    private maybeReload(): void {
        const uploads = this.state.uploads();
        const allDone = uploads.every(u => u.status === 'done' || u.status === 'error');
        if (!allDone) return;

        this.state.reload();
        setTimeout(() => this.state.clearUploads(), 2000);
    }
}
