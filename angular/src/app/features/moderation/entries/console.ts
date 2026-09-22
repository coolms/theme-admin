import { consoleEntry } from '@coolms/core-angular';

/**
 * Comment's console entry: the pending-comment moderation queue (console@1).
 */
export default consoleEntry({
    module:   'comment',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'moderation',
            children:  () => import('../moderation.routes').then(m => m.MODERATION_ROUTES),
            nav:       { activeNav: '/moderation' },
        },
    ],
});
