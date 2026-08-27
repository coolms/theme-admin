import { type Routes } from '@angular/router';

/**
 * Themes Explorer routes (#1747).
 *
 * `/admin/themes` — installed themes, which one is active, which sites each
 * serves, and the templates it overrides.
 */
export const THEME_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./themes-list.page').then(m => m.ThemesListComponent),
    },
];
