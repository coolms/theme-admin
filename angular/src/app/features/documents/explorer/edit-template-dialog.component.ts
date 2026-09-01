import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { concatMap, map, of } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { type DocumentTemplate, type OutputFormatOption } from '../shared/document-explorer.types';
import { WordTemplateService } from '../word/word-template.service';
import {
    DocumentPageSizeService,
    type DocumentPageSizeOption,
} from '../word/document-page-size.service';

/**
 * Edit Template dialog. Uses the shared CMS dialog shell (header / body
 * / footer, CMS dialog tokens) and edits three metadata fields:
 *   - `name`   — display label shown on tiles, used as the base for
 *                future instance filenames
 *   - `instanceNameSuffix` — DTMPL pattern appended to `name` when
 *                            generating; backend validates syntax
 *   - `defaultOutputFormat` — pre-selected format in the Generate
 *                             dialog; backend narrows to the
 *                             template's format's allow list
 *
 * Closes with the updated DocumentTemplate on save, or `null` on cancel.
 * Server-side validation errors render inline next to the offending field.
 */
export interface EditTemplateDialogData {
    readonly template: DocumentTemplate;
}

const FORMAT_OUTPUT_OPTIONS: Readonly<Record<string, readonly OutputFormatOption[]>> = {
    word: [
        { value: 'docx', label: 'Word (.docx)' },
        { value: 'pdf', label: 'PDF (.pdf)' },
    ],
    // — a spreadsheet template produces a spreadsheet. Without this entry
    // it fell through to the Word fallback below and offered .docx, which no
    // renderer supports for an xlsx source: the operator would have picked it
    // and got a generation that failed with nothing on screen explaining why.
    // PDF joined in (LibreOffice paginates the filled workbook).
    spreadsheet: [
        { value: 'xlsx', label: 'Excel (.xlsx)' },
        { value: 'pdf', label: 'PDF (.pdf)' },
    ],
    // — same reasoning as spreadsheet: a deck template produces a deck.
    // PDF is one page per slide — the handout for recipients without
    // PowerPoint.
    presentation: [
        { value: 'pptx', label: 'PowerPoint (.pptx)' },
        { value: 'pdf', label: 'PDF (.pdf)' },
    ],
};

const FORMAT_OUTPUT_FALLBACK: readonly OutputFormatOption[] = [
    { value: 'docx', label: 'Word (.docx)' },
    { value: 'pdf', label: 'PDF (.pdf)' },
];

@Component({
    selector: 'cms-edit-template-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog cms-edit-template-dialog">
            <div class="cms-dialog-header">
                <i class="bi bi-pencil-square" style="color: var(--cms-accent)"></i>
                <span>Edit {{ data.template.name }}</span>
                <button type="button" class="cms-dialog-close" (click)="cancel()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body">
                <div class="cms-edit-template-dialog__field">
                    <label class="cms-label" for="cms-edit-template-name">Label</label>
                    <input
                        id="cms-edit-template-name"
                        type="text"
                        class="cms-input"
                        [ngModel]="name()"
                        (ngModelChange)="name.set($event)"
                        required
                    />
                </div>

                <div class="cms-edit-template-dialog__field">
                    <label class="cms-label" for="cms-edit-template-suffix">Instance name suffix</label>
                    <input
                        id="cms-edit-template-suffix"
                        type="text"
                        class="cms-input cms-edit-template-dialog__mono"
                        [ngModel]="suffix()"
                        (ngModelChange)="suffix.set($event)"
                        [placeholder]="suffixPlaceholder"
                    />
                    @if (suffixError()) {
                        <p class="cms-edit-template-dialog__error">{{ suffixError() }}</p>
                    } @else {
                        <p class="cms-edit-template-dialog__hint">
                            DTMPL syntax. Available variables: any from the generate context, plus
                            <code>&#123;var:metadata.counter&#125;</code>, <code>&#123;var:metadata.generatedAt&#125;</code>.
                        </p>
                    }
                </div>

                <div class="cms-edit-template-dialog__field">
                    <label class="cms-label" for="cms-edit-template-default-format">Default output format</label>
                    <select
                        id="cms-edit-template-default-format"
                        class="cms-select"
                        [ngModel]="defaultOutputFormat()"
                        (ngModelChange)="defaultOutputFormat.set($event)"
                    >
                        @for (option of availableFormats(); track option.value) {
                            <option [value]="option.value">{{ option.label }}</option>
                        }
                    </select>
                    @if (formatError()) {
                        <p class="cms-edit-template-dialog__error">{{ formatError() }}</p>
                    }
                </div>

                <!-- Page size applies only to natively-authored (DTMPL)
                     templates: those render through PhpWordDocumentRenderer,
                     which honours extras.pageSize. Imported .docx templates are
                     read-only (mode 0444) and keep their original page, so the
                     control is hidden for them. -->
                @if (data.template.native) {
                    <div class="cms-edit-template-dialog__field">
                        <label class="cms-label" for="cms-edit-template-page-size">Page size</label>
                        <select
                            id="cms-edit-template-page-size"
                            class="cms-select"
                            [ngModel]="pageSize()"
                            (ngModelChange)="pageSize.set($event)"
                        >
                            <option value="">Default page</option>
                            @for (option of pageSizeOptions(); track option.value) {
                                <option [value]="option.value">{{ option.label }}</option>
                            }
                        </select>
                        <p class="cms-edit-template-dialog__hint">
                            Sets the paper size of generated documents (DOCX / PDF). Leave on
                            <em>Default page</em> to keep the renderer's default.
                        </p>
                    </div>

                    <!-- Orientation is its own axis: applied on top of
                         whichever size is chosen, so A3 landscape is expressible
                         without a preset per pairing. The backend has carried it;
this is the control that lets anyone set it. -->
                    <div class="cms-edit-template-dialog__field">
                        <label class="cms-label" for="cms-edit-template-page-orientation">Orientation</label>
                        <select
                            id="cms-edit-template-page-orientation"
                            class="cms-select"
                            [ngModel]="pageOrientation()"
                            (ngModelChange)="pageOrientation.set($event)"
                        >
                            <option value="">As the size defines</option>
                            @for (option of orientationOptions(); track option.value) {
                                <option [value]="option.value">{{ option.label }}</option>
                            }
                        </select>
                        <p class="cms-edit-template-dialog__hint">
                            Applies on top of the page size — <em>Wide</em> is already landscape,
                            so leaving this unset keeps each preset's own orientation.
                        </p>
                    </div>
                }

                <div class="cms-edit-template-dialog__field">
                    <label class="cms-edit-template-dialog__checkbox-label">
                        <input
                            type="checkbox"
                            class="cms-edit-template-dialog__checkbox"
                            [checked]="publiclyAccessible()"
                            (change)="publiclyAccessible.set(asChecked($event))"
                        />
                        <span>Public access</span>
                    </label>
                    <p class="cms-edit-template-dialog__hint cms-edit-template-dialog__hint--warning">
                        Allow anonymous visitors to trigger this template from public pages.
                        Visitors do not need to sign in. Use with caution -- the template can be
                        run by anyone who can reach the page that embeds it.
                    </p>
                </div>

                @if (genericError()) {
                    <p class="cms-edit-template-dialog__error">{{ genericError() }}</p>
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn" [disabled]="saving()" (click)="cancel()">Cancel</button>
                <button type="button"
                        class="cms-btn cms-btn-primary"
                        [disabled]="saving() || !canSave()"
                        (click)="save()">
                    @if (saving()) {
                        Saving…
                    } @else {
                        Save
                    }
                </button>
            </div>
        </div>
    `,
    styles: [`
        .cms-edit-template-dialog { min-width: 480px; max-width: 560px; }
        .cms-dialog-body { display: flex; flex-direction: column; gap: 16px; }
        .cms-edit-template-dialog__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .cms-edit-template-dialog__mono {
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
        }
        .cms-edit-template-dialog__hint {
            font-size: 0.75rem;
            color: var(--cms-text-muted);
            margin: 0;
        }
        .cms-edit-template-dialog__hint--warning {
            color: var(--cms-warning, #d97706);
        }
        .cms-edit-template-dialog__hint code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
            font-size: 0.7rem;
        }
        .cms-edit-template-dialog__checkbox-label {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 0.875rem;
            color: var(--cms-text);
            cursor: pointer;
        }
        .cms-edit-template-dialog__checkbox {
            width: 16px;
            height: 16px;
            accent-color: var(--cms-accent);
        }
        .cms-edit-template-dialog__error {
            font-size: 0.8rem;
            color: var(--cms-danger, #dc2626);
            margin: 0;
        }
    `],
})
export class EditTemplateDialogComponent {
    readonly dialogRef = inject<DialogRef<DocumentTemplate | null>>(DialogRef);
    readonly data = inject<EditTemplateDialogData>(DIALOG_DATA);

    private readonly templates = inject(WordTemplateService);
    private readonly pageSizes = inject(DocumentPageSizeService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly name = signal<string>(this.data.template.name);
    protected readonly suffix = signal<string>(this.data.template.instanceNameSuffix ?? '');
    protected readonly defaultOutputFormat = signal<string>(this.data.template.defaultOutputFormat);
    protected readonly publiclyAccessible = signal<boolean>(this.data.template.publiclyAccessible);
    protected readonly suffixPlaceholder = '_{var:counter|pad:4,`0`}';

    /**
     * Page size— page-size / docx-width). Mirrors the content
     * page-editor's Layout panel: the DOCX preset catalog + the template's
     * current size are fetched on open, and the choice is persisted via a VFS
     * merge-patch on the template Node's `extras.pageSize`. The template's VFS
     * `path` (the merge-patch target) and the loaded value are held so Save can
     * skip the write when nothing changed.
     */
    protected readonly pageSizeOptions = signal<readonly DocumentPageSizeOption[]>([]);
    protected readonly pageSize = signal<string>('');
    protected readonly orientationOptions = signal<readonly DocumentPageSizeOption[]>([]);
    protected readonly pageOrientation = signal<string>('');
    private readonly templatePath = signal<string | null>(null);
    private loadedPageSize = '';
    private loadedPageOrientation = '';

    protected readonly saving = signal<boolean>(false);
    protected readonly suffixError = signal<string | null>(null);
    protected readonly formatError = signal<string | null>(null);
    protected readonly genericError = signal<string | null>(null);

    protected readonly availableFormats = computed<readonly OutputFormatOption[]>(() => {
        const formatKey = this.data.template.format;
        return FORMAT_OUTPUT_OPTIONS[formatKey] ?? FORMAT_OUTPUT_FALLBACK;
    });

    protected readonly canSave = computed(() => this.name().trim().length > 0);

    constructor() {
        // Page size is editable only for native (DTMPL) templates — imported
        // .docx templates are read-only at the VFS layer (mode 0444) and keep
        // their original page, so skip the fetch and never render the control.
        if (!this.data.template.native) {
            return;
        }
        // Seed the page-size dropdown (DOCX catalog) + the template's current
        // size and VFS path. Failure leaves the control on "Default page" and
        // unsaveable (no path) — it degrades silently rather than blocking the
        // rest of the metadata edit.
        this.pageSizes
            .fetch(this.data.template.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (dto) => {
                    this.pageSizeOptions.set(dto.options ?? []);
                    this.loadedPageSize = dto.pageSize ?? '';
                    this.pageSize.set(this.loadedPageSize);
                    this.orientationOptions.set(dto.orientationOptions ?? []);
                    this.loadedPageOrientation = dto.pageOrientation ?? '';
                    this.pageOrientation.set(this.loadedPageOrientation);
                    this.templatePath.set(dto.path ?? null);
                },
                error: () => {
                    this.pageSizeOptions.set([]);
                    this.orientationOptions.set([]);
                },
            });
    }

    protected cancel(): void {
        this.dialogRef.close(null);
    }

    protected save(): void {
        if (this.saving() || !this.canSave()) {
            return;
        }
        this.saving.set(true);
        this.suffixError.set(null);
        this.formatError.set(null);
        this.genericError.set(null);

        const metadata$ = this.templates.update(this.data.template.id, {
            name: this.name().trim(),
            instanceNameSuffix: this.suffix(),
            defaultOutputFormat: this.defaultOutputFormat(),
            publiclyAccessible: this.publiclyAccessible(),
        });

        // Page size + orientation persist separately, as ONE VFS merge-patch on
        // the template Node's `extras` (mirroring the content Layout panel).
        // Only written when something actually changed and we know the Node's
        // path. Both keys travel together: they are two halves of the same
        // paper, and a patch carrying one would clear the other.
        const path = this.templatePath();
        const paperChanged = this.pageSize() !== this.loadedPageSize
            || this.pageOrientation() !== this.loadedPageOrientation;
        const pageSize$ = path && paperChanged
            ? this.pageSizes.save(path, this.pageSize() || null, this.pageOrientation() || null)
            : of(null);

        // SEQUENCED, not forkJoin. Both endpoints write the same `extras` JSON
        // column by read-modify-write, so running them concurrently is a lost
        // update: the metadata processor loads extras, the VFS merge-patch
        // commits pageSize, and then the metadata write lands with its stale
        // copy and the paper silently reverts. Save reported success either
        // way — the only way to see it was to read the value back.
        metadata$
            .pipe(
                concatMap((updated) => pageSize$.pipe(map(() => updated))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: (updated) => {
                    this.saving.set(false);
                    this.loadedPageSize = this.pageSize();
                    this.loadedPageOrientation = this.pageOrientation();
                    this.toast.success('Template updated.');
                    this.dialogRef.close(updated);
                },
                error: (err: HttpErrorResponse) => {
                    this.saving.set(false);
                    this.applyServerError(err);
                },
            });
    }

    /**
     * Routes a 422 Problem-Details message to the field-specific
     * error signal so the user sees the failure inline.
     */
    private applyServerError(err: HttpErrorResponse): void {
        const detail = this.extractDetail(err);
        if (err.status === 422 && detail.includes('suffix')) {
            this.suffixError.set(detail);
        } else if (err.status === 422 && detail.includes('output format')) {
            this.formatError.set(detail);
        } else {
            this.genericError.set(detail);
            this.toast.error('Failed to update template: ' + detail);
        }
    }

    private extractDetail(err: HttpErrorResponse): string {
        const body = err.error as { detail?: string; message?: string } | null;
        return body?.detail ?? body?.message ?? err.message ?? 'Unknown error';
    }

    protected asChecked(event: Event): boolean {
        const target = event.target as HTMLInputElement | null;
        return target?.checked ?? false;
    }
}
