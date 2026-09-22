import { consoleEntry } from '@coolms/core-angular';

/**
 * Settings' console entry: the module-settings hub, generated from the contributor registry (console@1).
 */
export default consoleEntry({
    module:   'settings',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'settings',
            children:  () => import('../settings.routes').then(m => m.SETTINGS_ROUTES),
            nav:       { activeNav: '/settings' },
        },
    ],
});
