import { consoleEntry } from '@coolms/core-angular';

/**
 * Experiment's console entry: the A/B experiment list + per-variant results with Start/Stop (console@1).
 */
export default consoleEntry({
    module:   'experiment',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'experiments',
            children:  () => import('../experiments.routes').then(m => m.EXPERIMENT_ROUTES),
            nav:       { activeNav: '/experiments' },
        },
    ],
});
