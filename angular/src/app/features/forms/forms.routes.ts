import { type Routes } from '@angular/router';

/**
 * Form Builder admin routes (Track D.3).
 *   `/admin/forms`        — forms list page
 *   `/admin/forms/new`    — builder, blank (author a new form)
 *   `/admin/forms/:id`    — builder, editing an existing form
 *
 * `new` is matched before `:id` so the literal segment wins over the
 * wildcard. The builder treats the absent/`new` id as create-mode.
 */
export const FORM_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./forms-list.page').then(m => m.FormsListPageComponent),
    },
    {
        path: 'new',
        loadComponent: () =>
            import('./form-builder.page').then(m => m.FormBuilderPageComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./form-builder.page').then(m => m.FormBuilderPageComponent),
    },
];
