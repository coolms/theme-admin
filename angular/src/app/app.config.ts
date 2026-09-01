import { type ApplicationConfig, APP_INITIALIZER, inject, provideAppInitializer } from '@angular/core';
import { provideRouter, withEnabledBlockingInitialNavigation } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideStore, Store } from '@ngxs/store';
import { ViewerComponentRegistry, DocxViewerComponent } from '@coolms/document-viewer-angular';
import { provideCoolmsPdf } from '@coolms/pdf-angular';
import { provideCoolmsPdfMedia } from './features/media/providers/provide-coolms-pdf-media';
import {
    EDITOR_MANIFEST_PROVIDER,
    type EditorManifestProvider,
    type EditorProfileManifest,
    provideCoolmsEditor,
    provideCoolmsEditorFormField,
} from '@coolms/editor-angular';
import { provideCoolmsEditorMedia } from './features/media/providers/provide-coolms-editor-media';
import { provideCoolmsEditorFonts } from './features/documents/providers/provide-coolms-editor-fonts';
import { provideCoolmsEditorLink } from './features/link/providers/provide-coolms-editor-link';
import { provideCoolmsEditorContent } from './features/content/providers/provide-coolms-editor-content';
import { provideCoolmsEditorForm } from './features/form-widget/providers/provide-coolms-editor-form';
import { provideCoolmsEditorDocument } from './features/document-widget/providers/provide-coolms-editor-document';
import { provideCoolmsEditorImageMap } from './features/image-map-widget/providers/provide-coolms-editor-image-map';
import { CentrifugoNotificationStreamService, CheckboxFieldWidgetComponent, CodeEditorComponent, DateFieldWidgetComponent, DynamicRecordListComponent, FileEditorRegistry, NOTIFICATION_STREAM, OptionSourceFilterWidgetComponent, provideDataGridFilterWidget, provideFieldWidget, RUNTIME_TYPES_PORT, TagFieldWidgetComponent, TaxonomyFieldWidgetComponent, TextareaFieldWidgetComponent, TextFieldWidgetComponent } from '@coolms/ui-angular';
import { SheetEditorDialogComponent } from '@coolms/sheet-editor-angular';
import { WORKFLOW_BPMN_LITE_BODY_MIME, WORKFLOW_PACKAGE_MIME } from './features/designer/shared/workflow-node-path';
import { DDOC_DOCUMENT_MIME } from './features/documents/shared/ddoc-document.service';
import { SHEET_DOCUMENT_MIME } from './features/documents/shared/sheet-document.constants';
import { MediaFieldWidgetComponent } from './features/media/media-field-widget.component';
import { MediaPickerFieldWidgetComponent } from './features/media/media-picker-field-widget.component';
import { SchemaService } from './features/schema/schema.service';
import { routes } from './app.routes';
import { AuthState, AppConfigState, CURRENT_SECTION, type CurrentSectionPort, authInterceptor, sectionInterceptor, AppInitService, ComponentRegistry } from '@coolms/core-angular';
import { SectionState } from './features/sections/section.state';
import { NaviState } from './features/navi/navi.state';
import { VfsState } from './features/vfs/vfs.state';
import { TerminalPanelComponent } from './features/terminal/terminal-panel.component';
import { MediaLibraryPage } from './features/media/media-library.page';
import { CollectionsTreeComponent } from './features/media/collections-tree.component';
import { MediaSpaceAccordionComponent } from './features/media/media-space-accordion.component';
import { MediaGridSlotComponent } from './features/media/media-grid-slot.component';
import { MediaDetailSlotComponent } from './features/media/media-detail-slot.component';
import { MediaPermissionsComponent } from './features/media/media-permissions.component';
import { MoveToDialogComponent } from './features/media/move-to-dialog.component';
import { VfsTreeSlotComponent } from './features/vfs/vfs-tree-slot.component';
import { VfsFilesSlotComponent } from './features/vfs/vfs-files-slot.component';
import { VfsFileDetailSlotComponent } from './features/vfs/vfs-file-detail-slot.component';
import { DtmplEditorDialogComponent } from './shell/dtmpl-editor-dialog.component';
import { TranslationDetailComponent } from './features/translations/translation-detail.component';
import { RoutingInspectorFormComponent }    from './features/routing-inspector/routing-inspector-form.component';
import { RoutingInspectorOutcomeComponent } from './features/routing-inspector/routing-inspector-outcome.component';
import { RoutingInspectorStepsComponent }   from './features/routing-inspector/routing-inspector-steps.component';
import { PageEditorComponent } from './features/content/page-editor.component';
import { DesignerEditorDialogComponent } from './features/designer/designer-editor-dialog.component';
import { DomainExplorerTreeComponent } from './features/schema/domain-explorer-tree.component';
import { DomainExplorerDetailComponent } from './features/schema/domain-explorer-detail.component';
import { DynamicEntitiesPageComponent } from './features/schema/dynamic-entities-page.component';
import { DocumentLibraryPage } from './features/documents/explorer/document-library.page';
import { DocumentFoldersTreeComponent } from './features/documents/explorer/document-folders-tree.component';
import { DocumentSpaceAccordionComponent } from './features/documents/document-space-accordion.component';
import { PageSpaceAccordionComponent } from './features/content/page-space-accordion.component';
import { PagesListComponent } from './features/content/pages-list.component';
import { PageDetailComponent } from './features/content/page-detail.component';
import { DocumentGridComponent } from './features/documents/explorer/document-grid.component';
import { DocumentDetailComponent } from './features/documents/explorer/document-detail.component';
import { DocumentStatusBarComponent } from './features/documents/explorer/document-status-bar.component';
import { registerWordComponents } from './features/documents/word/word-detail-registration';

// Register NaviGraph component targets
ComponentRegistry.register('terminal',          TerminalPanelComponent);
ComponentRegistry.register('MediaLibraryPage',  MediaLibraryPage);
ComponentRegistry.register('DocumentLibraryPage', DocumentLibraryPage);
// Articles' three registrations are GONE ( (d), ) along with the
// `content:articles` layout they served.
// — Pages became an explorer, so its grid is a slot component now
// rather than a routed page, and it gained a space accordion beside it.
ComponentRegistry.register('PageSpaceAccordion',    PageSpaceAccordionComponent);
ComponentRegistry.register('PagesList',             PagesListComponent);
// — Pages was the only explorer with no right panel, so everything a
// page IS beyond its name was reachable only by opening the editor.
ComponentRegistry.register('PageDetail',            PageDetailComponent);

// Document Library slot components (F.13b -> F.14c-1 restructure)
ComponentRegistry.register('DocumentFoldersTree',      DocumentFoldersTreeComponent);
// H4 — DocumentSpaceAccordion wraps DocumentFoldersTree in a "spaces"
// accordion (Personal / Shared / per-site). The accordion rebinds the
// folders tree to the active space's rootPath.
ComponentRegistry.register('DocumentSpaceAccordion',   DocumentSpaceAccordionComponent);
ComponentRegistry.register('DocumentGrid',             DocumentGridComponent);
ComponentRegistry.register('DocumentDetail',           DocumentDetailComponent);
ComponentRegistry.register('DocumentStatusBar',        DocumentStatusBarComponent);

// F.14c-1: per-format detail components register themselves under
// `document-detail-{format}` keys; the cross-format `DocumentDetail`
// dispatcher dispatches to the right one via NgComponentOutlet.
// Adding a Spreadsheet/Markdown module is purely additive — drop a
// sibling `register{Format}Components()` here.
registerWordComponents();

// Media Library slot components (loaded by ExplorerLayoutComponent via SlotComponent)
ComponentRegistry.register('CollectionsTree',         CollectionsTreeComponent);
ComponentRegistry.register('MediaSpaceAccordion',     MediaSpaceAccordionComponent);
ComponentRegistry.register('MediaGrid',               MediaGridSlotComponent);
ComponentRegistry.register('MediaDetail',             MediaDetailSlotComponent);
ComponentRegistry.register('MediaPermissionsComponent', MediaPermissionsComponent);
ComponentRegistry.register('MoveToDialogComponent',   MoveToDialogComponent);

// VFS File Manager slot components (loaded by ExplorerLayoutComponent via SlotComponent)
ComponentRegistry.register('VfsTree',       VfsTreeSlotComponent);
ComponentRegistry.register('VfsGrid',       VfsFilesSlotComponent);
ComponentRegistry.register('VfsFileDetail', VfsFileDetailSlotComponent);

// List layout slot components
// NaviNodesList / PagesList / TranslationsList migrated to the <cms-list-page>
// scaffold (routed directly, no slot registration). TranslationDetail still
// renders through cms-list-layout's `i18n:translation-detail` slot.
ComponentRegistry.register('TranslationDetail', TranslationDetailComponent);
// reference adopter -- Routing Inspector slots rendered by
// cms-inspector-layout (id=web:routing-inspector). The three slots
// share state through RoutingInspectorStateService, provided at the
// route level in app.routes.ts.
ComponentRegistry.register('RoutingInspectorForm',    RoutingInspectorFormComponent);
ComponentRegistry.register('RoutingInspectorOutcome', RoutingInspectorOutcomeComponent);
ComponentRegistry.register('RoutingInspectorSteps',   RoutingInspectorStepsComponent);
ComponentRegistry.register('DomainExplorerTree',   DomainExplorerTreeComponent);
ComponentRegistry.register('DomainExplorerDetail', DomainExplorerDetailComponent);
ComponentRegistry.register('DynamicEntitiesPage',  DynamicEntitiesPageComponent);
ComponentRegistry.register('DynamicRecordList', DynamicRecordListComponent);

// File editor registry — CodeMirror for text files
FileEditorRegistry.register('text/*',           { component: CodeEditorComponent });
FileEditorRegistry.register('application/json', { component: CodeEditorComponent });
FileEditorRegistry.register('application/xml',  { component: CodeEditorComponent });

// File editor registry — Tiptap-based DTMPL body editor for .dtmpl variants
// and standalone .dtmpl files. Exact-mime match beats the `text/*` wildcard
// in the resolver, so this takes precedence over CodeEditor for dtmpl.
FileEditorRegistry.register('text/x-dtmpl', { component: DtmplEditorDialogComponent });

// File editor registry — native documents. The SAME dialog:
// everything around the content — the paged canvas, the split preview, the
// download, the toolbar profile — is the same editor, and only the three calls
// that touch the FILE differ.
//
// The EXACT registration is required, not decoration: the resolver's wildcard
// fallback is the mime's first segment plus `/*` — `application/*` — which
// nothing registers, so `application/x-coolms-document+json` would otherwise
// miss every lookup and a `.ddoc` would open in the code editor, which is
// where it landed before this line existed.
FileEditorRegistry.register(DDOC_DOCUMENT_MIME, { component: DtmplEditorDialogComponent });

// File editor registry — native spreadsheet templates. A `.dsheet`
// is a JSON grid document, and this is the GRID surface for it; CodeMirror held
// the mime while that was being built, which made the format authorable only by
// someone willing to hand-edit JSON.
//
// The EXACT registration is required, not decoration: the resolver's wildcard
// fallback is the mime's first segment plus `/*` — `application/*` — which
// nothing registers, so `application/x-coolms-sheet+json` would otherwise miss
// every lookup and the Documents library would show "No editor is registered
// for this template format".
FileEditorRegistry.register(SHEET_DOCUMENT_MIME, { component: SheetEditorDialogComponent });

// File editor registry — PageEditor for NodeType::Package (double-click in FileManager)
FileEditorRegistry.register('package', { component: PageEditorComponent });

// — Workflow BPMN-Lite designer, opened as a modal
// dialog. Two registrations, both routing to the same component:
//  - The Package container at `/workflows/{key}/` carries the
//    `application/vnd.coolms.workflow` mime; double-click on the
//    package opens the dialog with the package node, the dialog
//    derives the workflow key from the path, fetches the draft via
//    the endpoints, and mounts the editor stack.
//  - The body files (`draft.bpmn.json`, `v{N}.bpmn.json`) carry the
//    `application/vnd.coolms.workflow.bpmn-lite+json` mime so a
//    drill-in double-click on the draft also lands here. The generic
//    dialog derives editor-vs-viewer from the path: `v{N}.bpmn.json`
//    opens read-only (the `version` it extracts), a Package /
//    `draft.bpmn.json` opens the editable draft.
// Both register against the generic `DesignerEditorDialogComponent`
// (the same modal the Definitions list opens), which hosts the bpmn
// editor page embedded — replacing the retired bespoke bpmn dialog.
// Exact-mime registrations beat the `application/json` + `text/*`
// fallbacks via `FileEditorRegistry.resolve`'s lookup order.
FileEditorRegistry.register(WORKFLOW_PACKAGE_MIME, {
    component: DesignerEditorDialogComponent,
});
FileEditorRegistry.register(WORKFLOW_BPMN_LITE_BODY_MIME, {
    component: DesignerEditorDialogComponent,
});

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
        // The shared dynamic-record list needs one schema read. Binding it
        // here keeps `shared/` from naming a feature, and the feature from
        // knowing who consumes it -- the composition root is the only place
        // allowed to see both.
        { provide: RUNTIME_TYPES_PORT, useExisting: SchemaService },
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
        provideHttpClient(withXhr(), withInterceptors([sectionInterceptor, authInterceptor])),
        provideStore([AppConfigState, AuthState, SectionState, NaviState, VfsState]),
        // sub-phase 2d -- Centrifugo realtime replaces the
        // 2 s polling stream. `PollingNotificationStreamService` stays
        // in the repo as a fallback reference; remove in Phase 2 once
        // confidence builds.
        { provide: NOTIFICATION_STREAM, useExisting: CentrifugoNotificationStreamService },
        {
            provide: APP_INITIALIZER,
            useFactory: (init: AppInitService) => () => init.load(),
            deps: [AppInitService],
            multi: true,
        },

        // F.7 viewer federation. PDF lives in `@coolms/pdf-angular` and registers
        // itself via `provideCoolmsPdf()`. DOCX hasn't been extracted to
        // `@coolms/word` yet, so register the component inline here —
        // the bootstrap call is the only thing that has to move when
        // the Word frontend package is created.
        provideCoolmsPdf(),
        // The viewer's image tool opens the Media Library rather than the
        // browser's upload dialog. Must follow provideCoolmsPdf().
        provideCoolmsPdfMedia(),
        provideAppInitializer(() => {
            const registry = inject(ViewerComponentRegistry);
            registry.register('app-docx-viewer', DocxViewerComponent);
        }),

        // Bridge: built-in handlers + foundation Tiptap extensions.
        ...provideCoolmsEditor(),
        // Fonts: hands the editor this application's HTTP client, so it can
        // read the MERGED registry -- the vendored families plus the ones an
        // operator installed. Without it the editor falls back to the shipped
        // manifest asset and installed families are simply absent.
        ...provideCoolmsEditorFonts(),
        // Media module: registers media.openPicker / media.openGalleryPicker
        // action handlers and the mediaWidget / mediaGalleryWidget Tiptap
        // extension factories. Must come after provideCoolmsEditor() so the
        // bridge's registries exist before this initializer runs.
        ...provideCoolmsEditorMedia(),
        // Link module: registers the linkWidget Tiptap extension factory.
        // Action handler swap (`editor.openLinkPicker`) lands in B3.
        ...provideCoolmsEditorLink(),
        // Content module: registers the `content.importMarkdown` action handler
        // (the "Import Markdown" toolbar button in full/admin/document-builder).
        ...provideCoolmsEditorContent(),
        // formField universal atom: registers `formField.upsert` action handler
        // (opens the picker dialog) and the `formField` Tiptap extension factory.
        ...provideCoolmsEditorFormField(),
        // Form module: registers the `form.openPicker` action handler (opens the
        // form picker) and the `formWidget` Tiptap extension factory. The backend
        // `block:form` contributor surfaces it in both the toolbar and the slash
        // menu; inserts `{widget:form formId=…}` into the page.
        ...provideCoolmsEditorForm(),
        // Document module: registers the `document.openPicker` action handler
        // (opens the TEMPLATE picker) and the `documentWidget` Tiptap extension
        // factory. The backend `block:document` contributor surfaces it in both
        // the toolbar and the slash menu; inserts `{widget:document:<slug>}`,
        // which renders a "Generate document" button for the reader.
        ...provideCoolmsEditorDocument(),
        // ImageMap module: registers the `imagemap.openPicker` action handler
        // (opens the MAP picker) and the `imageMapWidget` Tiptap extension
        // factory. The backend `block:imagemap` contributor surfaces it in both
        // the toolbar and the slash menu; inserts `{widget:imagemap:<slug>}`,
        // which renders the map image with its region overlay for the reader.
        ...provideCoolmsEditorImageMap(),
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
        // Media module's field-widget: a field declared `type: image` renders the
        // Media Library picker (thumbnail preview + library browser), storing the
        // picked asset's public URL. Backed by `MediaFieldWidgetProvider` (PHP).
        provideFieldWidget('image', MediaFieldWidgetComponent),
        // Relation fields declaring `widget: media-picker` resolve here, so
        // shared/dynamic-form never imports the Media module.
        provideFieldWidget('media-picker', MediaPickerFieldWidgetComponent),
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
    ],
};
