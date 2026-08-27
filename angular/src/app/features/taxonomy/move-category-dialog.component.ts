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

/** Injected data for {@link MoveCategoryDialogComponent}. */
export interface MoveCategoryDialogData {
    readonly node:  TaxonomyNodeDto;
    readonly nodes: readonly TaxonomyNodeDto[];
}

interface ParentOption {
    readonly id:    string; // '' = root
    readonly label: string;
}

/**
 * "Change parent" modal — the datagrid convention's replacement for the old
 * inline move `<select>`. Reparenting maps onto the taxonomy API as a plain
 * `PUT /taxonomy/nodes/{id}` with a changed `parentId` (the processor does the
 * nested-set move server-side). The picker EXCLUDES the node's own subtree so a
 * category can never be moved under itself or a descendant (cycle guard, ported
 * verbatim from the previous page's `moveOptions`).
 */
@Component({
    selector: 'coolms-move-category-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 420px;">
            <div class="cms-dialog-header">
                <span>Change parent</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <label class="cms-label">Move “{{ data.node.label }}” under</label>
                    <select class="cms-input" [(ngModel)]="parentId">
                        @for (opt of parentOptions; track opt.id) {
                            <option [value]="opt.id">{{ opt.label }}</option>
                        }
                    </select>
                    <div class="cms-field-hint">Its sub-categories move with it.</div>
                </div>
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                <button class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="saving() || parentId === (data.node.parentId ?? '')"
                        (click)="submit()">
                    {{ saving() ? 'Moving…' : 'Move' }}
                </button>
            </div>
        </div>
    `,
})
export class MoveCategoryDialogComponent {
    protected readonly data    = inject<MoveCategoryDialogData>(DIALOG_DATA);
    private readonly dialogRef  = inject(DialogRef);
    private readonly api        = inject(TaxonomyService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    /** Selected new parent id ('' = root); defaults to the current parent. */
    parentId: string = this.data.node.parentId ?? '';
    readonly saving = signal(false);

    /** Root + every node OUTSIDE the moving node's own subtree (cycle guard). */
    readonly parentOptions: ParentOption[] = (() => {
        const moving = this.data.node;
        const opts: ParentOption[] = [{ id: '', label: '— Root (no parent) —' }];
        for (const n of [...this.data.nodes].sort((a, b) => a.lft - b.lft)) {
            // Nested-set: a node in [moving.lft, moving.rgt] is the node itself or
            // a descendant — excluding it prevents creating a cycle.
            if (n.lft >= moving.lft && n.rgt <= moving.rgt) continue;
            opts.push({ id: n.id, label: '   '.repeat(Math.max(0, n.level)) + n.label });
        }
        return opts;
    })();

    submit(): void {
        const newParent = this.parentId || null;
        if (newParent === (this.data.node.parentId ?? null) || this.saving()) return;

        this.saving.set(true);
        // Echo label/slug so the diff-processor treats this purely as a move.
        this.api.updateNode(this.data.node.id, {
            label:    this.data.node.label,
            slug:     this.data.node.slug,
            parentId: newParent,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: node => {
                this.toast.success('Category moved');
                this.dialogRef.close(node);
            },
            error: (e: unknown) => {
                this.saving.set(false);
                this.toast.error(this.errorText(e, 'Move failed.'));
            },
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }

    private errorText(e: unknown, fallback: string): string {
        const err = e as { error?: { detail?: string; 'hydra:description'?: string }; message?: string };
        return err?.error?.detail
            ?? err?.error?.['hydra:description']
            ?? err?.message
            ?? fallback;
    }
}
