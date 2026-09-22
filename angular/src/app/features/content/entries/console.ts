import { provideAppInitializer } from '@angular/core';
import { consoleEntry } from '@coolms/core-angular';
import { FileEditorRegistry } from '@coolms/ui-angular';
import { PageDetailComponent } from '../page-detail.component';
import { PageEditorComponent } from '../page-editor.component';
import { PageSpaceAccordionComponent } from '../page-space-accordion.component';
import { PagesListComponent } from '../pages-list.component';
import { provideCoolmsEditorContent } from '../providers/provide-coolms-editor-content';

/**
 * Content's console entry: the pages explorer and its slot components, the
 * editor's content.importMarkdown handler, and the page editor as the file
 * editor of a Package node (console@1).
 */
export default consoleEntry({
    module:   'content',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'content',
            children: () => import('../content.routes').then(m => m.CONTENT_ROUTES),
        },
    ],
    bindings: [
        { name: 'PageSpaceAccordion', component: PageSpaceAccordionComponent },
        { name: 'PagesList',          component: PagesListComponent },
        { name: 'PageDetail',         component: PageDetailComponent },
    ],
    providers: [
        ...provideCoolmsEditorContent(),
        // Double-click on a Package node in the file manager opens the page editor.
        provideAppInitializer(() => {
            FileEditorRegistry.register('package', { component: PageEditorComponent });
        }),
    ],
});
