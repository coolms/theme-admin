import { type Routes, type UrlMatchResult, type UrlSegment } from '@angular/router';

/**
 * Match all three settings shapes as ONE route:
 *
 *   /admin/settings                        every module
 *   /admin/settings/{module}               that module's tree
 *   /admin/settings/{module}/{block}       …with a block open
 *
 * One config, not three `path` entries, and that is the whole trick: Angular
 * re-creates a routed component whenever the matched route CONFIG changes, so
 * separate entries would tear the page down and rebuild it — re-fetching the
 * list, losing the rail's scroll — every time the reader clicked another block.
 * Matched here, walking the tree only changes PARAMS and the page stays put
 * while its content pane swaps.
 */
export function settingsUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {
    if (0 === segments.length) {
        return { consumed: [] };
    }

    if (1 === segments.length) {
        return { consumed: segments, posParams: { module: segments[0] } };
    }

    if (2 === segments.length) {
        return { consumed: segments, posParams: { module: segments[0], block: segments[1] } };
    }

    return null;
}

/**
 * Module-settings admin routes (`/admin/settings`).
 *
 * **The path IS the tree.** Module first, block under it — so a URL says where
 * you are the way the rail does, and a module's own Settings button links at
 * `/admin/settings/{module}` without naming a block it should not have to know
 * about. Platform-wide settings need no special case: they belong to a module
 * like everything else, so they live at `/admin/settings/core`.
 *
 * ROLE_ADMIN server-side: every operation on /api/v1/module-settings is
 * `is_granted('ROLE_ADMIN')`, and the sidebar node carries the same gate, so a
 * non-admin reaching any of these URLs directly gets an error rather than a
 * screen.
 */
export const SETTINGS_ROUTES: Routes = [
    {
        matcher: settingsUrlMatcher,
        loadComponent: () =>
            import('./settings-hub.page').then(m => m.SettingsHubPageComponent),
    },
];
