import { type Routes } from '@angular/router';

/**
 * M1.3 — Scheduler admin routes.
 * `/admin/schedules`         — list page
 * `/admin/schedules/:slug`   — detail page (settings + trigger editor + calendar + payload + history)
 */
export const SCHEDULE_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./schedules-list.page').then(m => m.SchedulesListComponent),
    },
    {
        path: ':slug',
        loadComponent: () =>
            import('./schedule-detail.page').then(m => m.ScheduleDetailPageComponent),
    },
];
