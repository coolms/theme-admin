import { type Routes } from '@angular/router';

/**
 * W8.c — Lead inbox admin routes.
 * `/admin/leads`     — the lead triage queue (New / Handled / Spam).
 * `/admin/leads/:id` — one lead's detail view (omnichannel convergence, #1337).
 */
export const LEADS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./leads-list.page').then(m => m.LeadsListComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./lead-detail.page').then(m => m.LeadDetailComponent),
    },
];
