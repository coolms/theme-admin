import { type Routes } from '@angular/router';
import { authGuard, consoleChildren, loginPageGuard, LoginComponent } from '@coolms/core-angular';
import { AdminLayoutComponent } from './shell/admin-layout.component';
import { CONSOLE_ENTRIES } from './console.registry';

export const routes: Routes = [
    // Redirect authenticated callers away from /login so a stale tab
    // parked here cannot interfere with another tab's active session.
    { path: 'login', component: LoginComponent, canActivate: [loginPageGuard] },
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
