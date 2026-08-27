import { type Routes } from '@angular/router';

/**
 * W8 — Newsletter admin routes.
 * `/admin/newsletter` — the subscriber list + campaign compose page.
 */
export const NEWSLETTER_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./newsletter-list.page').then(m => m.NewsletterListComponent),
    },
];
