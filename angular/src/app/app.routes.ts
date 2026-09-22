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
            // -- Calendar admin (list + detail with working hours,
            // holiday rules, and year preview).
            {
                path: 'calendars',
                loadChildren: () =>
                    import('./features/calendars/calendars.routes').then(m => m.CALENDAR_ROUTES),
                data: { activeNav: '/calendars' },
            },
            // M7 -- DynamicChat agent inbox: the staff queue of open visitor
            // conversations (left pane) <-> thread + composer (right pane).
            // Joins a conversation, reads history via the generic Chat
            // cursor read, replies via POST /chat/messages, live over
            // chat.room.{id}. Sibling of the leads queue (same lead-source
            // family). Backend shipped in.
            {
                path: 'dynamic-chat',
                loadChildren: () =>
                    import('./features/dynamic-chat/dynamic-chat.routes').then(m => m.DYNAMIC_CHAT_ROUTES),
                data: { activeNav: '/dynamic-chat', fullHeight: true },
            },
            // M7 -- Internal Messages: user<->user DM/chat over the Chat engine.
            // Two-pane conversation list <-> thread; "New" opens a 1:1 via
            // POST /chat/conversations {withUserId}. Backend complete
            // (DM open + rich-text body + attachments); FE shell in.
            {
                path: 'messages',
                loadChildren: () =>
                    import('./features/messages/messages.routes').then(m => m.MESSAGES_ROUTES),
                data: { activeNav: '/messages', fullHeight: true },
            },
            // Email mailbox client: a three-pane reader (mailbox rail /
            // message list / detail + composer) over the read/send/reply/
            // folders/seen APIs (-). Full-height like the Messages
            // two-pane. ROLE_ADMIN server-side on every endpoint.
            {
                path: 'email',
                loadChildren: () =>
                    import('./features/email/email.routes').then(m => m.EMAIL_ROUTES),
                data: { activeNav: '/email', fullHeight: true },
            },
            // Analytics dashboard: the "Top pages" leaderboard over the
            // consent-gated page-view, backed by AnalyticsService.
            {
                path: 'analytics',
                loadChildren: () =>
                    import('./features/analytics/analytics.routes').then(m => m.ANALYTICS_ROUTES),
                data: { activeNav: '/analytics' },
            },
            // Customer Data Platform admin: the
            // audience Segment builder (EL rules, linted live) + the Subject
            // profile explorer, over /analytics/segments + /analytics/subjects.
            // Sibling of the analytics dashboard (same event substrate).
            {
                path: 'cdp',
                loadChildren: () =>
                    import('./features/cdp/cdp.routes').then(m => m.CDP_ROUTES),
                data: { activeNav: '/cdp' },
            },
            {
                path: 'navi',
                loadChildren: () =>
                    import('./features/navi/navi.routes').then(m => m.NAVI_ROUTES),
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
            {
                path: 'vfs',
                loadChildren: () =>
                    import('./features/vfs/vfs.routes').then(m => m.VFS_ROUTES),
                data: { fullHeight: true },
            },
            {
                path: 'media',
                loadComponent: () =>
                    import('./features/media/media-library.page').then(m => m.MediaLibraryPage),
                data: { fullHeight: true },
            },
            {
                path: 'content',
                loadChildren: () =>
                    import('./features/content/content.routes').then(m => m.CONTENT_ROUTES),
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
            {
                path: 'content/document-fonts',
                loadComponent: () =>
                    import('./features/documents/fonts/document-fonts.page')
                        .then(m => m.DocumentFontsPageComponent),
                data: { activeNav: '/admin/content/document-fonts' },
            },
            //-2.6c -- generation list + detail.
            {
                path: 'documents/generations',
                loadComponent: () =>
                    import('./features/documents/generation-list/document-generation-list-page.component')
                        .then(m => m.DocumentGenerationListPageComponent),
                data: { activeNav: '/documents/generations' },
            },
            {
                path: 'documents/generations/:id',
                loadComponent: () =>
                    import('./features/documents/generation-detail/document-generation-detail-page.component')
                        .then(m => m.DocumentGenerationDetailPageComponent),
                data: { activeNav: '/documents/generations' },
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
            // Routing Inspector admin page -- read-only debug tool that
            // traces the SSR pipeline for a (host, path) pair. Backed by
            // GET /api/v1/web/routing/inspect ( Layer 3b, ).
            //
            // reference adopter: page chrome + section ordering
            // come from `config/modules/web/layout/routing-inspector.yaml`,
            // rendered by cms-inspector-layout. The three slot components
            // (RoutingInspectorForm / Outcome / Steps) are registered
            // eagerly in app.config.ts and share state through the
            // route-scoped RoutingInspectorStateService provider below
            // (one fresh instance per navigation to /routing-inspector).
            {
                path: 'routing-inspector',
                loadComponent: () =>
                    import('@coolms/ui-angular')
                        .then(m => m.InspectorLayoutComponent),
                providers: [RoutingInspectorStateService],
                data: {
                    activeNav: '/routing-inspector',
                    layoutId:  'web:routing-inspector',
                },
            },
            // Redirect bare /system to its first meaningful child.
            { path: 'system', redirectTo: 'system/entities', pathMatch: 'full' },
            {
                path: 'system/entities',
                loadComponent: () =>
                    import('./features/schema/domain-explorer.component')
                        .then(m => m.DomainExplorerComponent),
            },
            {
                path: 'dynamic-entities',
                loadComponent: () =>
                    import('./features/schema/dynamic-entities-page.component')
                        .then(m => m.DynamicEntitiesPageComponent),
                data: {
                    breadcrumb: { label: 'Dynamic Entities', routerLink: '/dynamic-entities' },
                    activeNav: '/dynamic-entities',
                },
            },
            { path: 'dynamic-records', redirectTo: 'dynamic-entities', pathMatch: 'full' },
            {
                path: 'profile',
                loadComponent: () =>
                    import('./features/identity/profile-page.component').then(m => m.ProfilePageComponent),
                data: { activeNav: '/profile' },
            },
            { path: 'identity', redirectTo: 'identity/users', pathMatch: 'full' },
            {
                path: 'identity/users',
                loadComponent: () =>
                    import('./features/identity/users-list.component').then(m => m.UsersListComponent),
                data: { activeNav: '/identity/users', fullHeight: true },
            },
            {
                path: 'identity/groups',
                loadComponent: () =>
                    import('./features/identity/groups-list.component').then(m => m.GroupsListComponent),
                data: { activeNav: '/identity/groups', fullHeight: true },
            },
            {
                path: 'identity/deletions',
                loadComponent: () =>
                    import('./features/identity/deletions-list.component').then(m => m.DeletionsListComponent),
                data: { activeNav: '/identity/deletions', fullHeight: true },
            },
            // Protected by the parent canActivate: [authGuard] above.
            // DynamicRecordListComponent fires forkJoin(schema + records) in
            // ngOnInit -- both requests carry the token restored by RestoreSession
            // before load() completed, so no 401 on F5 for non-expired tokens.
            // Expired-token 401s are handled transparently by the auth interceptor.
            {
                path: 'dynamic-records/:typeAlias',
                loadComponent: () =>
                    import('@coolms/ui-angular')
                        .then(m => m.DynamicRecordPageComponent),
                data: {
                    // Highlights "Domain Explorer" in the sidebar while browsing
                    // dynamic-record lists (they are configured there).
                    activeNav: '/system/entities',
                    // Variant B breadcrumb: injects a labelled intermediate crumb
                    // between "Home" and the current entity-type name.
                    // AdminTopbarComponent reads this to build the crumb chain.
                    breadcrumb: { label: 'Dynamic Records', routerLink: '/system/entities' },
                },
            },
            // The modules' mounts, from their console entries (console@1): one
            // child per mount, lazy, activated by the manifest. Everything
            // above this line is the shell's own or not yet moved.
            ...consoleChildren(CONSOLE_ENTRIES),
        ],
    },
    { path: '**', redirectTo: '' },
];
