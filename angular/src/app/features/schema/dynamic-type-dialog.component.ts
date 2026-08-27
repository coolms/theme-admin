import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { DynamicEntityTypeDto, SchemaService } from './schema.service';

export interface DynamicTypeDialogData {
    mode:         'create' | 'edit';
    type?:        DynamicEntityTypeDto;
    runtimeTypes: DynamicEntityTypeDto[];
    /**
     * Map of slug → entity short class name for PHP-registered entity aliases.
     * Derived from DomainModuleGroup entities (isDynamic + dynamicAlias).
     * Used to show an inline error when the user picks a reserved slug.
     */
    phpEntitySlugs?: Record<string, string>;
    /**
     * When provided in create mode, pre-selects and locks the parent type.
     * Passed when opening via "Add child type" or "New Type" with an active type.
     */
    parentId?: string;
}

@Component({
    selector: 'app-dynamic-type-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, ReactiveFormsModule],
    template: `
        <div class="cms-dialog dtd-dialog">
            <div class="cms-dialog-header">
                <span>{{ isEdit ? 'Edit Type: ' + data.type!.slug : 'New Runtime Type' }}</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <form [formGroup]="form" (ngSubmit)="submit()">
                <div class="cms-dialog-body dtd-body">

                    <!-- Slug (edit mode: readonly reference; create mode: hidden, populated by name) -->
                    @if (isEdit) {
                        <div>
                            <label class="cms-label">Slug</label>
                            <input class="cms-input cms-input--muted"
                                   type="text"
                                   formControlName="slug"
                                   readonly />
                            <div class="cms-field-hint">Slug cannot be changed after creation.</div>
                        </div>
                    }

                    <!-- PHP Class Name (primary input) -->
                    <div>
                        <label class="cms-label">
                            Name <span class="text-danger">*</span>
                        </label>
                        <input class="cms-input"
                               type="text"
                               formControlName="name"
                               placeholder="e.g. ProductTest"
                               autofocus />
                        @if (form.get('name')!.invalid && form.get('name')!.touched) {
                            <div class="cms-field-error">
                                Must be PascalCase, e.g. ProductTest or Electronics\Phone.
                            </div>
                        }
                        <div class="cms-field-hint">PascalCase. Derives slug automatically.</div>
                    </div>

                    <!-- Label (optional override) -->
                    <div>
                        <label class="cms-label">
                            Label <span class="cms-field-optional">(optional)</span>
                        </label>
                        <input class="cms-input"
                               type="text"
                               formControlName="label"
                               placeholder="e.g. Phone Accessories" />
                        <div class="cms-field-hint">
                            Human-readable name. Auto-derived from PHP Class Name.
                        </div>
                    </div>

                    <!-- Category tree -->
                    <div>
                        <label class="cms-label">Category tree <span class="cms-field-optional">(optional)</span></label>
                        <input class="cms-input"
                               type="text"
                               formControlName="categoryTree"
                               placeholder="e.g. phone_catalog" />
                        <div class="cms-field-hint">
                            TaxonomyTree slug for record category picker.
                        </div>
                    </div>

                    <!-- Parent type (create only) -->
                    @if (!isEdit) {
                        @if (data.parentId) {
                            <!-- Locked parent — context determined by "Add child type" or active type -->
                            <p class="de-hint">
                                <i class="bi bi-diagram-2"></i>
                                Child of <strong>{{ parentTypeName() }}</strong>
                            </p>
                        } @else {
                            <div>
                                <label class="cms-label">Parent type <span class="cms-field-optional">(optional)</span></label>
                                <select class="cms-select" formControlName="parentId">
                                    <option value="">— None (root type) —</option>
                                    @for (t of parentOptions(); track t.id) {
                                        <option [value]="t.id">
                                            {{ indent(t.depth) }}{{ t.name || t.slug }}
                                            @if (t.label) {
                                                &nbsp;({{ t.label }})
                                            }
                                        </option>
                                    }
                                </select>
                                <div class="cms-field-hint">
                                    Child types inherit all parent fields.
                                </div>
                            </div>
                        }
                    }

                    @if (!isEdit && slugReservedBy()) {
                        <div class="cms-field-error dtd-slug-conflict">
                            <i class="bi bi-exclamation-triangle-fill"></i>
                            Slug "<code>{{ slugValue() }}</code>" is already used by PHP entity
                            <strong>{{ slugReservedBy() }}</strong>. Choose a different PHP Class Name.
                        </div>
                    }

                </div>

                <div class="cms-dialog-footer">
                    <button type="button" class="cms-btn" (click)="close()">Cancel</button>
                    <button type="submit" class="cms-btn cms-btn-primary"
                            [disabled]="form.invalid || saving() || !!slugReservedBy()">
                        @if (saving()) {
                            <cms-loader [inline]="true" />
                        }
                        {{ isEdit ? 'Save changes' : 'Create type' }}
                    </button>
                </div>
            </form>
        </div>
    `,
    styles: [`
        .dtd-dialog { width: 460px; }
        .dtd-body {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 20px;
        }
        .cms-field-optional {
            font-weight: 400;
            color: var(--cms-text-muted);
            font-size: .8rem;
        }
        .cms-input--muted {
            color: var(--cms-text-muted);
            font-family: var(--cms-font-mono, monospace);
            font-size: .875rem;
        }
        .de-hint {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            padding: 8px 12px;
            border-radius: 6px;
            background: var(--cms-surface-2, rgba(0,0,0,.04));
            color: var(--cms-text-muted);
            font-size: .85rem;
        }
        .de-hint i { flex-shrink: 0; }
        .dtd-slug-conflict {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            border-radius: 6px;
            background: var(--cms-danger-light);
            border: 1px solid var(--cms-danger-subtle-border);
            font-size: .8rem;
        }
        .dtd-slug-conflict code { font-size: .8rem; }
    `],
})
export class DynamicTypeDialogComponent implements OnInit {
    readonly data       = inject<DynamicTypeDialogData>(DIALOG_DATA);
    private readonly ref        = inject(DialogRef);
    private readonly schemaSvc  = inject(SchemaService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly fb         = inject(FormBuilder);

    readonly isEdit = this.data.mode === 'edit';
    readonly saving = signal(false);

    /**
     * Reactive signal tracking the current slug field value.
     * Populated in ngOnInit via valueChanges subscription.
     * Used to compute inline PHP-alias conflict warning without an extra API call.
     */
    readonly slugValue = signal(this.data.type?.slug ?? '');

    /**
     * If the current slug matches a PHP-registered entity alias, returns the
     * short class name (e.g. "PageVariant"); otherwise null.
     * Only relevant in create mode (slug is immutable after creation).
     */
    readonly slugReservedBy = computed((): string | null => {
        if (this.isEdit) return null;
        const slug     = this.slugValue().trim();
        const phpSlugs = this.data.phpEntitySlugs ?? {};
        return phpSlugs[slug] ?? null;
    });

    /**
     * Display name of the pre-filled parent type (for the locked-parent hint).
     * Returns the type's label (falling back to slug, then raw id).
     */
    readonly parentTypeName = computed((): string => {
        const pid = this.data.parentId;
        if (!pid) return '';
        const t = this.data.runtimeTypes.find(rt => rt.id === pid);
        return t?.label || t?.slug || pid;
    });

    readonly form = this.fb.group({
        name:         [
            this.data.type?.name ?? '',
            [Validators.required, Validators.pattern(/^[A-Z][A-Za-z0-9]*(\\[A-Z][A-Za-z0-9]*)*$/)],
        ],
        slug:         [
            this.data.type?.slug ?? '',
            [Validators.required, Validators.pattern(/^[a-z][a-z0-9-]*$/)],
        ],
        label:        [this.data.type?.label ?? ''],
        parentId:     [this.data.type?.parentId ?? this.data.parentId ?? ''],
        categoryTree: [this.data.type?.categoryTree ?? ''],
    });

    /** All types usable as parent (exclude the type being edited to avoid self-reference) */
    readonly parentOptions = computed(() =>
        this.data.runtimeTypes.filter(t =>
            !this.isEdit || t.id !== this.data.type?.id,
        ),
    );

    ngOnInit(): void {
        if (this.isEdit) {
            this.form.get('slug')!.disable();
        }
        // Lock parent when it's been determined by context (child-of action or active type)
        if (!this.isEdit && this.data.parentId) {
            this.form.get('parentId')!.disable();
        }
        if (!this.isEdit) {
            // name is the primary field — derives slug + label while those are pristine
            this.form.get('name')!.valueChanges
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(val => {
                    const trimmed = (val ?? '').trim();
                    if (trimmed.length === 0) {
                        this.slugValue.set('');
                        this.form.get('slug')!.setValue('',  { emitEvent: false });
                        this.form.get('label')!.setValue('', { emitEvent: false });
                        return;
                    }
                    const slug  = this.toKebabCase(trimmed);
                    const label = this.toWords(trimmed);
                    this.slugValue.set(slug);
                    if (!this.form.get('slug')!.dirty) {
                        this.form.get('slug')!.setValue(slug,  { emitEvent: false });
                    }
                    if (!this.form.get('label')!.dirty) {
                        this.form.get('label')!.setValue(label, { emitEvent: false });
                    }
                });
            // Keep slugValue in sync for the reserved-slug check
            this.form.get('slug')!.valueChanges
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(v => this.slugValue.set(v ?? ''));
        }
    }

    private toKebabCase(pascal: string): string {
        return pascal
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '');
    }

    private toWords(pascal: string): string {
        return pascal
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }

    /** Produce leading spaces for tree indent in the select dropdown */
    indent(depth: number): string {
        return '\u00A0\u00A0\u00A0'.repeat(depth);
    }

    close(): void {
        this.ref.close(false);
    }

    submit(): void {
        if (this.form.invalid || this.saving() || this.slugReservedBy()) return;
        this.saving.set(true);

        const { slug, label, name, parentId, categoryTree } = this.form.getRawValue();

        if (this.isEdit) {
            this.schemaSvc.updateType(this.data.type!.id!, {
                label:        label ?? undefined,
                name:         name || undefined,
                categoryTree: categoryTree || undefined,
            }).pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => {
                        this.toast.success('Type updated');
                        this.ref.close(true);
                    },
                    error: (e) => {
                        this.saving.set(false);
                        this.toast.error(e?.error?.detail ?? 'Cannot update type');
                    },
                });
        } else {
            this.schemaSvc.createType({
                slug:         slug!,
                label:        label!,
                name:         name || undefined,
                parentId:     parentId || undefined,
                categoryTree: categoryTree || undefined,
            }).pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => {
                        this.toast.success('Type created');
                        this.ref.close(true);
                    },
                    error: (e) => {
                        this.saving.set(false);
                        this.toast.error(e?.error?.detail ?? 'Cannot create type');
                    },
                });
        }
    }
}
