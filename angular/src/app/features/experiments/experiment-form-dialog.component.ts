import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ExperimentDto, ExperimentsService } from './experiments.service';

/** Editable working copy of a variant row in the dialog. */
interface VariantRow {
    key:    string;
    label:  string;
    weight: number;
}

/** Experiment keys / variant keys must be a URL-safe slug (mirrors the backend VO). */
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * W8 — "New experiment" / "Edit experiment" modal (#786).
 *
 * **Create mode** (no dialog data): captures the experiment key + name and a
 * repeatable variant editor (key / label / weight rows, minimum two). The new
 * experiment starts `running` — the server default.
 *
 * **Edit mode** (an {@link ExperimentDto} passed as dialog data): the key and
 * the variant *keys* are frozen (the counters are keyed by them), so only the
 * name, variant labels and weights are editable, and rows can't be added or
 * removed. Mirrors the backend's `updateDefinition` rule.
 *
 * Validation mirrors the backend domain rules so common mistakes are caught
 * inline; anything the server still rejects surfaces as a humanized 422.
 * Resolves the dialog with the saved {@link ExperimentDto} (or `null` on cancel).
 */
@Component({
    selector: 'app-experiment-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="isEdit ? 'Edit experiment' : 'New experiment'" [width]="560">
            <div class="fields">
                <div>
                    <label class="cms-label" for="exp-key">Key</label>
                    <input id="exp-key" class="cms-input" type="text"
                           [(ngModel)]="key" (ngModelChange)="error.set(null)"
                           [readonly]="isEdit" [class.cms-input--locked]="isEdit"
                           placeholder="e.g. hero-cta" [attr.autofocus]="isEdit ? null : ''" />
                    <div class="cms-field-hint">
                        @if (isEdit) {
                            The key is permanent — it identifies the experiment's cookie + counters.
                        } @else {
                            Stable identifier — lowercase letters, digits, <code>-</code> or <code>_</code>.
                            Cannot change after creation.
                        }
                    </div>
                </div>

                <div>
                    <label class="cms-label" for="exp-name">Name</label>
                    <input id="exp-name" class="cms-input" type="text"
                           [(ngModel)]="name" (ngModelChange)="error.set(null)"
                           placeholder="Hero CTA copy" />
                </div>

                <div>
                    <label class="cms-label">Variants</label>
                    <div class="cms-field-hint">
                        @if (isEdit) {
                            Keys are frozen (the counters are keyed by them) — edit labels and weights only.
                        } @else {
                            At least two. Weights are relative (<code>1 / 1</code> = an even split);
                            a weight of <code>0</code> pauses an arm without dropping its history.
                        }
                    </div>

                    <div class="variants">
                        <div class="variants__head" [class.variants__head--edit]="isEdit">
                            <span>Key</span><span>Label</span><span>Weight</span>
                            @if (!isEdit) { <span></span> }
                        </div>
                        @for (v of variants; track v) {
                            <div class="variant-row" [class.variant-row--edit]="isEdit">
                                <input class="cms-input" type="text"
                                       [(ngModel)]="v.key" (ngModelChange)="error.set(null)"
                                       [readonly]="isEdit" [class.cms-input--locked]="isEdit"
                                       placeholder="control" />
                                <input class="cms-input" type="text"
                                       [(ngModel)]="v.label" (ngModelChange)="error.set(null)"
                                       placeholder="Control" />
                                <input class="cms-input variant-row__weight" type="number" min="0"
                                       [(ngModel)]="v.weight" (ngModelChange)="error.set(null)" />
                                @if (!isEdit) {
                                    <button type="button" class="cms-btn cms-btn-sm variant-row__remove"
                                            [disabled]="variants.length <= 2"
                                            title="Remove variant" aria-label="Remove variant"
                                            (click)="removeVariant(v)">
                                        <i class="bi bi-x-lg"></i>
                                    </button>
                                }
                            </div>
                        }
                    </div>

                    @if (!isEdit) {
                        <button type="button" class="cms-btn cms-btn-sm variants__add"
                                (click)="addVariant()">
                            <i class="bi bi-plus-lg"></i> Add variant
                        </button>
                    }
                </div>

                @if (error()) { <p class="error">{{ error() }}</p> }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="submitting()" (click)="submit()">
                    {{ submitting() ? saveBusyLabel : saveLabel }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .variants { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
        .variants__head,
        .variant-row {
            display: grid;
            grid-template-columns: 1fr 1fr 5.5rem auto;
            gap: 8px;
            align-items: center;
        }
        .variants__head--edit,
        .variant-row--edit { grid-template-columns: 1fr 1fr 5.5rem; }
        .variants__head {
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: var(--cms-text-muted, #848b96);
            padding: 0 0.1rem;
        }
        .variant-row__weight { text-align: right; }
        .variant-row__remove { padding: 3px 8px; }
        .variants__add { align-self: flex-start; margin-top: 2px; }
        .cms-input--locked {
            background: var(--cms-surface-muted, #f3f4f6);
            color: var(--cms-text-muted, #848b96);
            cursor: not-allowed;
        }
        .error {
            color: var(--cms-danger, #dc2626);
            margin: 0;
            font-size: 0.8125rem;
        }
    `],
})
export class ExperimentFormDialogComponent {
    private readonly api        = inject(ExperimentsService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef          = inject<DialogRef<ExperimentDto | null>>(DialogRef);

    /** Present in edit mode; null when creating. */
    private readonly editing =
        inject<ExperimentDto | null>(DIALOG_DATA, { optional: true }) ?? null;

    readonly isEdit       = this.editing !== null;
    readonly saveLabel    = this.isEdit ? 'Save' : 'Create';
    readonly saveBusyLabel = this.isEdit ? 'Saving…' : 'Creating…';

    key  = this.editing?.key ?? '';
    name = this.editing?.name ?? '';
    /**
     * Seeded from the experiment in edit mode; otherwise two empty arms so the
     * minimum is satisfied out of the gate.
     */
    variants: VariantRow[] = this.editing
        ? this.editing.variants.map(v => ({ key: v.key, label: v.label, weight: v.weight }))
        : [
            { key: 'control', label: 'Control', weight: 1 },
            { key: '',        label: '',        weight: 1 },
        ];

    readonly submitting = signal(false);
    readonly error      = signal<string | null>(null);

    addVariant(): void {
        this.variants = [...this.variants, { key: '', label: '', weight: 1 }];
        this.error.set(null);
    }

    removeVariant(row: VariantRow): void {
        if (this.variants.length <= 2) return;
        this.variants = this.variants.filter(v => v !== row);
        this.error.set(null);
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        const rows = this.cleanedVariants();
        const error = this.validate(rows);
        if (error) {
            this.error.set(error);
            return;
        }

        this.submitting.set(true);
        this.error.set(null);

        const request$ = this.isEdit
            ? this.api.update(this.key.trim().toLowerCase(), { name: this.name.trim(), variants: rows })
            : this.api.create({ key: this.key.trim().toLowerCase(), name: this.name.trim(), variants: rows });

        request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: experiment => {
                this.submitting.set(false);
                this.dialogRef.close(experiment);
            },
            error: (e: unknown) => {
                this.submitting.set(false);
                this.error.set(this.errors.humanize(e));
            },
        });
    }

    /** Trim every row and drop the ones left fully blank (e.g. an unused added row). */
    private cleanedVariants(): VariantRow[] {
        return this.variants
            .map(v => ({ key: v.key.trim().toLowerCase(), label: v.label.trim(), weight: Number(v.weight) }))
            .filter(v => v.key !== '' || v.label !== '');
    }

    /** Inline pre-flight validation mirroring the backend domain rules. */
    private validate(rows: VariantRow[]): string | null {
        const key = this.key.trim().toLowerCase();
        if (!KEY_RE.test(key)) {
            return 'Key must start with a letter or digit and use only lowercase letters, digits, “-” or “_”.';
        }
        if (this.name.trim() === '') {
            return 'Name is required.';
        }
        if (rows.length < 2) {
            return 'At least two variants are required.';
        }
        for (const v of rows) {
            if (!KEY_RE.test(v.key)) {
                return `Variant key “${v.key || '(empty)'}” is invalid — use lowercase letters, digits, “-” or “_”.`;
            }
            if (v.label === '') {
                return `Variant “${v.key}” needs a label.`;
            }
            if (!Number.isFinite(v.weight) || v.weight < 0) {
                return `Variant “${v.key}” has an invalid weight — use 0 or a positive number.`;
            }
        }
        const keys = rows.map(v => v.key);
        if (new Set(keys).size !== keys.length) {
            return 'Variant keys must be unique.';
        }
        return null;
    }
}
