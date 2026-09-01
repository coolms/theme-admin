import { type Routes } from '@angular/router';

/**
 * — Calendar admin routes.
 * `/admin/calendars`         — list page
 * `/admin/calendars/:slug`   — detail page (settings + working hours + holiday rules + preview)
 */
export const CALENDAR_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./calendars-list.page').then(m => m.CalendarsListComponent),
    },
    {
        path: ':slug',
        loadComponent: () =>
            import('./calendar-detail.page').then(m => m.CalendarDetailPageComponent),
    },
];
