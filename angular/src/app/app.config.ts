import { type ApplicationConfig, APP_INITIALIZER, inject, provideAppInitializer } from '@angular/core';
import { provideRouter, withEnabledBlockingInitialNavigation } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { provideCoolmsPdf } from '@coolms/pdf-angular';
import {
    EDITOR_MANIFEST_PROVIDER,
    type EditorManifestProvider,
    type EditorProfileManifest,
    provideCoolmsEditor,
    provideCoolmsEditorFormField,
} from '@coolms/editor-angular';
import { CentrifugoNotificationStreamService, CheckboxFieldWidgetComponent, CodeEditorComponent, DateFieldWidgetComponent, DynamicRecordListComponent, FileEditorRegistry, NOTIFICATION_STREAM, OptionSourceFilterWidgetComponent, provideDataGridFilterWidget, provideFieldWidget, TagFieldWidgetComponent, TaxonomyFieldWidgetComponent, TextareaFieldWidgetComponent, TextFieldWidgetComponent } from '@coolms/ui-angular';
import { SheetEditorDialogComponent } from '@coolms/sheet-editor-angular';
import { DDOC_DOCUMENT_MIME } from './features/documents/shared/ddoc-document.service';
import { SHEET_DOCUMENT_MIME } from './features/documents/shared/sheet-document.constants';
import { routes } from './app.routes';
import { CONSOLE_ENTRIES } from './console.registry';
import { AuthState, AppConfigState, CURRENT_SECTION, type CurrentSectionPort, authInterceptor, elevationInterceptor, sectionInterceptor, AppInitService, ComponentRegistry, provideConsole } from '@coolms/core-angular';
import { provideElevationPrompt } from './shell/elevation-prompt.provider';
import { SectionState } from './features/sections/section.state';
import { TerminalPanelComponent } from './features/terminal/terminal-panel.component';
import { DtmplEditorDialogComponent } from './shell/dtmpl-editor-dialog.component';
import { RoutingInspectorFormComponent }    from './features/routing-inspector/routing-inspector-form.component';
import { RoutingInspectorStepsComponent }   from './features/routing-inspector/routing-inspector-steps.component';

// Register NaviGraph component targets
ComponentRegistry.register('terminal',          TerminalPanelComponent);
// Articles' three registrations are GONE ( (d), ) along with the
// `content:articles` layout they served.
// -- Pages became an explorer, so its grid is a slot component now
// rather than a routed page, and it gained a space accordion beside it.
// -- Pages was the only explorer with no right panel, so everything a
// page IS beyond its name was reachable only by opening the editor.

// Document Library slot components (the per-format restructure)
// H4 -- DocumentSpaceAccordion wraps DocumentFoldersTree in a "spaces"
// accordion (Personal / Shared / per-site). The accordion rebinds the
// folders tree to the active space's rootPath.


// Media Library slot components (loaded by ExplorerLayoutComponent via SlotComponent)

// VFS File Manager slot components (loaded by ExplorerLayoutComponent via SlotComponent)

// List layout slot components
// NaviNodesList / PagesList / TranslationsList migrated to the <cms-list-page>
// scaffold (routed directly, no slot registration). TranslationDetail still
// renders through cms-list-layout's `i18n:translation-detail` slot.
// reference adopter -- Routing Inspector slots rendered by
// cms-inspector-layout (id=web:routing-inspector). The three slots
// share state through RoutingInspectorStateService, provided at the
// route level in app.routes.ts.
ComponentRegistry.register('DynamicRecordList', DynamicRecordListComponent);
// Identity's profile.tab slot (`profile.tab:<settings section>`) is filled by
// the modules' console entries -- Call binds `profile.tab:call` in
// features/call/entries/console.ts.

// File editor registry -- CodeMirror for text files
FileEditorRegistry.register('text/*',           { component: CodeEditorComponent });
FileEditorRegistry.register('application/json', { component: CodeEditorComponent });
FileEditorRegistry.register('application/xml',  { component: CodeEditorComponent });

// File editor registry -- Tiptap-based DTMPL body editor for .dtmpl variants
// and standalone .dtmpl files. Exact-mime match beats the `text/*` wildcard
// in the resolver, so this takes precedence over CodeEditor for dtmpl.
FileEditorRegistry.register('text/x-dtmpl', { component: DtmplEditorDialogComponent });

// File editor registry -- native documents. The SAME dialog:
// everything around the content -- the paged canvas, the split preview, the
// download, the toolbar profile -- is the same editor, and only the three calls
// that touch the FILE differ.
//
// The EXACT registration is required, not decoration: the resolver's wildcard
// fallback is the mime's first segment plus `/*` -- `application/*` -- which
// nothing registers, so `application/x-coolms-document+json` would otherwise
// miss every lookup and a `.ddoc` would open in the code editor, which is
// where it landed before this line existed.
FileEditorRegistry.register(DDOC_DOCUMENT_MIME, { component: DtmplEditorDialogComponent });

// File editor registry -- native spreadsheet templates. A `.dsheet`
// is a JSON grid document, and this is the GRID surface for it; CodeMirror held
// the mime while that was being built, which made the format authorable only by
// someone willing to hand-edit JSON.
//
// The EXACT registration is required, not decoration: the resolver's wildcard
// fallback is the mime's first segment plus `/*` -- `application/*` -- which
// nothing registers, so `application/x-coolms-sheet+json` would otherwise miss
// every lookup and the Documents library would show "No editor is registered
// for this template format".
FileEditorRegistry.register(SHEET_DOCUMENT_MIME, { component: SheetEditorDialogComponent });



export const appConfig: ApplicationConfig = {
    providers: [
        // The section interceptor stamps `X-CoolMS-Section` and needs the
        // active slug; Sections owns that state. Binding the two here is
        // what lets `core` stay free of feature imports.
        {
            provide:    CURRENT_SECTION,
            useFactory: (store: Store): CurrentSectionPort => ({
                currentSlug: () => store.selectSnapshot(SectionState.currentSectionSlug),
            }),
            deps:       [Store],
        },
        // withEnabledBlockingInitialNavigation ensures the router waits for all
        // APP_INITIALIZER promises to resolve before starting the initial
        // navigation.  Without it the router evaluates authGuard concurrently
        // with AppInitService.load(), so RestoreSession's non-null (but expired)
        // accessToken satisfies isAuthenticated and VFS renders before the
        // interceptor has a chance to dispatch Logout.
        provideRouter(routes, withEnabledBlockingInitialNavigation()),
        // Interceptor order matters: section runs before auth so the
        // X-CoolMS-Section header is in place before the auth interceptor
        // queues the request behind initService.ready$. Both are pure
        // request-mutators; ordering does not affect correctness, only
        // observability.
        //
        // Elevation sits BEFORE auth on purpose: on a 403 it opens
        // the prompt and, on a grant, sends the refused request again through
        // , which re-enters auth -- so the retry carries the token that
        // is current THEN, not the one stamped before a prompt the person may
        // have left open across a refresh.
        provideHttpClient(withXhr(), withInterceptors([sectionInterceptor, elevationInterceptor, authInterceptor])),
        // The prompt core asks for through its port: a CDK dialog here.
        provideElevationPrompt(),
        // Centrifugo realtime replaces the
        // 2 s polling stream. `PollingNotificationStreamService` stays
        // in the repo as a fallback reference; remove once
        // confidence builds.
        { provide: NOTIFICATION_STREAM, useExisting: CentrifugoNotificationStreamService },
        {
            provide: APP_INITIALIZER,
            useFactory: (init: AppInitService) => () => init.load(),
            deps: [AppInitService],
            multi: true,
        },

 // the viewer federation. PDF lives in `@coolms/pdf-angular` and registers
        // itself via `provideCoolmsPdf()`. DOCX hasn't been extracted to
        // `@coolms/word` yet, so register the component inline here --
        // the bootstrap call is the only thing that has to move when
        // the Word frontend package is created.
        provideCoolmsPdf(),

        // Bridge: built-in handlers + foundation Tiptap extensions.
        ...provideCoolmsEditor(),
        // formField universal atom: registers `formField.upsert` action handler
        // (opens the picker dialog) and the `formField` Tiptap extension factory.
        ...provideCoolmsEditorFormField(),
        // Built-in field widgets: the registry is the single resolution path for
        // every field-panel input. A field with no richer module widget resolves
        // to one of these by its `type` (`text` is also the fallback for unknown
        // types), so there is no hardcoded per-type input branch in the renderer.
        provideFieldWidget('text', TextFieldWidgetComponent),
        provideFieldWidget('textarea', TextareaFieldWidgetComponent),
        provideFieldWidget('date', DateFieldWidgetComponent),
        // `checkbox` and `boolean` are one type under two spellings: module field
        // YAML writes `checkbox`, the schema editor's dropdown offers `boolean`,
        // and FieldTypeMap stores both as `bool`. Both must resolve to the switch
        // or a field created from the dropdown renders no control at all.
        provideFieldWidget('checkbox', CheckboxFieldWidgetComponent),
        provideFieldWidget('boolean', CheckboxFieldWidgetComponent),
        // Tag module's field-widget: a field declared `type: tags` renders the
        // `<app-tag-input>` badge/search input (field-widget registry). Gated on
        // the backend advertising a `widget` for the field, so it lights up only
        // where the Tag module is installed.
        provideFieldWidget('tags', TagFieldWidgetComponent),
        // Taxonomy module's field-widget: a field declared `type: taxonomy`
        // renders the category multi-picker (scoped tree + inline create).
        provideFieldWidget('taxonomy', TaxonomyFieldWidgetComponent),
        // DataGrid filter-widget registry (the operator-aware sibling of the
        // field-widget registry): a column declaring `filterWidget.kind:
        // 'option-source'` renders the grouped multi-select in the filter row.
        // Reference widget; activates only for columns that opt in via the
        // backend `filterWidget` descriptor (additive, non-breaking).
        provideDataGridFilterWidget('option-source', OptionSourceFilterWidgetComponent),
        // App-side adapter that feeds the bridge from NgXS-cached ApiManifest.
        // Bridge stays storage-agnostic; this is the only place the
        // theme-admin app translates its state shape into bridge shape.
        {
            provide: EDITOR_MANIFEST_PROVIDER,
            useFactory: (): EditorManifestProvider => {
                const store = inject(Store);
                return {
                    getProfile(name: string): EditorProfileManifest | null {
                        const manifest = store.selectSnapshot(AppConfigState.manifest);
                        return manifest?.editor?.profiles?.[name] ?? null;
                    },
                };
            },
        },
        // console@1: the store (the shell's states and every module's), the
        // modules' registry bindings, and their provisions -- from the entries
        // scripts/assemble-console.mjs collected. LAST, because a module's
        // provision extends a library registry provided above (the editor
        // bridge, the PDF viewer), as the hand-written lines did.
        provideConsole(CONSOLE_ENTRIES, { hostStates: [AppConfigState, AuthState, SectionState] }),
    ],
};
