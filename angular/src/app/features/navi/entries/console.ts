import { consoleEntry } from '@coolms/core-angular';
import { NaviState } from '../navi.state';

/**
 * Navi's console entry: the navigation trees and nodes admin, and the
 * navigation state the store carries (console@1).
 */
export default consoleEntry({
    module:   'navi',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'navi',
            children: () => import('../navi.routes').then(m => m.NAVI_ROUTES),
        },
    ],
    states: [NaviState],
});
