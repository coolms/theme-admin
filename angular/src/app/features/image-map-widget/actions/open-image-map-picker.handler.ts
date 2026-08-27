import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import { ImageMapPickerComponent, type ImageMapPick } from '../image-map-picker.component';

/**
 * Handles the `imagemap.openPicker` editor action, dispatched by the backend
 * `block:imagemap` toolbar/slash contributor. Opens the picker; on selection
 * inserts an `imageMapWidget` node, which round-trips to
 * `` {widget:imagemap:`<slug>`} ``.
 *
 * Dialog is fetched lazily through `ctx.injector.get(Dialog)` so the handler
 * stays construction-light and testable (mirrors OpenFormPickerHandler).
 */
@Injectable()
export class OpenImageMapPickerHandler implements EditorActionHandler {
    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const ref = dialog.open<ImageMapPick | null>(ImageMapPickerComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const picked = await firstValueFrom(ref.closed);
        if (!picked) return; // cancelled

        ctx.editor.chain().focus()
            .insertImageMapWidget({ slug: picked.slug, name: picked.title })
            .run();
    }
}
