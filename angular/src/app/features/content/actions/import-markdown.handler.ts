import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import { MarkdownImportDialogComponent } from '../markdown-import-dialog.component';

/**
 * Handles `content.importMarkdown` — opens {@link MarkdownImportDialogComponent}
 * (paste / load a `.md` file), which converts the Markdown to safe HTML
 * server-side, then inserts the returned HTML at the cursor.
 *
 * Mirrors the Media module's OpenGalleryPickerHandler: an app-side
 * `@Injectable()` handler registered through `provideCoolmsEditorContent()`,
 * pulling CDK `Dialog` lazily from `ctx.injector` so it owns no component
 * reference. Insert-at-cursor (not replace-all) so an import never silently
 * discards existing body content.
 */
@Injectable()
export class ImportMarkdownHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const ref = dialog.open<{ html: string } | null>(MarkdownImportDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return; // cancelled

        ctx.editor.chain().focus().insertContent(result.html).run();
    }
}
