import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry } from '@coolms/editor-angular';
import { ImportMarkdownHandler } from '../actions/import-markdown.handler';

/**
 * Bootstrap providers for the Content module's editor integration. Spread into
 * `ApplicationConfig.providers` after `provideCoolmsEditor()` so the bridge's
 * registries exist before this initializer runs.
 *
 * Registers the `content.importMarkdown` action handler — the "Import Markdown"
 * toolbar button (declared by the PHP `MarkdownImportContributor`, present in
 * the `full`/`admin`/`document-builder` profiles). No Tiptap extension to
 * register: the converted HTML inserts into the existing nodes.
 *
 * Mirrors `provideCoolmsEditorMedia()` — the `multi: true` APP_INITIALIZER
 * plurality means it composes additively with the built-ins and other modules.
 */
export function provideCoolmsEditorContent(): Provider[] {
    return [
        ImportMarkdownHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, ImportMarkdownHandler],
            useFactory: (
                actions: EditorActionRegistry,
                importMarkdown: ImportMarkdownHandler,
            ) => () => {
                actions.register('content.importMarkdown', importMarkdown);
            },
        },
    ];
}
