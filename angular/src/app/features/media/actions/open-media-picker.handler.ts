import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import {
    MediaPickerHostComponent, MediaPickerHostData, MediaPickerHostResult,
} from '../media-picker-host.component';

/**
 * Handles `media.openPicker` — opens MediaPickerHostComponent in single-asset
 * mode and dispatches the picked asset onto the active Tiptap chain via the
 * `mediaWidget` extension's `insertMedia` command (or as plain HTML when the
 * user has flipped insertMode in the picker UI).
 *
 * Cancelled dialogs no-op; misshapen results log via the registry's normal
 * try/catch. The handler is `@Injectable({})` so DI can deliver it through
 * the APP_INITIALIZER factory in `provideCoolmsEditorMedia()` — Dialog is
 * pulled lazily through `ctx.injector` so the handler stays test-friendly.
 */
@Injectable()
export class OpenMediaPickerHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const data: MediaPickerHostData = {
            // Sensible defaults for the Insert-media flow. The picker user can
            // still flip mode, size, etc. inside the dialog.
            options: {
                bindValue:    'uuid',
                bindTarget:   'asset',
                display:      'preset:medium',
                accept:       '*',
                recentlyUsed: true,
                hoverPreview: true,
            },
            initialMode: 'single',
        };
        const ref = dialog.open<MediaPickerHostResult | null>(MediaPickerHostComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        // Result shape from MediaPickerHost:
        //   { type: 'widget', uuid, size, kind, mime, previewUrl, alt, width, height, align, caption }
        //   { type: 'plain',  html }
        //   { type: 'gallery', path, galleryType, cols, limit, depth, align } — only fires when
        //                                                                       user toggled to gallery
        if (result.type === 'widget') {
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
        } else if (result.type === 'gallery') {
            // User flipped to gallery mode mid-flow. Route to the gallery
            // command so the inserted node matches the user's final intent.
            ctx.editor.chain().focus().insertGallery({
                collectionId: result.collectionId,
                name:         result.name,
                galleryType:  result.galleryType,
                cols:         result.cols,
                limit:        result.limit,
                depth:        result.depth,
            }).run();
        }
    }
}
