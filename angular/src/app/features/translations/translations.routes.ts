import { type Routes } from '@angular/router';

/**
 * F5.d -- Translation catalogues admin routes.
 *
 * `/admin/i18n/translations`      -- list of every (domain, locale)
 *                                    catalogue (TranslationsPage shell)
 * `/admin/i18n/translations/:id`  -- per-catalogue editor; `:id` is
 *                                    the composite `{domain}:{locale}`
 *                                    slug used in API URIs
 *                                    (TranslationDetailPage shell)
 *
 * Both routes mount the platform `cms-list-layout` -- the page chrome
 * comes from `config/modules/i18n/layout/*.yaml` (mirrors the
 * Navigation pattern). Slot components are registered in app.config.ts.
 */
export const TRANSLATION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./translations-list.component').then(m => m.TranslationsListComponent),
    },
    {
        path: ':id',
        loadComponent: () =>
            import('./translation-detail-page.component').then(m => m.TranslationDetailPageComponent),
        data: { layoutId: 'i18n:translation-detail' },
    },
];
