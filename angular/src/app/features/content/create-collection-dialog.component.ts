import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { CollectionService, CreateCollectionRequest } from './collection.service';
import { ToastService } from '@coolms/ui-angular';

/**
 * Create a content collection (ADR-129, W5.g) — a declared directory (blog /
 * docs space) under the site's content root. A "type" picker maps to a preset
 * payload so the operator doesn't have to know the underlying `collectionType`
 * / `postContentType` / `sidebarNav` declaration:
 *
 *   - **Blog** → `collectionType: blog` (posts are `blog_post`), opts into the
 *     `seo` + `blog` field sets (author / date / categories / tags on posts).
 *   - **Documentation** → `collectionType: docs`, posts are `docs_page`, and
 *     `sidebarNav: true` (the persistent reading-sidebar layout, W4.a).
 *
 * The minted directory appears as a row in the Pages tree; new pages created
 * inside it inherit the collection's `postContentType`.
 */
@Component({
    selector: 'app-create-collection-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 420px;">
            <div class="cms-dialog-header">
                <span>New Collection</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <label class="cms-label">Type</label>
                    <select class="cms-input" [(ngModel)]="type">
                        <option value="blog">Blog — reverse-chron posts with feeds</option>
                        <option value="docs">Documentation — sidebar reading layout</option>
                    </select>
                </div>
                <div>
                    <label class="cms-label">Slug</label>
                    <input class="cms-input" type="text" [(ngModel)]="slug"
                           [placeholder]="type" />
                    <div class="cms-field-hint">URL segment + folder name (defaults to the type).</div>
                </div>
                <div>
                    <label class="cms-label">Label <span class="text-muted">(optional)</span></label>
                    <input class="cms-input" type="text" [(ngModel)]="label"
                           placeholder="Shown in the admin tree" />
                </div>
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                <button class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="saving()"
                        (click)="submit()">
                    {{ saving() ? 'Creating…' : 'Create' }}
                </button>
            </div>
        </div>
    `,
})
export class CreateCollectionDialogComponent {
    private readonly dialogRef     = inject(DialogRef);
    private readonly collectionSvc = inject(CollectionService);
    private readonly toast         = inject(ToastService);

    /** Preset key: 'blog' | 'docs'. */
    type  = 'blog';
    slug  = '';
    label = '';
    readonly saving = signal(false);

    submit(): void {
        const type = this.type;
        const slug = (this.slug.trim() || type).trim();
        if (!slug) return;
        this.saving.set(true);

        const preset: CreateCollectionRequest = type === 'docs'
            ? { slug, collectionType: 'docs', postContentType: 'docs_page', sidebarNav: true }
            : { slug, collectionType: 'blog', fieldSets: ['seo', 'blog'] };

        this.collectionSvc.create({ ...preset, label: this.label.trim() || undefined }).subscribe({
            next: collection => {
                this.toast.success('Collection created', `/${collection.slug}`);
                this.dialogRef.close(collection);
            },
            error: () => {
                this.saving.set(false);
                this.toast.error('Failed to create collection');
            },
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }
}
