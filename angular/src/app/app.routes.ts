import { type Routes } from '@angular/router';
import { authGuard, consoleChildren, loginPageGuard, LoginComponent } from '@coolms/core-angular';
import { AdminLayoutComponent } from './shell/admin-layout.component';
import { RoutingInspectorStateService } from './features/routing-inspector/routing-inspector-state.service';
import { CONSOLE_ENTRIES } from './console.registry';

export const routes: Routes = [
    // Redirect authenticated callers away from /login so a stale tab
    // parked here cannot interfere with another tab's active session.
    { path: 'login', component: LoginComponent, canActivate: [loginPageGuard] },
    // Sub-prompt B2 smoke route -- public so we can exercise the bridge
    // without booting an auth context. Removed in B3 once page-editor
    // adopts the bridge.
    {
        path: 'editor-test',
        loadComponent: () =>
            import('./features/editor-smoke/editor-smoke.component')
                .then(m => m.EditorSmokeComponent),
    },
    {
        // canActivate: [authGuard] protects this route AND every child below.
        // authGuard waits for AppInitService.ready$ before evaluating
        // isAuthenticated, so tokens are always restored before any child
        // component mounts and fires its first HTTP request.
        path: '',
        component: AdminLayoutComponent,
        canActivate: [authGuard],
        children: [
            // `/admin` lands on the dashboard now, which is what it was asked
            // for. It redirected to `sections` only because there was
            // no dashboard to land on.
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            {
                path: 'dashboard',
                loadComponent: () =>
                    import('./features/dashboard/dashboard.page').then(m => m.DashboardPageComponent),
                data: { activeNav: '/dashboard' },
            },
            // Unified Definitions admin (catalog of every deployed +
            // draft definition across Workflow, Decision, future Form).
            // Read-only surface; drill-down lands on per-module Designer
            // routes. Backed by /api/v1/definitions and the tagged
            // DefinitionCatalogProviderInterface registry.
            {
                path: 'definitions',
                loadChildren: () =>
                    import('./features/definitions/definitions.routes').then(m => m.DEFINITION_ROUTES),
                data: { activeNav: '/definitions' },
            },
            //.3 -- Form Builder admin: list of every registered form
            // (GET /forms) + a builder over <app-ordered-builder>. Authoring a
            // shipped form mints a DB override.2 chained writer);
            // user-created forms land file-when-writable else DB. Closes the
            // workflow loop -- a non-developer can define the form a User Task
            // renders.
            {
                path: 'forms',
                loadChildren: () =>
                    import('./features/forms/forms.routes').then(m => m.FORM_ROUTES),
                data: { activeNav: '/forms' },
            },
            // ImageMap admin (-backend): list + modal create/edit of
            // spatial maps (floor plans / seat maps). Region authoring comes
            // later (Fabric.js surface over the Image Editor).
            {
                path: 'image-maps',
                loadChildren: () =>
                    import('./features/image-maps/image-maps.routes').then(m => m.IMAGE_MAP_ROUTES),
                data: { activeNav: '/image-maps' },
            },
            // Translations admin: list of (domain, locale) catalogues
            // plus per-catalogue editor. Backend ships at
            // /api/v1/i18n/catalogues. VFS overrides flow through
            // VfsOverlayingTranslator so saves take effect on next
            // request without restart.
            {
                path: 'i18n/translations',
                loadChildren: () =>
                    import('./features/translations/translations.routes').then(m => m.TRANSLATION_ROUTES),
                data: { activeNav: '/i18n/translations' },
            },
            // -- LCAP/BPM designer feature. Vertical-slice scope: only
            // the DMN decision-table editor (`/admin/designer/dmn/:key`) is
            // wired today; BPMN-Lite () and state-machine () add
            // sibling sub-routes inside `designer.routes.ts`. The lazy load
            // shape mirrors every other feature module.
            {
                path: 'designer',
                loadChildren: () =>
                    import('./features/designer/designer.routes').then(m => m.DESIGNER_ROUTES),
                data: { activeNav: '/designer', fullHeight: true },
            },
            // Sub-prompt B2 smoke route -- exercises the @coolms/editor-angular
            // bridge end-to-end. Removed after page-editor adopts the bridge
            // (sub-prompt B3) or kept as a dev tool -- Dmitry decides.
            {
                path: 'editor-test',
                loadComponent: () =>
                    import('./features/editor-smoke/editor-smoke.component')
                        .then(m => m.EditorSmokeComponent),
            },
            // The admin UI kit, rendered from itself. The kit was real but
            // invisible -- ~50 `--cms-*` tokens and 47 `.cms-*` classes in one
            // stylesheet, readable only by opening it. The SSR half of "a base
            // theme others extend" already exists (`coolms-bootstrap`, which
            // `coolms-default` and `coolms-site` both extend); the Angular half
            // had no equivalent and no surface to see it on. Tokens are read
            // from the live CSSOM rather than restated, so the page cannot
            // drift from the stylesheet. No backend: it renders the classes the
            // app itself uses.
            {
                path: 'ui-kit',
                loadComponent: () =>
                    import('./features/ui-kit/ui-kit-page.component')
                        .then(m => m.UiKitPageComponent),
                data: { activeNav: '/ui-kit' },
            },
            // The modules' mounts, from their console entries (console@1): one
            // child per mount, lazy, activated by the manifest. Everything
            // above this line is the shell's own or not yet moved.
            ...consoleChildren(CONSOLE_ENTRIES),
        ],
    },
    { path: '**', redirectTo: '' },
];
