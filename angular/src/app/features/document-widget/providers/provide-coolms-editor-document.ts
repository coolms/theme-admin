import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry, EditorExtensionRegistry } from '@coolms/editor-angular';
import { DocumentWidget } from '../dtmpl/dtmpl-document-node';
import { OpenDocumentPickerHandler } from '../actions/open-document-picker.handler';

/**
 * Bootstrap providers for the Document module's editor integration (#1739).
 * Spread into `ApplicationConfig.providers` after `provideCoolmsEditor()` so
 * the bridge's registries exist before this initializer runs (mirrors
 * `provideCoolmsEditorForm()` / `provideCoolmsEditorMedia()`).
 *
 * Side effects on app boot:
 *   1. Registers the `documentWidget` Tiptap extension factory.
 *   2. Registers the `document.openPicker` action handler. The backend
 *      `block:document` contributor emits this action type, so both the
 *      toolbar button and the `/`-slash item open the template picker.
 */
export function provideCoolmsEditorDocument(): Provider[] {
    return [
        OpenDocumentPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, EditorExtensionRegistry, OpenDocumentPickerHandler],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                openDoc:    OpenDocumentPickerHandler,
            ) => () => {
                actions.register('document.openPicker', openDoc);
                extensions.register('documentWidget', () => DocumentWidget);
            },
        },
    ];
}
