import { consoleEntry } from '@coolms/core-angular';

/**
 * Backup's console entry: list on-disk bundles, create one, dry-run a restore (console@1).
 */
export default consoleEntry({
    module:   'backup',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'backups',
            component: () => import('../backups-list.page').then(m => m.BackupsListPageComponent),
            nav:       { activeNav: '/backups' },
        },
    ],
});
