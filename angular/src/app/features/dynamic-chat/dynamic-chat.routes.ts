import { type Routes } from '@angular/router';

/**
 * DynamicChat agent inbox routes (`/admin/dynamic-chat`, ledger #995).
 *
 * Single lazy page — a two-pane queue↔thread panel. `fullHeight` lets the
 * admin layout hand the page the full content height (the thread scrolls
 * internally, like the VFS / Media routes).
 */
export const DYNAMIC_CHAT_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./dynamic-chat.page').then(m => m.DynamicChatPageComponent),
    },
];
