import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import { DocumentPickerComponent, type DocumentPickerResult } from '../document-picker.component';

/**
 * Handles the `document.openPicker` editor action, dispatched by the backend
 * `block:document` toolbar/slash contributor. Opens the template picker;
 * on selection inserts a `documentWidget` node, which round-trips to
 * `{widget:document:<slug>}`.
 *
 * Dialog is fetched lazily through `ctx.injector.get(Dialog)` so the handler
 * stays construction-light and testable (mirrors OpenFormPickerHandler).
 */
@Injectable()
export class OpenDocumentPickerHandler implements EditorActionHandler {
    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const ref = dialog.open<DocumentPickerResult | null>(DocumentPickerComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const picked = await firstValueFrom(ref.closed);
        if (!picked) return; // cancelled

        ctx.editor.chain().focus().insertDocumentWidget({
            slug:         picked.slug,
            name:         picked.name,
            outputFormat: picked.outputFormat,
        }).run();
    }
}
