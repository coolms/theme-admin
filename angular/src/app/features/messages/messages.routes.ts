import { type Routes } from '@angular/router';

/**
 * Internal Messages routes (`/admin/messages`,.
 *
 * Single lazy two-pane page (conversation list ↔ thread + composer).
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
