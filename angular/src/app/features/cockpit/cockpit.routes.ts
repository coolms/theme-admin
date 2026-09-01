import { type Routes } from '@angular/router';

/**
 * / / — Process Cockpit feature routes.
 *
 * `''`      — the read-only process-instance list at `/admin/cockpit`.
 * `report`  — the aggregate operator report at `/admin/cockpit/report`
 *             (: KPI tiles + throughput + per-definition breakdown).
 *             MUST precede `:id` so it isn't captured as an instance id.
 * `definitions/:definitionId/timing` — the per-definition bottleneck /
 *             timing report, reached from a report row. Also precedes
 *             `:id` (literal `definitions` segment can't collide anyway).
 * `:id`     — the read-only instance detail at `/admin/cockpit/:id` (:
 *             Token positions + history timeline + variables) +
 *             steering actions, reached via row drill-in / the toolbar Open.
 */
export const COCKPIT_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./cockpit-list.page').then(m => m.CockpitListPageComponent),
    },
    {
        path: 'report',
        loadComponent: () =>
            import('./cockpit-report.page').then(m => m.CockpitReportPageComponent),
    },
    {
        path: 'definitions/:definitionId/timing',
        loadComponent: () =>
            import('./cockpit-timing.page').then(m => m.CockpitTimingPageComponent),
    },
    {
        path: 'external-tasks',
        loadComponent: () =>
            import('./cockpit-external-tasks.page').then(m => m.CockpitExternalTasksPageComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./cockpit-detail.page').then(m => m.CockpitDetailPageComponent),
    },
];
