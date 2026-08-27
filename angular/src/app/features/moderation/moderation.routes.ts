import { type Routes } from '@angular/router';

/**
 * W7.d — Comment moderation admin routes.
 * `/admin/moderation` — the pending-comment queue (approve / reject).
 */
export const MODERATION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./moderation-list.page').then(m => m.ModerationListComponent),
    },
];
