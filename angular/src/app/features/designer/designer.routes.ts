import { type Routes } from '@angular/router';

/**
 * M3.2.h FE -- Designer feature routes.
 *
 * For the M3.2 vertical slice the only surface is the DMN
 * decision-table editor, mounted directly at
 * `/admin/designer/dmn/:key`. The key segment is the same
 * `definitionKey` the backend uses for VFS path minting -- the user
 * navigates there from the cockpit (M4) or a hand-typed URL while
 * the cockpit is still pending.
 *
 * Later ships layer in:
 *  - `/admin/designer/bpmn/:key`         (M3.3 BPMN-Lite editor)
 *  - `/admin/designer/state/:key`        (M3.5 state-machine editor)
 *  - `/admin/designer` index page        (cockpit list; M4)
 *
 * The lazy-load shape mirrors every other feature module (Inbox,
 * Calendars, Schedules); standalone-component routes flatten the
 * import graph.
 */
export const DESIGNER_ROUTES: Routes = [
    {
        path: 'dmn/:key',
        loadComponent: () =>
            import('./dmn-editor.page').then(m => m.DmnEditorPage),
        data: { activeNav: '/designer', fullHeight: true },
    },
    /**
     * M3.3.h.2 -- BPMN-Lite designer page. Closes the M3.3
     * authoring → deploy loop end-to-end. Routes to the M3.3.h.1
     * backend draft + deploy endpoints via `DesignerService`.
     */
    {
        path: 'bpmn/:key',
        loadComponent: () =>
            import('./bpmn-editor.page').then(m => m.BpmnEditorPage),
        data: { activeNav: '/designer', fullHeight: true },
    },
    /**
     * M3.5.e -- State Machine designer page. Authors a Symfony Workflow
     * `state_machine` config visually; routes to the M3.5.e VFS-backed
     * draft + deploy endpoints via `DesignerService`.
     */
    {
        path: 'state/:key',
        loadComponent: () =>
            import('./state-machine-editor.page').then(
                m => m.StateMachineEditorPage,
            ),
        data: { activeNav: '/designer', fullHeight: true },
    },
    /**
     * M4.j slice 5 -- DMN DRD (Decision Requirements Diagram) designer
     * page. Authors a decision's requirements graph visually + saves it
     * to the decision VFS draft as DMN 1.3 XML via `DesignerService`.
     * Deploy is pending the backend `DmnXmlParser` widening past single
     * decision tables (see the page docblock).
     */
    {
        path: 'decision/:key',
        loadComponent: () =>
            import('./decision-drd-editor.page').then(
                m => m.DecisionDrdEditorPage,
            ),
        data: { activeNav: '/designer', fullHeight: true },
    },
];
