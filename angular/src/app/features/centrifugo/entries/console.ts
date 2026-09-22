import { consoleEntry } from '@coolms/core-angular';

/**
 * Centrifugo's console entry: the realtime dashboard (info / namespaces / channels), a channel's detail, debug publish (console@1).
 */
export default consoleEntry({
    module:   'centrifugo',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'centrifugo',
            component: () => import('../centrifugo-dashboard.component').then(m => m.CentrifugoDashboardComponent),
            nav:       { activeNav: '/centrifugo' },
        },
        {
            path:      'centrifugo/channel/:name',
            component: () => import('../centrifugo-channel-detail.component').then(m => m.CentrifugoChannelDetailComponent),
            nav:       { activeNav: '/centrifugo' },
        },
    ],
});
