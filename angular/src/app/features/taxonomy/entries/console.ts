import { consoleEntry } from '@coolms/core-angular';

/**
 * Taxonomy's console entry: the Categories admin over the categories tree (console@1).
 */
export default consoleEntry({
    module:   'taxonomy',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'taxonomy/categories',
            component: () => import('../categories-page.component').then(m => m.CategoriesPageComponent),
            nav:       { activeNav: '/taxonomy/categories' },
        },
    ],
});
