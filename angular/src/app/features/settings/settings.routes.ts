import { type Route, type Routes, type UrlMatchResult, type UrlSegment } from '@angular/router';
import { unsavedChangesGuard } from '@coolms/ui-angular';

/** Which scope a settings route opens: every module's settings, or one module's. The ROUTE says, never the setting. */
export type SettingsScope = 'global' | 'module';

/**
 * The global scope, as ONE route:
 *
 *   /admin/settings                        every module, the first setting open
 *   /admin/settings/{module}               every module, that module's first setting open
 *   /admin/settings/{module}/{key}         every module, that setting open
 *
 * One config, not three `path` entries: Angular re-creates a routed component whenever the matched route CONFIG
 * changes, so separate entries would tear the page down -- re-fetching the list, losing its scroll -- on every pick.
 * Matched here, picking another setting only changes PARAMS and the page stays put while its pane swaps.
 *
 * `{module}` here names where the setting lives, not a scope: the list stays every module's, whatever is open.
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
 * The module scope, under the module's own path:
 *
 *   /admin/{module}/settings               that module's settings, its first open
 *   /admin/{module}/settings/{key}         ...that setting open
 *
 * Mounted by the shell AHEAD of every module's own routes (app.routes.ts), so a module's catch-all child can never
 * claim `settings`. `/admin/settings/settings` is the global route's, not a module called "settings".
 */
export function moduleSettingsUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {
    if (segments.length < 2 || segments.length > 3 || 'settings' !== segments[1].path || 'settings' === segments[0].path) {
        return null;
    }

    const posParams: Record<string, UrlSegment> = { module: segments[0] };
    if (3 === segments.length) {
        posParams['block'] = segments[2];
    }

    return { consumed: segments, posParams };
}

const loadHub = () => import('./settings-hub.page').then(m => m.SettingsHubPageComponent);

/**
 * Leaving a dirty pane asks: Discard changes, or Keep editing. The guard runs on a PARAM change too (Angular's default
 * `runGuardsAndResolvers`), so picking another setting asks as well as leaving the screen does.
 */
const guards = { canDeactivate: [unsavedChangesGuard] };

/**
 * Module-settings admin routes (`/admin/settings`): the global scope.
 *
 * ROLE_ADMIN server-side for writes; reads need CONFIGURATION_READ. The list holds only what the caller may read,
 * because it is the server's answer to `GET /module-settings`.
 */
export const SETTINGS_ROUTES: Routes = [
    { matcher: settingsUrlMatcher, loadComponent: loadHub, ...guards, data: { settingsScope: 'global' satisfies SettingsScope } },
];

/** `/admin/{module}/settings[/{key}]`: one module's settings, mounted by the shell (see app.routes.ts). */
export const MODULE_SETTINGS_ROUTE: Route = {
    matcher: moduleSettingsUrlMatcher,
    loadComponent: loadHub,
    ...guards,
    data: { settingsScope: 'module' satisfies SettingsScope, activeNav: '/settings' },
};
