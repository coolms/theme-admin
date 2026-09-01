import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';

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

import { ToastService } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import { type FormatDisplayInfo } from '../shared/format-info.types';
import {
    WordTemplateService,
    type ReplacePreviewResponse,
} from '../word/word-template.service';
import { FormatInfoService } from './format-info.service';
import {
    extensionForMimeIn,
    extensionForSourceMime,
    importedSourceMime,
} from './template-source.helpers';

/**
 * F.14c-3b — Replace template source file. Two-phase dialog:
 *   1. Selection — dropzone + click-to-browse, show file info on pick.
 *   2. Preview   — backend's classification (compatible / extended /
 *                  different) plus per-variable diff. User confirms via
 *                  the primary "Replace" button.
 *
 * Closes with the updated DocumentTemplate on commit, or `null` on
 * cancel. Format mismatch (e.g. PDF for a Word template) renders an
 * inline error and keeps the dialog in Phase A.
 *
 * The picker is per-FORMAT, not Word: this dialog opens for whichever
 * template is selected, so a hard-coded `.docx` accept made replacing a
 * spreadsheet or presentation source a fight with the file chooser under copy
 * that named the wrong application. The accepted extension comes from
 * `format-info` — narrowed to the IMPORTED half of the source axis, which is
 * the only half `replaceSource()` takes (see `importedSourceMime()`).
 */
export interface ReplaceTemplateDialogData {
    readonly template: DocumentTemplate;
    /**
     * Optional pre-loaded source file. When provided (e.g. the user
     * picked Replace from a Template-Name-Conflict dialog after an
     * upload collision), the dialog skips the dropzone phase and
     * runs the preview against this file immediately. Leaving it
     * `undefined` keeps the legacy two-phase flow.
     */
    readonly preLoadedFile?: File;
}

type Phase = 'select' | 'preview';

const CLASS_LABEL: Readonly<Record<ReplacePreviewResponse['classification'], string>> = {
    compatible: 'Compatible',
    extended: 'New variables added',
    different: 'Schema will be replaced',
};

const CLASS_DESCRIPTION: Readonly<Record<ReplacePreviewResponse['classification'], string>> = {
    compatible:
        'The new file uses the same variables as the current template. Existing instances and forms will continue to work.',
    extended:
        'The new file adds variables. The form schema will be updated to include them. Existing variables are preserved.',
    different:
        'The new file uses different variables. The form schema will be replaced. Suffix references using removed variables may render as empty.',
};

@Component({
    selector: 'cms-replace-template-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        <div class="cms-dialog cms-replace-template-dialog">
            <div class="cms-dialog-header">
                <i class="bi bi-arrow-repeat" style="color: var(--cms-accent)"></i>
                <span>Replace source file for {{ data.template.name }}</span>
                <button type="button" class="cms-dialog-close" (click)="cancel()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body">
                @if (phase() === 'select') {
                    <div
                        class="cms-replace-template-dialog__dropzone"
                        [class.cms-replace-template-dialog__dropzone--active]="dragActive()"
                        (dragover)="onDragOver($event)"
                        (dragleave)="onDragLeave($event)"
                        (drop)="onDrop($event)"
                        (click)="fileInput.click()"
                    >
                        <i class="bi bi-cloud-upload cms-replace-template-dialog__dropzone-icon"></i>
                        @if (selectedFile(); as f) {
                            <p class="cms-replace-template-dialog__file-name">{{ f.name }}</p>
                            <p class="cms-replace-template-dialog__file-meta">
                                {{ formatSize(f.size) }} · {{ f.type || 'unknown type' }}
                            </p>
                        } @else {
                            @if (acceptExtension(); as ext) {
                                <p>Drop a {{ ext }} file here, or click to browse.</p>
                                <p class="cms-replace-template-dialog__hint">
                                    Accepted: {{ formatLabel() }} ({{ ext }}) matching template format.
                                </p>
                            } @else {
                                <p>Drop the template's source file here, or click to browse.</p>
                                <p class="cms-replace-template-dialog__hint">
                                    Accepted: {{ formatLabel() }} source matching template format.
                                </p>
                            }
                        }
                        <input
                            #fileInput
                            type="file"
                            [accept]="acceptAttribute()"
                            hidden
                            (change)="onFileInputChange($event)"
                        />
                    </div>

                    @if (selectionError()) {
                        <p class="cms-replace-template-dialog__error">{{ selectionError() }}</p>
                    }
                } @else {
                    @if (preview(); as p) {
                        <div
                            class="cms-replace-template-dialog__badge"
                            [attr.data-class]="p.classification"
                        >
                            {{ classLabel(p.classification) }}
                        </div>
                        <p class="cms-replace-template-dialog__class-description">
                            {{ classDescription(p.classification) }}
                        </p>

                        <dl class="cms-replace-template-dialog__diff">
                            @if (p.added.length > 0) {
                                <dt class="cms-replace-template-dialog__diff-section cms-replace-template-dialog__diff-section--added">
                                    Added ({{ p.added.length }})
                                </dt>
                                @for (path of p.added; track path) {
                                    <dd class="cms-replace-template-dialog__diff-item cms-replace-template-dialog__diff-item--added">
                                        <code>{{ path }}</code>
                                    </dd>
                                }
                            }
                            @if (p.removed.length > 0) {
                                <dt class="cms-replace-template-dialog__diff-section cms-replace-template-dialog__diff-section--removed">
                                    Removed ({{ p.removed.length }})
                                </dt>
                                @for (path of p.removed; track path) {
                                    <dd class="cms-replace-template-dialog__diff-item cms-replace-template-dialog__diff-item--removed">
                                        <code>{{ path }}</code>
                                    </dd>
                                }
                            }
                            @if (p.unchanged.length > 0) {
                                <dt
                                    class="cms-replace-template-dialog__diff-section cms-replace-template-dialog__diff-section--unchanged"
                                    (click)="unchangedExpanded.set(!unchangedExpanded())"
                                >
                                    <i class="bi" [class.bi-chevron-right]="!unchangedExpanded()"
                                       [class.bi-chevron-down]="unchangedExpanded()"></i>
                                    Unchanged ({{ p.unchanged.length }})
                                </dt>
                                @if (unchangedExpanded()) {
                                    @for (path of p.unchanged; track path) {
                                        <dd class="cms-replace-template-dialog__diff-item cms-replace-template-dialog__diff-item--unchanged">
                                            <code>{{ path }}</code>
                                        </dd>
                                    }
                                }
                            }
                        </dl>

                        <button type="button" class="cms-replace-template-dialog__back" (click)="backToSelect()">
                            ← Choose different file
                        </button>
                    }

                    @if (commitError()) {
                        <p class="cms-replace-template-dialog__error">{{ commitError() }}</p>
                    }
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn" [disabled]="loading()" (click)="cancel()">Cancel</button>
                @if (phase() === 'select') {
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            [disabled]="loading() || !selectedFile()"
                            (click)="loadPreview()">
                        @if (loading()) { Loading… } @else { Preview }
                    </button>
                } @else {
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            [disabled]="loading()"
                            (click)="commit()">
                        @if (loading()) { Replacing… } @else { Replace }
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .cms-replace-template-dialog { min-width: 520px; max-width: 620px; }
        .cms-dialog-body { display: flex; flex-direction: column; gap: 16px; }

        .cms-replace-template-dialog__dropzone {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 32px 16px;
            border: 2px dashed var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-surface);
            cursor: pointer;
            text-align: center;
            transition: border-color 0.1s, background 0.1s;
        }
        .cms-replace-template-dialog__dropzone:hover {
            border-color: var(--cms-text-muted);
        }
        .cms-replace-template-dialog__dropzone--active {
            border-color: var(--cms-accent);
            background: var(--cms-accent-light, var(--cms-border-light));
        }
        .cms-replace-template-dialog__dropzone p {
            margin: 0;
        }
        .cms-replace-template-dialog__dropzone-icon {
            font-size: 2rem;
            color: var(--cms-text-muted);
            margin-bottom: 4px;
        }
        .cms-replace-template-dialog__hint {
            font-size: 0.75rem;
            color: var(--cms-text-muted);
        }
        .cms-replace-template-dialog__file-name {
            font-weight: 500;
        }
        .cms-replace-template-dialog__file-meta {
            font-size: 0.75rem;
            color: var(--cms-text-muted);
        }

        .cms-replace-template-dialog__badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: var(--cms-radius-sm);
            font-weight: 500;
            font-size: 0.85rem;
        }
        .cms-replace-template-dialog__badge[data-class="compatible"] {
            background: var(--cms-success-light);
            color: var(--cms-success-text);
        }
        .cms-replace-template-dialog__badge[data-class="extended"] {
            background: var(--cms-warning-light);
            color: var(--cms-warning-text);
        }
        .cms-replace-template-dialog__badge[data-class="different"] {
            background: var(--cms-warning-subtle);
            color: var(--cms-warning-text);
        }
        .cms-replace-template-dialog__class-description {
            font-size: 0.85rem;
            color: var(--cms-text-secondary);
            margin: 0;
        }

        .cms-replace-template-dialog__diff {
            margin: 0;
            padding: 0;
        }
        .cms-replace-template-dialog__diff-section {
            margin-top: 12px;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .cms-replace-template-dialog__diff-section--added { color: var(--cms-success-text); }
        .cms-replace-template-dialog__diff-section--removed { color: var(--cms-danger-text); }
        .cms-replace-template-dialog__diff-section--unchanged { cursor: pointer; user-select: none; }

        .cms-replace-template-dialog__diff-item {
            margin: 2px 0 2px 14px;
            font-size: 0.85rem;
        }
        .cms-replace-template-dialog__diff-item code {
            background: var(--cms-border-light);
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
        }
        .cms-replace-template-dialog__diff-item--added code {
            background: var(--cms-success-light);
            color: var(--cms-success-text);
        }
        .cms-replace-template-dialog__diff-item--removed code {
            background: var(--cms-danger-light);
            color: var(--cms-danger-text);
        }

        .cms-replace-template-dialog__back {
            background: none;
            border: 0;
            color: var(--cms-text-secondary);
            cursor: pointer;
            font-size: 0.85rem;
            padding: 4px 0;
            margin-top: 4px;
            text-align: left;
        }
        .cms-replace-template-dialog__back:hover {
            color: var(--cms-text);
        }

        .cms-replace-template-dialog__error {
            font-size: 0.8rem;
            color: var(--cms-danger, #dc2626);
            margin: 0;
        }
    `],
})
export class ReplaceTemplateDialogComponent {
    readonly dialogRef = inject<DialogRef<DocumentTemplate | null>>(DialogRef);
    readonly data = inject<ReplaceTemplateDialogData>(DIALOG_DATA);

    private readonly templates = inject(WordTemplateService);
    private readonly formatInfo = inject(FormatInfoService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * This template's `format-info` entry, or null while unresolved. Seeded
     * from the service's cache (the Document Library loads the whole registry
     * on mount) and otherwise fetched `?format=`-filtered — which is why it is
     * held HERE: a filtered payload deliberately never enters that shared
     * cache, so the grid behind the dialog keeps every format it knows.
     */
    private readonly formatEntry = signal<FormatDisplayInfo | null>(null);

    /**
     * The mime a replacement must carry. Fixed for the dialog's lifetime —
     * `data.template` does not change while it is open.
     */
    private readonly importedMime = importedSourceMime(this.data.template);

    @ViewChild('fileInput') protected fileInput!: ElementRef<HTMLInputElement>;

    protected readonly phase = signal<Phase>('select');
    protected readonly selectedFile = signal<File | null>(null);
    protected readonly dragActive = signal<boolean>(false);
    protected readonly loading = signal<boolean>(false);
    protected readonly selectionError = signal<string | null>(null);
    protected readonly commitError = signal<string | null>(null);
    protected readonly preview = signal<ReplacePreviewResponse | null>(null);
    protected readonly unchangedExpanded = signal<boolean>(false);

    protected readonly canPreview = computed(() => this.selectedFile() !== null);

    /**
     * The imported extension, e.g. `.xlsx` for a spreadsheet template — the
     * backend's answer where there is one, the local fallback map otherwise,
     * and `''` when neither knows the mime. Empty leaves the picker
     * unfiltered rather than filtered to a guess.
     */
    protected readonly acceptExtension = computed<string>(() => {
        const mime = this.importedMime;
        if (null === mime) {
            return '';
        }
        const entry = this.formatEntry();

        return extensionForSourceMime(mime, entry ? extensionForMimeIn([entry], mime) : null);
    });

    /**
     * The `accept` attribute — extension AND mime, as the hard-coded Word
     * value carried: a chooser matches either, and a `.docx` renamed by a
     * download that stripped its extension still has its type.
     */
    protected readonly acceptAttribute = computed<string>(() =>
        [this.acceptExtension(), this.importedMime ?? '']
            .filter((part) => '' !== part)
            .join(','),
    );

    /**
     * Human name for the format. The service's own fallback chain covers the
     * unresolved case, so the copy never renders a bare discriminator key
     * unless the backend advertises a format nothing here has heard of.
     */
    protected readonly formatLabel = computed<string>(
        () => this.formatEntry()?.label ?? this.formatInfo.label(this.data.template.format),
    );

    constructor() {
        // The format's accept string and label. Cache first — the Document
        // Library has loaded the whole registry by the time any of its rows
        // can be selected — and a `?format=`-filtered fetch only when it has
        // not (payload in flight, or its request failed and was swallowed).
        // Errors here are swallowed too: the fallback maps still name the
        // imported extension of every format that exists today.
        const advertised = this.formatInfo.getFormatByName(this.data.template.format);
        if (advertised) {
            this.formatEntry.set(advertised);
        } else {
            this.formatInfo
                .loadFormatInfo(this.data.template.format)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: (info) => {
                        this.formatEntry.set(
                            info.formats.find((f) => f.format === this.data.template.format) ?? null,
                        );
                    },
                    error: () => undefined,
                });
        }

        // When the dialog opens with a pre-loaded file (Template-name-
        // conflict flow handing the upload off to Replace) skip the
        // dropzone phase and run the preview immediately. The user
        // already picked the file once in the upload dialog; asking
        // again would be redundant. Without a pre-loaded file the
        // legacy two-phase select → preview flow runs unchanged.
        const preLoaded = this.data.preLoadedFile;
        if (preLoaded) {
            this.selectedFile.set(preLoaded);
            this.loadPreview();
        }
    }

    protected onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive.set(true);
    }

    protected onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive.set(false);
    }

    protected onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive.set(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            this.acceptFile(file);
        }
    }

    protected onFileInputChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            this.acceptFile(file);
        }
    }

    private acceptFile(file: File): void {
        this.selectionError.set(null);
        this.selectedFile.set(file);
    }

    protected loadPreview(): void {
        const file = this.selectedFile();
        if (!file || this.loading()) {
            return;
        }
        this.loading.set(true);
        this.selectionError.set(null);
        this.templates
            .previewReplace(this.data.template.id, file)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (result) => {
                    this.loading.set(false);
                    this.preview.set(result);
                    this.phase.set('preview');
                },
                error: (err: HttpErrorResponse) => {
                    this.loading.set(false);
                    this.selectionError.set(this.extractDetail(err));
                },
            });
    }

    protected commit(): void {
        const file = this.selectedFile();
        if (!file || this.loading()) {
            return;
        }
        this.loading.set(true);
        this.commitError.set(null);
        this.templates
            .commitReplace(this.data.template.id, file)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (updated) => {
                    this.loading.set(false);
                    this.toast.success('Template replaced.');
                    this.dialogRef.close(updated);
                },
                error: (err: HttpErrorResponse) => {
                    this.loading.set(false);
                    this.commitError.set(this.extractDetail(err));
                },
            });
    }

    protected backToSelect(): void {
        this.phase.set('select');
        this.preview.set(null);
        this.commitError.set(null);
        this.unchangedExpanded.set(false);
    }

    protected cancel(): void {
        this.dialogRef.close(null);
    }

    protected formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    protected classLabel(c: ReplacePreviewResponse['classification']): string {
        return CLASS_LABEL[c];
    }

    protected classDescription(c: ReplacePreviewResponse['classification']): string {
        return CLASS_DESCRIPTION[c];
    }

    private extractDetail(err: HttpErrorResponse): string {
        const body = err.error as { detail?: string; message?: string; title?: string } | null;
        return body?.detail ?? body?.message ?? body?.title ?? err.message ?? 'Unknown error';
    }
}
