import { consoleEntry } from '@coolms/core-angular';

/**
 * Definition's console entry: the unified definitions catalogue across
 * Workflow, Decision and Form (console@1).
 */
export default consoleEntry({
    module:   'definition',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'definitions',
            children: () => import('../definitions.routes').then(m => m.DEFINITION_ROUTES),
            nav:      { activeNav: '/definitions' },
        },
    ],
});
