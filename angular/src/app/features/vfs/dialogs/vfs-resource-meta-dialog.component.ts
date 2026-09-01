import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VfsNodeDto } from '@coolms/ui-angular';
import { HttpClient } from '@angular/common/http';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;

@Component({
    selector: 'app-vfs-resource-meta-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, FormsModule],
    template: `
        <div style="min-width: 380px; max-width: 480px">

            <div class="cms-dialog-header">
                <i class="bi bi-link-45deg" style="color: var(--cms-meta)"></i>
                <span style="flex:1">{{ node.name }}</span>
                <button type="button" class="cms-dialog-close" (click)="cancel()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body" style="display:flex;flex-direction:column;gap:16px">

                <div>
                    <label class="rmd-label" for="rmd-path">Path</label>
                    <div class="rmd-readonly-value">{{ node.path }}</div>
                </div>

                <div>
                    <label class="rmd-label" for="rmd-description">Description</label>
                    <textarea id="rmd-description"
                              class="rmd-textarea"
                              rows="3"
                              placeholder="Brief description of this resource endpoint…"
                              [(ngModel)]="description"></textarea>
                </div>

                <div>
                    <div class="rmd-label">Supported methods <span class="rmd-hint">(informational)</span></div>
                    <div class="rmd-chips">
                        @for (m of httpMethods; track m) {
                            <span class="rmd-chip">{{ m }}</span>
                        }
                    </div>
                </div>

            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn" (click)="cancel()" [disabled]="saving()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="save()" [disabled]="saving() || !node.permissions.write">
                    @if (saving()) {
                        <cms-loader [inline]="true" />
                    }
                    Save
                </button>
            </div>
        </div>
    `,
    styles: [`
        .rmd-label {
            display: block;
            font-size: .78rem;
            font-weight: 600;
            color: var(--cms-text-muted, #848b96);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: .04em;
        }
        .rmd-hint {
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
        }
        .rmd-readonly-value {
            font-size: .875rem;
            color: var(--cms-text, #111827);
            font-family: var(--cms-font-mono, monospace);
            background: var(--cms-surface, #ffffff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            padding: 6px 10px;
        }
        .rmd-textarea {
            width: 100%;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            padding: 8px 10px;
            font-size: .875rem;
            color: var(--cms-text, #111827);
            resize: vertical;
            outline: none;
            box-sizing: border-box;
        }
        .rmd-textarea:focus { border-color: var(--cms-primary, #2563eb); box-shadow: 0 0 0 2px var(--cms-info-subtle); }
        .rmd-chips {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .rmd-chip {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 999px;
            background: var(--cms-meta-subtle);
            color: var(--cms-meta);
            font-size: .75rem;
            font-weight: 600;
            letter-spacing: .03em;
        }
    `],
})
export class VfsResourceMetaDialogComponent {
    readonly dialogRef = inject<DialogRef<void>>(DialogRef);
    readonly node      = inject<{ node: VfsNodeDto }>(DIALOG_DATA).node;

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    readonly httpMethods = HTTP_METHODS;

    description = this.node.description ?? '';
    saving      = signal(false);

    save(): void {
        if (this.saving()) return;
        this.saving.set(true);

        const baseUrl = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
        // `/vfs/nodes/description` is an API-Platform `Patch` op, so it accepts
        // ONLY `application/merge-patch+json` (the global config sets no
        // `patch_formats`); a plain `application/json` body is rejected 415.
        this.http.patch(`${baseUrl}/vfs/nodes/description`, {
            path:        this.node.path,
            description: this.description,
        }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        }).subscribe({
            next:  () => { this.saving.set(false); this.dialogRef.close(); },
            error: () => { this.saving.set(false); },
        });
    }

    cancel(): void {
        this.dialogRef.close();
    }
}
