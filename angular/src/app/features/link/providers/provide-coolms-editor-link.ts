import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry, EditorExtensionRegistry } from '@coolms/editor-angular';
import { LinkWidget } from '../dtmpl/dtmpl-link-node';
import { OpenLinkPickerHandler } from '../actions/open-link-picker.handler';

/**
 * Bootstrap providers for the Link module's editor integration. Spread
 * into `ApplicationConfig.providers` after `provideCoolmsEditor()` so
 * the bridge's registries exist before this initializer runs.
 *
 * Side effects on app boot:
 *   1. Registers the `linkWidget` Tiptap extension factory.
 *   2. Registers `editor.openLinkPicker` action handler with
 *      `EditorActionRegistry`. The backend's `format:link` contributor
 *      (BuiltInContributorsContributor) emits this action type, so a
 *      click on the link toolbar button opens the 3-tab picker host.
 *
 * The legacy `editor.openLinkDialog` action handler (registered by
 * `provideCoolmsEditor()`) is intentionally retained: it is no longer
 * dispatched by `format:link`, but stays in the registry as an
 * emergency-rollback path and a hook for profile-specific overrides.
 */
export function provideCoolmsEditorLink(): Provider[] {
    return [
        OpenLinkPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [
                EditorActionRegistry,
                EditorExtensionRegistry,
                OpenLinkPickerHandler,
            ],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                openLink:   OpenLinkPickerHandler,
            ) => () => {
                actions.register('editor.openLinkPicker', openLink);
                extensions.register('linkWidget', () => LinkWidget);
            },
        },
    ];
}
