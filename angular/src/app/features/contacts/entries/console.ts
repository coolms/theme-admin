import { consoleEntry } from '@coolms/core-angular';

/**
 * Contact's console entry: the generic Person directory over the /contacts CRUD API (console@1).
 */
export default consoleEntry({
    module:   'contact',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'contacts',
            children:  () => import('../contacts.routes').then(m => m.CONTACTS_ROUTES),
            nav:       { activeNav: '/contacts' },
        },
    ],
});
