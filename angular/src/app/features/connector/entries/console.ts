import { consoleEntry } from '@coolms/core-angular';

/**
 * Connector's console entry: inbound webhook triggers CRUD at /webhooks (console@1).
 */
export default consoleEntry({
    module:   'connector',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'webhooks',
            children:  () => import('../connector.routes').then(m => m.CONNECTOR_ROUTES),
            nav:       { activeNav: '/webhooks' },
        },
    ],
});
