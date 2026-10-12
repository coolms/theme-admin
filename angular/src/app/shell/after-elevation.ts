import { type ElevationService } from '@coolms/core-angular';

/**
 * What a LOCKED control does when it is used (a section or a top-bar tile the server answered 'elevate' for this
 * member of admin, 2026-10-12): it asks for elevation through the one shared prompt, and does its own thing
 * only once the session is elevated. Declined or failed: nothing happens. Already elevated meanwhile (another tab
 * granted it before this control's lock was refreshed): it simply goes on.
 */
export function afterElevation(elevation: ElevationService, then: () => void): void {
    elevation.offerFor().subscribe(granted => {
        if (granted || elevation.elevated()) {
            then();
        }
    });
}
