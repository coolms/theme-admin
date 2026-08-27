import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { MarkdownService } from './markdown.service';
import { ToastService } from '@coolms/ui-angular';

/**
 * Paste / file-drop Markdown import dialog (Track B #1). The author pastes
 * Markdown (or picks a `.md` file, which is read into the textarea); on Import
 * the text is converted to safe HTML server-side via {@link MarkdownService}
 * and the dialog closes with `{ html }`. The caller (the editor's
 * `content.importMarkdown` action handler, or any other host) inserts it.
 *
 * The conversion runs here — rather than in the handler — so the spinner and
 * any error surface in the dialog where the user is looking, and the handler
 * stays a thin "insert the result" step.
 */
@Component({
    selector: 'app-markdown-import-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 560px; max-width: 95vw;">
            <div class="cms-dialog-header">
                <span><i class="bi bi-markdown me-1"></i> Import Markdown</span>
                <button class="cms-dialog-close" (click)="cancel()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 10px; padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span class="cms-label" style="margin: 0;">Paste Markdown, or load a file</span>
                    <label class="cms-btn cms-btn-sm" style="margin: 0;">
                        <i class="bi bi-upload"></i> Load .md
                        <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain"
                               hidden (change)="onFile($event)" />
                    </label>
                </div>
                <textarea class="cms-input"
                          rows="14"
                          spellcheck="false"
                          style="font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; resize: vertical;"
                          placeholder="# Heading&#10;&#10;Paste GitHub-flavoured Markdown here…"
                          [ngModel]="markdown()"
                          (ngModelChange)="markdown.set($event)"></textarea>
                <p class="cms-field-hint" style="margin: 0;">
                    Converted server-side (GitHub-flavoured). Raw HTML and unsafe
                    links are stripped. The result is inserted at the cursor.
                </p>
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" [disabled]="converting()" (click)="cancel()">Cancel</button>
                <button class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="markdown().trim() === '' || converting()"
                        (click)="confirm()">
                    {{ converting() ? 'Converting…' : 'Import' }}
                </button>
            </div>
        </div>
    `,
})
export class MarkdownImportDialogComponent {
    private readonly dialogRef = inject<DialogRef<{ html: string } | null>>(DialogRef);
    private readonly markdownSvc = inject(MarkdownService);
    private readonly toast = inject(ToastService);

    readonly markdown   = signal('');
    readonly converting = signal(false);

    onFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => this.markdown.set(String(reader.result ?? ''));
        reader.onerror = () => this.toast.error('Could not read the file');
        reader.readAsText(file);
        // Reset so picking the same file again re-fires change.
        input.value = '';
    }

    confirm(): void {
        const md = this.markdown().trim();
        if (md === '' || this.converting()) return;
        this.converting.set(true);
        this.markdownSvc.toHtml(md).subscribe({
            next: html => {
                this.converting.set(false);
                if (html.trim() === '') {
                    this.toast.error('Nothing to import', 'The Markdown produced empty content');
                    return;
                }
                this.dialogRef.close({ html });
            },
            error: () => {
                this.converting.set(false);
                this.toast.error('Markdown import failed');
            },
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
