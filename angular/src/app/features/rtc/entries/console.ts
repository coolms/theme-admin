import { consoleEntry } from '@coolms/core-angular';
import { RtcCallOverlayComponent } from '../rtc-call-overlay.component';

/**
 * Rtc's console entry: the global WebRTC call overlay -- incoming ring and the
 * in-call bar, above every route (console@1).
 */
export default consoleEntry({
    module:   'rtc',
    contract: 'console',
    range:    '^1.0',
    overlays: [{ id: 'rtc.call', component: RtcCallOverlayComponent }],
});
