import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry, EditorExtensionRegistry } from '@coolms/editor-angular';
import { ImageMapWidget } from '../dtmpl/dtmpl-image-map-node';
import { OpenImageMapPickerHandler } from '../actions/open-image-map-picker.handler';

/**
 * Bootstrap providers for the ImageMap module's editor integration. Spread into
 * `ApplicationConfig.providers` after `provideCoolmsEditor()` so the bridge's
 * registries exist before this initializer runs (mirrors
 * `provideCoolmsEditorForm()` / `provideCoolmsEditorDocument()`).
 *
 * Side effects on app boot:
 *   1. Registers the `imageMapWidget` Tiptap extension factory. The name must
 *      match the `extensions` entry on the backend contributor, or the button
 *      appears and the node it inserts has nowhere to live.
 *   2. Registers the `imagemap.openPicker` action handler, so both the toolbar
 *      button and the `/`-slash item open the map picker.
 */
export function provideCoolmsEditorImageMap(): Provider[] {
    return [
        OpenImageMapPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, EditorExtensionRegistry, OpenImageMapPickerHandler],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                openMap:    OpenImageMapPickerHandler,
            ) => () => {
                actions.register('imagemap.openPicker', openMap);
                extensions.register('imageMapWidget', () => ImageMapWidget);
            },
        },
    ];
}
