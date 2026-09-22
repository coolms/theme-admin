import { consoleEntry } from '@coolms/core-angular';

/**
 * Analytics' console entry: the analytics dashboard and the customer data
 * platform (segments + subjects), which share the event substrate and the
 * module (console@1). The cdp feature directory is this module's.
 */
export default consoleEntry({
    module:   'analytics',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'analytics',
            children: () => import('../analytics.routes').then(m => m.ANALYTICS_ROUTES),
            nav:      { activeNav: '/analytics' },
        },
        {
            path:     'cdp',
            children: () => import('../../cdp/cdp.routes').then(m => m.CDP_ROUTES),
            nav:      { activeNav: '/cdp' },
        },
    ],
});
