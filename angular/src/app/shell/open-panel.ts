import type { ElevationService, NaviAccess } from '@coolms/core-angular';
import { afterElevation } from './after-elevation';

/**
 * Opens or closes a console panel by the navigation rule (2026-10-13, "the header terminal button follows the
 * navigation rule"). The panel's top-bar toggle and its keyboard shortcut both come here, with the access the menu
 * item that opens the panel has ({@link panelAccessIn}):
 * - null: nothing happens; the account has no such item;
 * - 'elevate': elevation is asked for first, unless the panel is already open, since closing needs nothing;
 * - 'allowed': at once.
 * Returns whether the request was the panel's to take, so a keyboard shortcut knows whether to claim the key.
 */
export function togglePanelByRule(
    access: NaviAccess | null,
    isOpen: boolean,
    elevation: ElevationService,
    toggle: () => void,
): boolean {
    if (access === null) {
        return false;
    }
    if (access === 'elevate' && !isOpen) {
        afterElevation(elevation, toggle);
        return true;
    }
    toggle();
    return true;
}
