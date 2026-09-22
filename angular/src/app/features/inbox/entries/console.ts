import { consoleEntry } from '@coolms/core-angular';

/**
 * Inbox's console entry: the 3-tab user-task queue (My / Claimable / Recent), URL-driven tabs, live over the inbox.{userId} channel (console@1).
 */
export default consoleEntry({
    module:   'inbox',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'inbox',
            children:  () => import('../inbox.routes').then(m => m.INBOX_ROUTES),
            nav:       { activeNav: '/inbox' },
        },
    ],
});
