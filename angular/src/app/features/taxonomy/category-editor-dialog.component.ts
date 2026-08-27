import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ToastService } from '@coolms/ui-angular';
import { TaxonomyNodeDto, TaxonomyService } from './taxonomy.service';

/** Injected data for {@link CategoryEditorDialogComponent}. */
export interface CategoryEditorDialogData {
    readonly mode:   'create' | 'edit';
    readonly treeId: string;
    /** The full flat node list — used to build the create-mode parent picker. */
    readonly nodes:  readonly TaxonomyNodeDto[];
    /** Edit mode: the node being renamed. */
    readonly node?:  TaxonomyNodeDto;
    /** Create mode: pre-selected parent id (`null`/absent = root). */
    readonly defaultParentId?: string | null;
}

interface ParentOption {
    readonly id:    string; // '' = root
    readonly label: string;
}

/**
 * Create OR rename a category, keyed by `data.mode`. Replaces the bespoke inline
 * `<input>` editors of the old Categories page with the platform `.cms-dialog`
 * modal convention (mirrors {@see CreatePageDialogComponent}).
 *
 * Create: name + parent picker; the slug is auto-derived from the name (matching
 * the previous page's behaviour). Rename: name only — the slug stays stable and
 * the current `parentId` is echoed so the re-parent-on-diff processor treats it
 * as a pure rename (never a silent move to root).
 */
@Component({
    selector: 'coolms-category-editor-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 420px;">
            <div class="cms-dialog-header">
                <span>{{ data.mode === 'create' ? 'New Category' : 'Rename Category' }}</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <label class="cms-label">Name</label>
                    <input class="cms-input" type="text" [(ngModel)]="label"
                           placeholder="e.g. Tutorials" (keydown.enter)="submit()" />
                    <div class="cms-field-hint">The URL slug is derived from the name.</div>
                </div>
                @if (data.mode === 'create') {
                    <div>
                        <label class="cms-label">Parent</label>
                        <select class="cms-input" [(ngModel)]="parentId">
                            @for (opt of parentOptions; track opt.id) {
                                <option [value]="opt.id">{{ opt.label }}</option>
                            }
                        </select>
                        <div class="cms-field-hint">Where this category sits in the tree.</div>
                    </div>
                }
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                <button class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="!label.trim() || saving()"
                        (click)="submit()">
                    {{ saving() ? 'Saving…' : (data.mode === 'create' ? 'Create' : 'Save') }}
                </button>
            </div>
        </div>
    `,
})
export class CategoryEditorDialogComponent {
    protected readonly data      = inject<CategoryEditorDialogData>(DIALOG_DATA);
    private readonly dialogRef    = inject(DialogRef);
    private readonly api          = inject(TaxonomyService);
    private readonly toast        = inject(ToastService);
    private readonly destroyRef   = inject(DestroyRef);

    label = this.data.node?.label ?? '';
    /** Selected parent id ('' = root). Create-mode default; unused in edit. */
    parentId: string = this.data.defaultParentId ?? '';
    readonly saving = signal(false);

    /** Root + every node indented by depth (create mode's parent picker). */
    readonly parentOptions: ParentOption[] = [
        { id: '', label: '— Root (no parent) —' },
        ...[...this.data.nodes]
            .sort((a, b) => a.lft - b.lft)
            .map(n => ({
                id:    n.id,
                label: '   '.repeat(Math.max(0, n.level)) + n.label,
            })),
    ];

    submit(): void {
        const label = this.label.trim();
        if (!label || this.saving()) return;

        const req = this.data.mode === 'create'
            ? this.createReq(label)
            : this.api.updateNode(this.data.node!.id, {
                label,
                slug:     this.data.node!.slug,     // slug stays stable on rename
                parentId: this.data.node!.parentId, // echo parent → pure rename
            });
        if (req === null) return;

        this.saving.set(true);
        req.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: node => {
                this.toast.success(this.data.mode === 'create' ? 'Category created' : 'Category renamed');
                this.dialogRef.close(node);
            },
            error: (e: unknown) => {
                this.saving.set(false);
                this.toast.error(this.errorText(e, 'Save failed.'));
            },
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }

    private createReq(label: string): ReturnType<TaxonomyService['createNode']> | null {
        const slug = this.slugify(label);
        if (slug === '') {
            this.toast.error('Enter a name with at least one letter or number.');
            return null;
        }
        return this.api.createNode({
            label,
            slug,
            treeId:   this.data.treeId,
            parentId: this.parentId || null,
        });
    }

    private slugify(label: string): string {
        return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    private errorText(e: unknown, fallback: string): string {
        const err = e as { error?: { detail?: string; 'hydra:description'?: string }; message?: string };
        return err?.error?.detail
            ?? err?.error?.['hydra:description']
            ?? err?.message
            ?? fallback;
    }
}
