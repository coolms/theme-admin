import { type Routes } from '@angular/router';

/**
 *Phase 3 (CDP core, ) — Customer Data Platform admin routes
 * under `/admin/cdp`. Surfaces:
 *  - Segments (`/cdp/segments`) — the audience-Segment list; create/edit open a
 *    modal ({@link ./segment-editor-dialog.component}), so there is no routed
 *    editor page.
 *  - Subjects (`/cdp/subjects`) — the profile explorer (list + read-only detail).
 *  - Rules (`/cdp/rules`) — the content-personalization rule list
 *    Phase 4, P4.admin.c); create/edit open a modal ({@link
 *    ./rule-editor-dialog.component}).
 */
export const CDP_ROUTES: Routes = [
    { path: '', redirectTo: 'segments', pathMatch: 'full' },
    {
        path: 'segments',
        loadComponent: () =>
            import('./segments-list.page').then(m => m.SegmentsListPageComponent),
    },
    {
        path: 'subjects',
        loadComponent: () =>
            import('./subjects-list.page').then(m => m.SubjectsListPageComponent),
    },
    {
        path: 'subjects/:key',
        loadComponent: () =>
            import('./subject-detail.page').then(m => m.SubjectDetailPageComponent),
    },
    {
        path: 'rules',
        loadComponent: () =>
            import('./rules-list.page').then(m => m.RulesListPageComponent),
    },
];
