import { type Routes } from '@angular/router';
import { chatPageMatcher } from './chat-address';

/**
 * The Chat module's routes (`/admin/chat`, `/admin/chat/<id>`; `/admin/messages` redirects).
 *
 * Single lazy two-pane page (conversation list <-> thread + composer), one route for the list alone and for an open
 * conversation. `fullHeight` lets the admin layout hand the page the full content height (the thread scrolls
 * internally), like the DynamicChat / VFS / Media routes.
 */
export const MESSAGES_ROUTES: Routes = [
    {
        matcher: chatPageMatcher,
        loadComponent: () =>
            import('./messages.page').then(m => m.MessagesPageComponent),
    },
];
