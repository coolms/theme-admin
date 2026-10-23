import { type Provider } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';

/**
 * Overlays stack by z-index, in the page, not in the browser's top layer.
 *
 * ⚠️ THE CDK'S DEFAULT CHANGED UNDER US. From @angular/cdk 22 an overlay -- every CDK dialog -- is opened as a
 * `popover="manual"` element, which the browser puts in the TOP LAYER, above anything a z-index can say. Measured on
 * the served admin (2026-10-20): with the Edit Node dialog open, the "needs an elevated session" toast and its
 * Elevate button rendered UNDER the dialog's backdrop. The only way to reach the button was to close the dialog --
 * and with it the edit -- and click before the toast went. The same holds for everything this admin layers with
 * z-index above dialogs: the toasts (2000), the context menu (9999), the call overlays (2100).
 *
 * Turning the popover default off puts overlays back into `.cdk-overlay-container` (z-index 1000), where the layers
 * above it are ordered by z-index as they were designed. A dialog opened from inside another (the elevation prompt
 * over Edit Node) still opens above it: the later pane is appended last in the same container.
 */
export function provideOverlayStacking(): Provider[] {
    return [{ provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } }];
}
