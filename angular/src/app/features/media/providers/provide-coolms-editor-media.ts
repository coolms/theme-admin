import { APP_INITIALIZER, EnvironmentInjector, type Injector, type Provider } from '@angular/core';
import { EditorActionRegistry, EditorExtensionRegistry } from '@coolms/editor-angular';
import { MediaWidget } from '../dtmpl/dtmpl-media-node';
import { MediaGalleryWidget } from '../dtmpl/dtmpl-media-gallery-node';
import { OpenMediaPickerHandler } from '../actions/open-media-picker.handler';
import { OpenGalleryPickerHandler } from '../actions/open-gallery-picker.handler';

/**
 * Bootstrap providers for the Media module's editor integration. Spread into
 * `ApplicationConfig.providers` after `provideCoolmsEditor()` so the bridge's
 * registries exist before this initializer runs.
 *
 * Side effects on app boot:
 *   1. Registers two action handlers with `EditorActionRegistry`:
 *        - `media.openPicker`         -> OpenMediaPickerHandler
 *        - `media.openGalleryPicker`  -> OpenGalleryPickerHandler
 *      These are the action types declared by MediaInsertContributor and
 *      MediaGalleryInsertContributor on the PHP side (sub-prompt C1).
 *   2. Registers two Tiptap extension factories with EditorExtensionRegistry:
 *        - `mediaWidget`         -> configured with the root EnvironmentInjector
 *                                  so the NodeView can open the alt-editor
 *                                  CDK Overlay without a hidden global
 *        - `mediaGalleryWidget`  -> bare node (no NodeView, no overlay)
 *
 * Module-supplied handlers register exactly the way `provideCoolmsEditor()`
 * registers built-ins — the `multi: true` APP_INITIALIZER plurality means
 * everything composes additively without ordering rules between modules.
 */
export function provideCoolmsEditorMedia(): Provider[] {
    return [
        OpenMediaPickerHandler,
        OpenGalleryPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            // EnvironmentInjector is the application-root injector that
            // outlives any single `<coolms-editor>` mount, which is what the
            // NodeView needs (it opens overlays after the editor is up,
            // possibly across mount/unmount cycles when content reloads).
            deps:    [
                EditorActionRegistry,
                EditorExtensionRegistry,
                OpenMediaPickerHandler,
                OpenGalleryPickerHandler,
                EnvironmentInjector,
            ],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                openPicker: OpenMediaPickerHandler,
                openGallery: OpenGalleryPickerHandler,
                rootInjector: Injector,
            ) => () => {
                actions.register('media.openPicker',        openPicker);
                actions.register('media.openGalleryPicker', openGallery);

                extensions.register('mediaWidget', () =>
                    MediaWidget.configure({ injector: rootInjector }),
                );
                extensions.register('mediaGalleryWidget', () => MediaGalleryWidget);
            },
        },
    ];
}
