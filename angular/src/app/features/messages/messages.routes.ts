import { type Routes } from '@angular/router';

/**
 * The Chat module's routes (`/admin/chat`; `/admin/messages` redirects).
 *
 * Single lazy two-pane page (conversation list <-> thread + composer).
 * `fullHeight` lets the admin layout hand the page the full content height
 * (the thread scrolls internally), like the DynamicChat / VFS / Media routes.
 */
export const MESSAGES_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./messages.page').then(m => m.MessagesPageComponent),
    },
];
