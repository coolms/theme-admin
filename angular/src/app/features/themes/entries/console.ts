import { consoleEntry } from '@coolms/core-angular';

/**
 * Theme's console entry: the Themes Explorer -- which theme skins each site and what it overrides (console@1).
 */
export default consoleEntry({
    module:   'theme',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'themes',
            children:  () => import('../themes.routes').then(m => m.THEME_ROUTES),
            nav:       { activeNav: '/themes' },
        },
    ],
});
