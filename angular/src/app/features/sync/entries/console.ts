import { consoleEntry } from '@coolms/core-angular';

/**
 * Sync's console entry: the fleet admin -- register/edit/remove edge nodes, health, cursor, nudge (console@1).
 */
export default consoleEntry({
    module:   'sync',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'sync-fleet',
            component: () => import('../sync-fleet-list.page').then(m => m.SyncFleetListPageComponent),
            nav:       { activeNav: '/sync-fleet' },
        },
    ],
});
