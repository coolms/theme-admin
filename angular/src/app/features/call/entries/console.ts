import { consoleEntry } from '@coolms/core-angular';
import { CallDialQuickAccessComponent } from '../call-dial-quick-access.component';
import { CallScreenpopOverlayComponent } from '../call-screenpop-overlay.component';
import { ProfileCallTabComponent } from '../profile-call-tab.component';

/**
 * Call's console entry: what the telephony module contributes to the
 * administration console, as data (console@1). The build collects it; the
 * backend's manifest activates it (config/modules/call/ui.yaml).
 */
export default consoleEntry({
    module:   'call',
    contract: 'console',
    range:    '^1.0',
    routes: [
        // Call history: the read-only list over the AMI-tracked CallRecord read
        // API; detail, recording player and live card under it.
        {
            path:     'call/records',
            children: () => import('../call.routes').then(m => m.CALL_ROUTES),
            nav:      { activeNav: '/call/records' },
        },
        // Live-call wallboard (realtime over the calls.broadcast channel).
        {
            path:      'call/wallboard',
            component: () => import('../call-wallboard.page').then(m => m.CallWallboardComponent),
            nav:       { activeNav: '/call/wallboard' },
        },
    ],
    // Identity's profile.tab slot: the Calls pane for the `call` settings section.
    bindings: [{ name: 'profile.tab:call', component: ProfileCallTabComponent }],
    // The click-to-dial pad in the top bar's quick-access strip.
    topbar:   [{ id: 'call.dial', order: 50, component: CallDialQuickAccessComponent }],
    // The PBX incoming-call screen-pop: a non-intrusive card as calls ring,
    // answer and end, driven by the calls.broadcast firehose.
    overlays: [{ id: 'call.screenpop', component: CallScreenpopOverlayComponent }],
});
