import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import {
    MediaPickerHostComponent, MediaPickerHostData, MediaPickerHostResult,
} from '../media-picker-host.component';

/**
 * Handles `media.openGalleryPicker` — opens MediaPickerHostComponent with
 * gallery mode pre-selected, and dispatches the picked collection onto the
 * active Tiptap chain via the `mediaGalleryWidget` extension's `insertGallery`
 * command.
 *
 * Symmetric with OpenMediaPickerHandler: same dialog component, just a
 * different `initialMode` seed and a different result branch.
 */
@Injectable()
export class OpenGalleryPickerHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const data: MediaPickerHostData = {
            options: {
                bindValue:  'path',
                bindTarget: 'collection',
                accept:     '*',
                // Gallery view doesn't surface the recently-used / hover-preview
                // affordances — they're noisy when picking folders.
                recentlyUsed: false,
                hoverPreview: false,
            },
            initialMode: 'gallery',
        };
        const ref = dialog.open<MediaPickerHostResult | null>(MediaPickerHostComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        // The host can still emit a 'widget' result if the user toggled back
        // to single mode mid-flow — handle both branches so the user's final
        // intent always lands on the right command.
        if (result.type === 'gallery') {
            ctx.editor.chain().focus().insertGallery({
                collectionId: result.collectionId,
                name:         result.name,
                galleryType:  result.galleryType,
                cols:         result.cols,
                limit:        result.limit,
                depth:        result.depth,
            }).run();
        } else if (result.type === 'widget') {
            ctx.editor.chain().focus().insertMedia({
                uuid:       result.uuid,
                size:       result.size,
                kind:       result.kind,
                alt:        result.alt,
                previewUrl: result.previewUrl,
                width:      result.width,
                height:     result.height,
                align:      result.align,
                caption:    result.caption,
            }).run();
        } else if (result.type === 'plain') {
            ctx.editor.chain().focus().insertContent(result.html).run();
        }
    }
}
