import { type Routes } from '@angular/router';

/**
 * C.3 (ADR-143) — the /admin/contacts feature routes (lazy child of the admin shell).
 * `''` list; `:id` the Person-hub detail page (#1339 — contact + leads across channels).
 */
export const CONTACTS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./contacts-list.page').then(m => m.ContactsListComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./contact-detail.page').then(m => m.ContactDetailComponent),
    },
];
