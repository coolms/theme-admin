
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { ModalComponent } from '@coolms/ui-angular';

/** One row of `GET /document/templates`, narrowed to what the picker needs. */
export interface DocumentTemplateDto {
    readonly slug:                string;
    readonly name:                string;
    readonly defaultOutputFormat: string | null;
    readonly publiclyAccessible:  boolean;
}

/** What the dialog resolves with; `null` on cancel. */
export interface DocumentPickerResult {
    readonly slug:         string;
    readonly name:         string;
    readonly outputFormat: string | null;
}

/**
 * Picks a document TEMPLATE for the `{widget:document:<slug>}` embed.
 *
 *  Not a file browser. The widget renders a "Generate document" BUTTON — the
 * reader clicks it and a document is produced for them on demand — so what has
 * to be chosen is a template, not a path. Attaching an existing file is
 * `<cms-file-picker>`; these are different features that share a noun.
 *
 *  **Surfaces `publiclyAccessible`.** `DocumentWidgetRenderer` gates a
 * non-public template behind an authenticated SSR visitor, so embedding one on
 * a public page renders NOTHING for anonymous readers. That is correct
 * behaviour and completely invisible to the author unless the picker says so —
 * hence the inline warning rather than a silent selection.
 */
@Component({
    selector: 'app-document-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ModalComponent],
    template: `
        <app-modal title="Insert document" [width]="560">
            <p class="hint">
                Inserts a <strong>Generate document</strong> button. Readers click it and the
                document is produced from this template on demand.
            </p>

            @if (loading()) {
                <p class="note">Loading templates…</p>
            } @else if (error()) {
                <p class="note note--error">{{ error() }}</p>
            } @else if (templates().length === 0) {
                <p class="note">
                    No document templates exist yet. Create one in <strong>Documents</strong> first.
                </p>
            } @else {
                <div class="list" role="listbox">
                    @for (tpl of templates(); track tpl.slug) {
                        <button type="button" class="row"
                                role="option"
                                [class.row--picked]="picked()?.slug === tpl.slug"
                                [attr.aria-selected]="picked()?.slug === tpl.slug"
                                (click)="picked.set(tpl)">
                            <i class="bi bi-file-earmark-text"></i>
                            <span class="row__name">{{ tpl.name }}</span>
                            @if (tpl.defaultOutputFormat) {
                                <span class="row__fmt">{{ tpl.defaultOutputFormat.toUpperCase() }}</span>
                            }
                            @if (!tpl.publiclyAccessible) {
                                <span class="row__private" title="Only signed-in visitors will see this button">
                                    <i class="bi bi-lock"></i> private
                                </span>
                            }
                        </button>
                    }
                </div>

                @if (picked() && !picked()!.publiclyAccessible) {
                    <p class="note note--warn">
                        <i class="bi bi-exclamation-triangle"></i>
                        This template is not publicly accessible, so the button will not appear for
                        signed-out visitors. Make it public in Documents if the page is public.
                    </p>
                }
            }

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="!picked()" (click)="confirm()">Insert</button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .hint { margin: 0 0 0.85rem; font-size: 0.82rem; color: var(--cms-text-muted, #848b96); }
        .note { margin: 0.5rem 0 0; font-size: 0.8125rem; color: var(--cms-text-muted, #848b96); }
        .note--error { color: var(--cms-danger, #dc2626); }
        .note--warn { color: var(--cms-accent-text, #7C4D00); }
        .list { max-height: 18rem; overflow-y: auto; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius, 6px); }
        .row {
            display: flex; align-items: center; gap: 8px; width: 100%;
            padding: 8px 10px; border: 0; background: transparent; cursor: pointer;
            font-size: .8125rem; text-align: left;
        }
        .row:hover { background: var(--cms-surface-hover, #f3f4f6); }
        .row--picked { background: var(--cms-accent-light, #FEF7E6); }
        .row__name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row__fmt {
            flex: 0 0 auto; font-size: .6875rem; padding: 1px 5px; border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface-alt, #f3f4f6); color: var(--cms-text-muted, #848b96);
        }
        .row__private { flex: 0 0 auto; font-size: .6875rem; color: var(--cms-text-muted, #848b96); }
    `],
})
export class DocumentPickerComponent {
    private readonly http       = inject(HttpClient);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialogRef  = inject<DialogRef<DocumentPickerResult | null>>(DialogRef);

    readonly templates = signal<DocumentTemplateDto[]>([]);
    readonly picked    = signal<DocumentTemplateDto | null>(null);
    readonly loading   = signal(true);
    readonly error     = signal<string | null>(null);

    constructor() {
        this.http
            .get<{ member?: DocumentTemplateDto[] }>('/api/v1/document/templates', {
                params: { itemsPerPage: 200 },
            })
            .pipe(map(res => res.member ?? []), takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: rows => {
                    this.templates.set(rows);
                    this.loading.set(false);
                },
                error: () => {
                    this.error.set('Templates could not be loaded.');
                    this.loading.set(false);
                },
            });
    }

    confirm(): void {
        const tpl = this.picked();
        if (!tpl) return;

        this.dialogRef.close({
            slug: tpl.slug,
            name: tpl.name,
            // Left null on purpose when it matches the template's own default:
            // storing `output_format` would freeze the choice, so changing the
            // template's default later would stop affecting pages that embed it.
            outputFormat: null,
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
