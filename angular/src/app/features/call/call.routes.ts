import { type Routes } from '@angular/router';

/**
 * M9.f.1 / M9.f.2 — Call telephony admin routes.
 * `/admin/call/records`      — read-only call-history list (GET /api/v1/call/records).
 * `/admin/call/records/:id`  — read-only call detail + recording player (M9.f.2).
 * The live-call card / wallboard lands later (M9.f.3, over the M9.c Centrifugo channels).
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
