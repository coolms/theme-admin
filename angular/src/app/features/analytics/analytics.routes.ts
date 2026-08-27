import { type Routes } from '@angular/router';

/**
 * W8 — Analytics dashboard admin routes.
 * `/admin/analytics` — the "Top pages" leaderboard over the page-view ledger.
 */
export const ANALYTICS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./analytics.page').then(m => m.AnalyticsPageComponent),
    },
];
