import { inject, provideAppInitializer } from '@angular/core';
import { consoleEntry } from '@coolms/core-angular';
import { DocxViewerComponent, ViewerComponentRegistry } from '@coolms/document-viewer-angular';
import { provideCoolmsEditorDocument } from '../../document-widget/providers/provide-coolms-editor-document';
import { DocumentSpaceAccordionComponent } from '../document-space-accordion.component';
import { DocumentDetailComponent } from '../explorer/document-detail.component';
import { DocumentFoldersTreeComponent } from '../explorer/document-folders-tree.component';
import { DocumentGridComponent } from '../explorer/document-grid.component';
import { DocumentLibraryPage } from '../explorer/document-library.page';
import { DocumentStatusBarComponent } from '../explorer/document-status-bar.component';
import { provideCoolmsEditorFonts } from '../providers/provide-coolms-editor-fonts';
import { registerWordComponents } from '../word/word-detail-registration';

/**
 * Document's console entry: the document library and its slot components,
 * the fonts and generation pages, the editor's fonts and document widget, the
 * docx viewer, and the per-format detail components (console@1). The
 * document-widget feature is this module's; its provision rides here.
 */
export default consoleEntry({
    module:   'document',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'content/document-fonts',
            component: () => import('../fonts/document-fonts.page').then(m => m.DocumentFontsPageComponent),
            nav:       { activeNav: '/admin/content/document-fonts' },
        },
        {
            path:      'documents/generations',
            component: () => import('../generation-list/document-generation-list-page.component').then(m => m.DocumentGenerationListPageComponent),
            nav:       { activeNav: '/documents/generations' },
        },
        {
            path:      'documents/generations/:id',
            component: () => import('../generation-detail/document-generation-detail-page.component').then(m => m.DocumentGenerationDetailPageComponent),
            nav:       { activeNav: '/documents/generations' },
        },
    ],
    bindings: [
        { name: 'DocumentLibraryPage',    component: DocumentLibraryPage },
        { name: 'DocumentFoldersTree',    component: DocumentFoldersTreeComponent },
        { name: 'DocumentSpaceAccordion', component: DocumentSpaceAccordionComponent },
        { name: 'DocumentGrid',           component: DocumentGridComponent },
        { name: 'DocumentDetail',         component: DocumentDetailComponent },
        { name: 'DocumentStatusBar',      component: DocumentStatusBarComponent },
    ],
    providers: [
        // The editor reads the MERGED font registry through this application's HTTP client.
        ...provideCoolmsEditorFonts(),
        // The document.openPicker handler and the documentWidget extension factory.
        ...provideCoolmsEditorDocument(),
        // The docx viewer, until the Word frontend package registers itself.
        provideAppInitializer(() => {
            inject(ViewerComponentRegistry).register('app-docx-viewer', DocxViewerComponent);
        }),
        // The per-format detail components, under document-detail-{format}.
        provideAppInitializer(() => registerWordComponents()),
    ],
});
