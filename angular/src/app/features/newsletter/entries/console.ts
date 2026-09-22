import { consoleEntry } from '@coolms/core-angular';

/**
 * Newsletter's console entry: confirmed-subscriber list + campaign compose (console@1).
 */
export default consoleEntry({
    module:   'newsletter',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'newsletter',
            children:  () => import('../newsletter.routes').then(m => m.NEWSLETTER_ROUTES),
            nav:       { activeNav: '/newsletter' },
        },
    ],
});
