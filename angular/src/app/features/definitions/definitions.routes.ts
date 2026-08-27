import { type Routes } from '@angular/router';

/**
 * Unified Definitions admin routes.
 * `/admin/definitions` — cross-module catalog list page built on the
 * `<cms-list-page>` scaffold (header + navi action bar + grid + footer
 * count), rendered directly (no cms-list-layout wrapper).
 *
 * Drill-down lands on per-module Designer surfaces:
 *  - workflow → opens the BPMN-Lite editor modal in place
 *  - decision → routes to `/admin/designer/dmn/:key`
 * The catalog itself has no detail page — clicking a row jumps
 * straight to the appropriate editor.
 */
export const DEFINITION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./definitions-list.page').then(m => m.DefinitionsListPageComponent),
    },
];
