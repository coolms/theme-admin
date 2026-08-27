import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry, EditorExtensionRegistry } from '@coolms/editor-angular';
import { FormWidget } from '../dtmpl/dtmpl-form-node';
import { OpenFormPickerHandler } from '../actions/open-form-picker.handler';

/**
 * Bootstrap providers for the Form module's editor integration. Spread into
 * `ApplicationConfig.providers` after `provideCoolmsEditor()` so the bridge's
 * registries exist before this initializer runs (mirrors
 * `provideCoolmsEditorLink()` / `provideCoolmsEditorMedia()`).
 *
 * Side effects on app boot:
 *   1. Registers the `formWidget` Tiptap extension factory.
 *   2. Registers the `form.openPicker` action handler. The backend
 *      `block:form` contributor (FormContributor) emits this action type, so
 *      both the toolbar button and the `/`-slash item open the form picker.
 */
export function provideCoolmsEditorForm(): Provider[] {
    return [
        OpenFormPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, EditorExtensionRegistry, OpenFormPickerHandler],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                openForm:   OpenFormPickerHandler,
            ) => () => {
                actions.register('form.openPicker', openForm);
                extensions.register('formWidget', () => FormWidget);
            },
        },
    ];
}
