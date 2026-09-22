import { consoleEntry } from '@coolms/core-angular';

/**
 * Cockpit's console entry: the operator's read-only view over the Workflow engine state (console@1).
 */
export default consoleEntry({
    module:   'cockpit',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'cockpit',
            children:  () => import('../cockpit.routes').then(m => m.COCKPIT_ROUTES),
            nav:       { activeNav: '/cockpit' },
        },
    ],
});
