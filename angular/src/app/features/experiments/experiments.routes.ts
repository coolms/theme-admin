import { type Routes } from '@angular/router';

/**
 * W8 — Experiments admin routes (#786).
 * `/admin/experiments` — the A/B experiment list + per-variant results surface,
 * with a "New experiment" dialog and per-experiment Start/Stop controls.
 */
export const EXPERIMENT_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./experiments-list.page').then(m => m.ExperimentsListComponent),
    },
];
