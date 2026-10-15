import { type ElevationService, type ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, type ToastService } from '@coolms/ui-angular';

import { mailboxChangedSinceRead } from './email.service';

/**
 * Runs `send` as the server's answer for the section's action allows: at once when `allowed`; when `elevate`, after
 * the one shared elevation prompt grants the session (declined or failed: nothing is sent). `denied` sends nothing --
 * a section the caller may only read offers no save.
 */
export function afterAccess(access: CapabilityState, elevation: ElevationService, send: () => void): void {
    if (access === 'allowed' || elevation.elevated()) {
        send();
        return;
    }
    if (access === 'elevate') {
        elevation.offerFor().subscribe(granted => {
            if (granted || elevation.elevated()) {
                send();
            }
        });
    }
}

/**
 * What a section says when its save failed. Settings changed since they were read (412), or read with no version:
 * nothing was saved, and Reload reads them again -- the save is never sent again on its own, and the person's
 * changes in the section are not kept over the newer settings. Anything else: the server's own words.
 */
export function saveFailed(
    err: unknown,
    toast: ToastService,
    errors: ErrorHandlerService,
    reload: () => void,
): void {
    if (!mailboxChangedSinceRead(err)) {
        toast.error(errors.humanize(err));
        return;
    }
    toast.show({
        type: 'error',
        title: 'These settings were changed since they were read',
        message: 'Nothing was saved. Reload reads them again; your changes here are not kept.',
        action: { label: 'Reload', run: reload },
    }, 0);
}
