import { type Routes } from '@angular/router';

/**
 * M5.d.3 — Connector admin routes. Today just the inbound-webhook triggers
 * admin (`/admin/webhooks`); future M5 connector-admin surfaces (outbound
 * config, external workers) can land as siblings here.
 */
export const CONNECTOR_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./webhooks-list.page').then(m => m.WebhooksListPageComponent),
    },
];
