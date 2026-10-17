import { type ElevationService, type ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, type ToastService } from '@coolms/ui-angular';

import { mailboxChangedSinceRead } from './email.service';

/**
 * Runs `send` as the server's answer for the section's action allows: at once when `allowed`; when `elevate`, after
 * the one shared elevation prompt grants the session (declined or failed: nothing is sent). `denied` sends nothing --
 * a section the caller may only read offers no save.
 */
export function afterAccess(access: CapabilityState, elevation: ElevationService, send: () => void): void {
    if (access === 'denied') {
        return;
    }
    if (access === 'allowed' || elevation.elevated()) {
        send();
        return;
    }
    elevation.offerFor().subscribe(granted => {
        if (granted || elevation.elevated()) {
            send();
        }
    });
}

/**
 * A section's draft after a new read of the mailbox -- another section's save answers one, and so does this section's
 * own: a field the person did not touch since the previous read follows the new one, and a field they changed keeps
 * what they typed. So one section's save never discards what is being typed in another. (A section's own saved
 * fields equal the new read, so its draft is clean again.) Reload is the one thing that starts every section over.
 */
export function rebaseDraft<T extends object>(previous: T, draft: T, next: T): T {
    const out = { ...next };
    for (const key of Object.keys(draft) as (keyof T)[]) {
        if (draft[key] !== previous[key]) {
            out[key] = draft[key];
        }
    }
    return out;
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
