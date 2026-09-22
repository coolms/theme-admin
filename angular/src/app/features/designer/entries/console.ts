import { provideAppInitializer } from '@angular/core';
import { consoleEntry } from '@coolms/core-angular';
import { FileEditorRegistry } from '@coolms/ui-angular';
import { DesignerEditorDialogComponent } from '../designer-editor-dialog.component';
import { WORKFLOW_BPMN_LITE_BODY_MIME, WORKFLOW_PACKAGE_MIME } from '../shared/workflow-node-path';

/**
 * Workflow's console entry: the designer (DMN decision tables, BPMN-Lite),
 * full height, and the designer dialog as the file editor of a workflow
 * package and of its BPMN-Lite body files (console@1).
 */
export default consoleEntry({
    module:   'workflow',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'designer',
            children: () => import('../designer.routes').then(m => m.DESIGNER_ROUTES),
            nav:      { activeNav: '/designer', fullHeight: true },
        },
    ],
    providers: [
        provideAppInitializer(() => {
            // The Package container carries the workflow mime; the body files
            // carry the BPMN-Lite mime. Both open the same dialog, which
            // derives editor-vs-viewer from the path.
            FileEditorRegistry.register(WORKFLOW_PACKAGE_MIME, { component: DesignerEditorDialogComponent });
            FileEditorRegistry.register(WORKFLOW_BPMN_LITE_BODY_MIME, { component: DesignerEditorDialogComponent });
        }),
    ],
});
