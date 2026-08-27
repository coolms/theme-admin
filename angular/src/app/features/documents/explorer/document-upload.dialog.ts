
import { CmsLoaderComponent } from '@coolms/core-angular';
import { ModalComponent } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { DocumentAggregatorService, type NativeTarget } from './document-aggregator.service';
import { FormatInfoService } from './format-info.service';
import {
    ReplaceTemplateDialogComponent,
    type ReplaceTemplateDialogData,
} from './replace-template-dialog.component';
import {
    TemplateConflictDialogComponent,
    type TemplateConflictDialogData,
    type TemplateConflictDialogResult,
    type TemplateNameConflictPayload,
} from './template-conflict-dialog.component';

/**
 * Type guard: did the HTTP error originate from the backend's
 * template-name-conflict listener? The listener tags the response
 * `type` URL — checked against the canonical suffix rather than the
 * full URL so the listener can move hosts without breaking the
 * frontend gate.
 */
function isTemplateNameConflict(err: unknown): err is { status: 409; error: TemplateNameConflictPayload } {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { status?: number; error?: { type?: unknown } };
    return e.status === 409
        && typeof e.error?.type === 'string'
        && e.error.type.includes('template-name-conflict');
}

/**
 * F.14c-1 — unified upload dialog. Posts to F.14b's
 * `/api/v1/document/templates/upload`; the backend MIME-routes the
 * file to the matching format provider so this dialog stays
 * format-agnostic.
 *
 * The file picker's `accept` attribute is driven by
 * `FormatInfoService.acceptString()` (backend
 * `/document/format-info`). When new format modules ship the dialog
 * automatically widens its accepted set with no frontend change.
 *
 * Closes with the persisted `DocumentTemplate` on success so the
 * caller can refresh the grid + select the new row; closes with
 * `null` on cancel.
 */
export interface DocumentUploadDialogData {
    /** Pre-fill for the folder-path input. Defaults to `/documents/`. */
    readonly folderPath?: string;
}

@Component({
    selector: 'cms-document-upload-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, FormsModule, ModalComponent],
    template: `
        <app-modal title="Upload Template">
            <div class="cms-document-upload">
                @if (uploading()) {
                    <div class="cms-document-upload__progress">
                        <cms-loader [inline]="true" />
                        <span>Uploading {{ selectedFile()?.name }}…</span>
                    </div>
                } @else {
                    <button type="button"
                            class="cms-document-upload__zone"
                            [class.cms-document-upload__zone--has-file]="selectedFile()"
                            (click)="fileInput.click()">
                        <input #fileInput
                               type="file"
                               [accept]="acceptString()"
                               (change)="onFileSelected($event)"
                               hidden />

                        @if (selectedFile(); as f) {
                            <div class="cms-document-upload__file">
                                <i class="bi bi-file-earmark"></i>
                                <strong>{{ f.name }}</strong>
                                <span class="cms-document-upload__size">
                                    {{ formatFileSize(f.size) }}
                                </span>
                            </div>
                        } @else {
                            <div class="cms-document-upload__prompt">
                                <i class="bi bi-cloud-upload"></i>
                                <p>Click to select a file</p>
                                <p class="cms-document-upload__accept">
                                    Accepted: {{ acceptString() || 'any' }}
                                </p>
                            </div>
                        }
                    </button>

                    @if (selectedFile()) {
                        <button type="button"
                                class="cms-document-upload__clear"
                                (click)="clearFile()">
                            Remove file
                        </button>
                    }

                    @if (errorMessage()) {
                        <div class="cms-document-upload__error" role="alert">
                            {{ errorMessage() }}
                        </div>
                    }

                    <label class="cms-document-upload__field">
                        <span>Folder</span>
                        <input type="text"
                               [(ngModel)]="folderPath"
                               placeholder="/documents/contracts" />
                    </label>

                    <!-- The question is asked of the ORIGINAL, and only where
                         the format can answer it. Off by default: keeping the
                         uploaded bytes exactly as they are is what most people
                         want from a template they designed elsewhere. -->
                    @if (canConvert()) {
                        <label class="cms-document-upload__convert">
                            <input type="checkbox" [(ngModel)]="convert" />
                            <span>
                                <strong>Also make it editable here</strong>
                                <small>
                                    Reads the workbook into a CoolMS document you can edit in the
                                    grid. Your original file is kept beside it, so nothing is lost —
                                    but borders, images and charts are not part of the editable
                                    format.
                                </small>
                            </span>
                        </label>

                        <!-- Shown only once the conversion is asked for: on its
                             own this choice describes nothing. -->
                        @if (convert) {
                            <label class="cms-document-upload__field cms-document-upload__target">
                                <span>Add it as</span>
                                <select class="cms-input" [(ngModel)]="target">
                                    <option value="document">A document I can edit</option>
                                    <option value="template">A template to generate from</option>
                                </select>
                                <small>
                                    @if (target === 'document') {
                                        Lands in this folder, next to your other work.
                                    } @else {
                                        Lands in the folder's hidden templates area, ready to fill.
                                    }
                                </small>
                            </label>
                        }
                    }
                }

                <footer class="cms-document-upload__footer">
                    <button type="button"
                            class="cms-btn"
                            (click)="cancel()"
                            [disabled]="uploading()">
                        Cancel
                    </button>
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            (click)="submit()"
                            [disabled]="!canSubmit() || uploading()">
                        Upload
                    </button>
                </footer>
            </div>
        </app-modal>
    `,
    styles: [`
        .cms-document-upload {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 380px;
        }
        .cms-document-upload__progress {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 24px;
            justify-content: center;
        }
        .cms-document-upload__zone {
            display: block;
            width: 100%;
            padding: 24px;
            background: var(--cms-surface);
            border: 2px dashed var(--cms-border);
            border-radius: var(--cms-radius);
            cursor: pointer;
            font: inherit;
            color: inherit;
            text-align: center;
        }
        .cms-document-upload__zone:hover {
            border-color: var(--cms-text-muted);
        }
        .cms-document-upload__zone--has-file {
            border-style: solid;
            border-color: var(--cms-text-secondary);
            background: var(--cms-border-light);
        }
        .cms-document-upload__prompt i,
        .cms-document-upload__file i {
            font-size: 2rem;
            display: block;
            margin-bottom: 4px;
        }
        .cms-document-upload__accept {
            color: var(--cms-text-muted);
            font-size: 0.8rem;
            margin: 4px 0 0 0;
        }
        .cms-document-upload__file strong {
            display: block;
            word-break: break-word;
        }
        .cms-document-upload__size {
            color: var(--cms-text-muted);
            font-size: 0.8rem;
        }
        .cms-document-upload__clear {
            align-self: flex-end;
            background: none;
            border: 0;
            padding: 4px 8px;
            font: inherit;
            font-size: 0.85rem;
            color: var(--cms-text-muted);
            cursor: pointer;
        }
        .cms-document-upload__clear:hover {
            color: inherit;
        }
        .cms-document-upload__error {
            padding: 8px 12px;
            background: var(--cms-error-bg, #fee);
            color: var(--cms-error-text, #b10);
            border-radius: var(--cms-radius-sm);
            font-size: 0.85rem;
        }
        .cms-document-upload__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        /* The checkbox sits beside its explanation rather than above it: the
           small print is the part that makes the choice informed, so it has to
           read as one thing with the control. */
        .cms-document-upload__convert {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            cursor: pointer;
        }
        .cms-document-upload__convert input { margin-top: 3px; }
        .cms-document-upload__convert span { display: flex; flex-direction: column; gap: 2px; }
        .cms-document-upload__convert small {
            font-size: 0.78rem;
            line-height: 1.35;
            color: var(--cms-text-muted);
        }
        .cms-document-upload__field span {
            font-size: 0.85rem;
            color: var(--cms-text-muted);
        }
        .cms-document-upload__field input {
            padding: 6px 8px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            font: inherit;
        }
        .cms-document-upload__footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 8px;
            padding-top: 12px;
            border-top: 1px solid var(--cms-border-light);
        }
    `],
})
export class DocumentUploadDialog {
    private readonly dialogRef  = inject<DialogRef<DocumentTemplate | null>>(DialogRef);
    private readonly aggregator = inject(DocumentAggregatorService);
    private readonly formatInfo = inject(FormatInfoService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialog     = inject(Dialog);

    private readonly data = inject<DocumentUploadDialogData | null>(DIALOG_DATA, { optional: true });

    @ViewChild('fileInput') protected fileInput!: ElementRef<HTMLInputElement>;

    protected readonly selectedFile = signal<File | null>(null);

    /**
     * Whether to ALSO read the upload into an editable CoolMS document.
     *
     * Off by default, and that is the honest default: someone uploading a
     * workbook they designed in Excel usually wants it back exactly as it is,
     * and conversion trades fidelity — borders, images and charts have no place
     * in the grid model — for editability.
     */
    protected convert = false;

    /**
     * What the conversion produces.
     *
     * Defaults to a DOCUMENT: someone who ticked "make it editable here" has
     * said they want to work on the file, and a template is the answer to a
     * different question — it was also the only answer available until the
     * conversion learnt to produce both.
     */
    protected target: NativeTarget = 'document';

    /**
     * Only spreadsheets can be converted today.
     *
     * Word's native source is a `.dtmpl` and Presentation has no native format
     * yet, so offering the choice for those would be a promise the backend
     * would silently decline. Decided from the FILE rather than from a
     * capability endpoint because the backend already ignores the flag where it
     * does not apply — the checkbox is an affordance, not the gate.
     */
    protected readonly canConvert = computed(() => {
        const name = this.selectedFile()?.name.toLowerCase() ?? '';

        return name.endsWith('.xlsx');
    });

    protected readonly uploading = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected folderPath = this.data?.folderPath ?? '/documents/';

    protected readonly acceptString = computed(() => this.formatInfo.acceptString());

    protected readonly canSubmit = computed(() => {
        return this.selectedFile() !== null && this.folderPath.trim().length > 0;
    });

    protected onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        if (file) {
            this.selectedFile.set(file);
            this.errorMessage.set(null);
        }
    }

    protected clearFile(): void {
        this.selectedFile.set(null);
        if (this.fileInput) {
            this.fileInput.nativeElement.value = '';
        }
    }

    protected submit(): void {
        const file = this.selectedFile();
        if (!file || this.uploading()) {
            return;
        }
        void this.uploadWithConflictResolution(file, this.folderPath.trim());
    }

    /**
     * Drives the upload through the backend, falling back to the
     * Template-Name-Conflict dialog on a 409. The conflict dialog's
     * three outcomes branch as:
     *
     *   - `replace`  → close this dialog with the template returned
     *                  by the Replace flow (or `null` if the user
     *                  cancelled inside Replace);
     *   - `save-as`  → rename the File in-place and retry — may
     *                  recurse if the new name also collides, which
     *                  terminates when the user picks a free name
     *                  or cancels;
     *   - `cancel`   → leave the dialog open in its idle state so
     *                  the user can adjust the filename / folder
     *                  and try again.
     */
    private async uploadWithConflictResolution(file: File, folderPath: string): Promise<void> {
        this.uploading.set(true);
        this.errorMessage.set(null);
        try {
            const template = await firstValueFrom(
                this.aggregator.uploadTemplate(
                    file,
                    folderPath,
                    this.convert && this.canConvert(),
                    this.target,
                ),
            );
            this.uploading.set(false);
            this.dialogRef.close(template);
        } catch (err: unknown) {
            if (isTemplateNameConflict(err)) {
                const resolved = await this.handleNameConflict(file, folderPath, err.error);
                if (resolved !== undefined) {
                    this.dialogRef.close(resolved);
                }
                return;
            }
            this.uploading.set(false);
            this.errorMessage.set(this.extractErrorMessage(err));
        }
    }

    /**
     * Open the conflict dialog and dispatch the user's choice.
     * Returns:
     *   - `undefined` when the user cancelled (caller keeps the
     *     upload dialog open so the user can rename or pick a
     *     different folder without rebuilding from scratch);
     *   - `DocumentTemplate` when Replace finished and the upload
     *     dialog should close with the resulting template;
     *   - `null` when Replace was launched but the user backed out
     *     of it — upload dialog still closes (the user opted out
     *     of both the original upload and the Replace flow).
     */
    private async handleNameConflict(
        file: File,
        folderPath: string,
        payload: TemplateNameConflictPayload,
    ): Promise<DocumentTemplate | null | undefined> {
        const ref = this.dialog.open<TemplateConflictDialogResult | null, TemplateConflictDialogData>(
            TemplateConflictDialogComponent,
            {
                data: {
                    existing:      payload.existing,
                    suggestedName: payload.suggestedName,
                    proposedFile:  file,
                    folderPath:    payload.folderPath,
                },
                hasBackdrop: true,
            },
        );
        const result = await firstValueFrom(ref.closed);
        this.uploading.set(false);

        if (!result || result.action === 'cancel') {
            return undefined;
        }

        if (result.action === 'replace') {
            try {
                return await this.openReplaceFlow(payload.existing.id, file);
            } catch (replaceErr: unknown) {
                this.errorMessage.set(
                    `Could not open Replace flow: ${this.extractErrorMessage(replaceErr)}`,
                );
                return undefined;
            }
        }

        // save-as: retry with the renamed file. May 409 again — the
        // recursion terminates when the user picks a non-colliding
        // name or cancels.
        const renamed = new File([file], result.newName ?? payload.suggestedName, { type: file.type });
        this.selectedFile.set(renamed);
        await this.uploadWithConflictResolution(renamed, folderPath);
        return undefined; // uploadWithConflictResolution already closed the dialog on success
    }

    private async openReplaceFlow(templateId: string, file: File): Promise<DocumentTemplate | null> {
        // The Replace dialog wants a full DocumentTemplate, not an id
        // — fetch it via the aggregator so the dropzone-skip path
        // can hand off straight to preview.
        const template = await firstValueFrom(this.aggregator.getTemplate(templateId));
        const ref = this.dialog.open<DocumentTemplate | null, ReplaceTemplateDialogData>(
            ReplaceTemplateDialogComponent,
            {
                data: { template, preLoadedFile: file },
                hasBackdrop: true,
            },
        );
        const updated = await firstValueFrom(ref.closed);
        return updated ?? null;
    }

    protected cancel(): void {
        if (!this.uploading()) {
            this.dialogRef.close(null);
        }
    }

    protected formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    /**
     * Pulls a user-readable message out of an HTTP error. The backend
     * surfaces validation failures as RFC 7807 problem-details with a
     * `detail` field; older / non-API-Platform endpoints land on
     * `message`. Falls back to a generic prefix when neither is set.
     *
     * Template-name conflict (409): the backend's
     * `TemplateNameConflictListener` returns a structured payload with
     * `suggestedName` + `existing` so a future enhancement can offer a
     * one-click Replace / Save-with-new-name dialog. Today the human-
     * readable `detail` (which embeds the suggested name) is enough
     * for the user to rename their file and retry.
     */
    private extractErrorMessage(err: unknown): string {
        if (typeof err === 'object' && err !== null) {
            const e = err as {
                status?: number;
                error?: { detail?: string; type?: string; suggestedName?: string };
                message?: string;
            };
            const detail = e.error?.detail;
            if (e.status === 409 && typeof e.error?.type === 'string'
                && e.error.type.includes('template-name-conflict')) {
                return detail ?? 'A template with this name already exists in this folder.';
            }
            if (e.status === 422) {
                return detail ?? 'Validation error.';
            }
            if (e.status === 415) {
                return detail ?? 'Unsupported file format.';
            }
            return `Upload failed: ${detail ?? e.message ?? 'unknown error'}`;
        }
        return 'Upload failed.';
    }
}
