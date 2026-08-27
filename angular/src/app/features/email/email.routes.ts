import { type Routes } from '@angular/router';

/**
 * M8.a.4 — Email mailbox client route. A single full-height three-pane page
 * (mailbox rail / message list / detail + composer) over the M8.a APIs.
 */
export const EMAIL_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./email-mailbox.page').then(m => m.EmailMailboxPageComponent),
    },
];
