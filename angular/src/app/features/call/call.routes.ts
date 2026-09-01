import { type Routes } from '@angular/router';

/**
 * / — Call telephony admin routes.
 * `/admin/call/records`      — read-only call-history list (GET /api/v1/call/records).
 * `/admin/call/records/:id`  — read-only call detail + recording player.
 * The live-call card / wallboard lands later (, over the Centrifugo channels).
 */
export const CALL_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./call-records-list.page').then(m => m.CallRecordsListComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./call-record-detail.page').then(m => m.CallRecordDetailComponent),
    },
];
