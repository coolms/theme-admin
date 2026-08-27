import { type Routes } from '@angular/router';

/**
 * M2.m FE — Inbox feature routes.
 *
 * Single page today: list with URL-driven tab strip (`?tab=`). The
 * route loads `InboxListComponent` directly; it renders its chrome via
 * the `<cms-list-page>` scaffold (page header + navi action bar + footer).
 *
 * Detail / standalone task view lives inside the row's complete +
 * delegate dialogs; no per-task route needed yet.
 */
export const INBOX_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./inbox-list.page').then(m => m.InboxListComponent),
    },
];
