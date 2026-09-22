import { consoleEntry } from '@coolms/core-angular';

/**
 * Lead's console entry: the lead triage queue (New / Handled / Spam) (console@1).
 */
export default consoleEntry({
    module:   'lead',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'leads',
            children:  () => import('../leads.routes').then(m => m.LEADS_ROUTES),
            nav:       { activeNav: '/leads' },
        },
    ],
});
