import { type Routes } from '@angular/router';
import { authGuard, loginPageGuard, LoginComponent } from '@coolms/core-angular';
import { AdminLayoutComponent } from './shell/admin-layout.component';
import { RoutingInspectorStateService } from './features/routing-inspector/routing-inspector-state.service';

export const routes: Routes = [
    // Redirect authenticated callers away from /login so a stale tab
    // parked here cannot interfere with another tab's active session.
    { path: 'login', component: LoginComponent, canActivate: [loginPageGuard] },
    // Sub-prompt B2 smoke route — public so we can exercise the bridge
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
            {
                path: 'sections',
                loadChildren: () =>
                    import('./features/sections/sections.routes').then(m => m.SECTION_ROUTES),
            },
            // — Calendar admin (list + detail with working hours,
            // holiday rules, and year preview).
            {
                path: 'calendars',
                loadChildren: () =>
                    import('./features/calendars/calendars.routes').then(m => m.CALENDAR_ROUTES),
                data: { activeNav: '/calendars' },
            },
            // — Scheduler admin (list + detail with cron/RRule editor,
            // calendar attachment, payload editor, trigger-now CTA).
            {
                path: 'schedules',
                loadChildren: () =>
                    import('./features/schedules/schedules.routes').then(m => m.SCHEDULE_ROUTES),
                data: { activeNav: '/schedules' },
            },
            // Call history admin (read-only list over the AMI-tracked
            // CallRecord read API; detail + recording player + live card follow).
            {
                path: 'call/records',
                loadChildren: () =>
                    import('./features/call/call.routes').then(m => m.CALL_ROUTES),
                data: { activeNav: '/call/records' },
            },
            // Live-call wallboard (realtime over the calls.broadcast channel)
            {
                path: 'call/wallboard',
                loadComponent: () =>
                    import('./features/call/call-wallboard.page').then(m => m.CallWallboardComponent),
                data: { activeNav: '/call/wallboard' },
            },
            // Inbox: 3-tab user-task queue (My / Claimable / Recent)
            // for workflow user tasks. URL-driven tabs via ?tab=...
            // Realtime updates via the inbox.{userId} channel.
            {
                path: 'inbox',
                loadChildren: () =>
                    import('./features/inbox/inbox.routes').then(m => m.INBOX_ROUTES),
                data: { activeNav: '/inbox' },
            },
            // Process Cockpit: operator read-only view over the
            // Workflow engine state (running/finished process instances).
            {
                path: 'cockpit',
                loadChildren: () =>
                    import('./features/cockpit/cockpit.routes').then(m => m.COCKPIT_ROUTES),
                data: { activeNav: '/cockpit' },
            },
            // W7.d — Comment moderation: the pending-comment queue
            // (approve / reject), backed by the W7.a CommentService.
            {
                path: 'moderation',
                loadChildren: () =>
                    import('./features/moderation/moderation.routes').then(m => m.MODERATION_ROUTES),
                data: { activeNav: '/moderation' },
            },
            // W8.c — Lead inbox: the lead triage queue (New / Handled / Spam),
            // backed by the W8.a LeadsService. Sibling of the moderation queue.
            {
                path: 'leads',
                loadChildren: () =>
                    import('./features/leads/leads.routes').then(m => m.LEADS_ROUTES),
                data: { activeNav: '/leads' },
            },
            // C.3 — Contacts: the generic Person directory / address
            // book (/admin/contacts). cms-list-page + coolms-datagrid (client
            // mode) + a create/edit modal, over the C.2 /contacts CRUD API.
            {
                path: 'contacts',
                loadChildren: () =>
                    import('./features/contacts/contacts.routes').then(m => m.CONTACTS_ROUTES),
                data: { activeNav: '/contacts' },
            },
            // M7 — DynamicChat agent inbox: the staff queue of open visitor
            // conversations (left pane) ↔ thread + composer (right pane).
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
            // M7 — Internal Messages: user↔user DM/chat over the Chat engine.
            // Two-pane conversation list ↔ thread; "New" opens a 1:1 via
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
            // folders/seen APIs (–). Full-height like the Messages
            // two-pane. ROLE_ADMIN server-side on every endpoint.
            {
                path: 'email',
                loadChildren: () =>
                    import('./features/email/email.routes').then(m => m.EMAIL_ROUTES),
                data: { activeNav: '/email', fullHeight: true },
            },
            // W8 — Newsletter: confirmed-subscriber list + campaign compose,
            // backed by the NewsletterService. Sibling of the leads queue.
            {
                path: 'newsletter',
                loadChildren: () =>
                    import('./features/newsletter/newsletter.routes').then(m => m.NEWSLETTER_ROUTES),
                data: { activeNav: '/newsletter' },
            },
            // W8 — Analytics dashboard: the "Top pages" leaderboard over the
            // consent-gated page-view, backed by AnalyticsService.
            {
                path: 'analytics',
                loadChildren: () =>
                    import('./features/analytics/analytics.routes').then(m => m.ANALYTICS_ROUTES),
                data: { activeNav: '/analytics' },
            },
            //Phase 3 (CDP core) — Customer Data Platform admin: the
            // audience Segment builder (EL rules, linted live) + the Subject
            // profile explorer, over /analytics/segments + /analytics/subjects.
            // Sibling of the analytics dashboard (same event substrate).
            {
                path: 'cdp',
                loadChildren: () =>
                    import('./features/cdp/cdp.routes').then(m => m.CDP_ROUTES),
                data: { activeNav: '/cdp' },
            },
            // W8 — Experiments: the A/B experiment list + per-variant results
            // surface with Start/Stop controls, backed by
            // ExperimentsService. Sibling of the analytics dashboard.
            {
                path: 'experiments',
                loadChildren: () =>
                    import('./features/experiments/experiments.routes').then(m => m.EXPERIMENT_ROUTES),
                data: { activeNav: '/experiments' },
            },
            // Themes Explorer — which theme skins each site and what it
            // overrides. The Theme endpoints predated any admin UI, so the only
            // way to see or change the active theme was the DB or the CLI.
            {
                path: 'themes',
                loadChildren: () =>
                    import('./features/themes/themes.routes').then(m => m.THEME_ROUTES),
                data: { activeNav: '/themes' },
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
            // Connector admin: inbound webhook triggers CRUD
            // (/admin/webhooks), backed by /api/v1/connector/webhooks.
            {
                path: 'webhooks',
                loadChildren: () =>
                    import('./features/connector/connector.routes').then(m => m.CONNECTOR_ROUTES),
                data: { activeNav: '/webhooks' },
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
            // F5.d -- Translations admin: list of (domain, locale) catalogues
            // plus per-catalogue editor. Backend ships at
            // /api/v1/i18n/catalogues (F5.c). VFS overrides flow through
            // VfsOverlayingTranslator (F5.b) so saves take effect on next
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
            // follow-up — Categories admin: manage the `categories`
            // taxonomy tree (add / rename / move / delete), backed by the
            // Taxonomy REST API. Sits in the Content sidebar section.
            {
                path: 'taxonomy/categories',
                loadComponent: () =>
                    import('./features/taxonomy/categories-page.component')
                        .then(m => m.CategoriesPageComponent),
                data: { activeNav: '/taxonomy/categories' },
            },
            // Sub-prompt B2 smoke route — exercises the @coolms/editor-angular
            // bridge end-to-end. Removed after page-editor adopts the bridge
            // (sub-prompt B3) or kept as a dev tool — Dmitry decides.
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
            // Phase 1.5 sub-phase 1.5b -- Centrifugo admin
            // dashboard. Three pages: list (info / namespaces / channels),
            // per-channel detail, debug publish. ROLE_ADMIN is enforced
            // server-side by API Platform `security:` expressions on
            // every `/api/v1/centrifugo/admin/*` endpoint -- a
            // non-admin who navigates here sees per-panel error banners
            // rather than a hard route-level redirect.
            //
            // Routes are relative to the SPA's `/admin/` base-href, so
            // the on-screen URL is `/admin/centrifugo` even though the
            // path tokens here omit that prefix.
            {
                path: 'centrifugo',
                loadComponent: () =>
                    import('./features/centrifugo/centrifugo-dashboard.component')
                        .then(m => m.CentrifugoDashboardComponent),
                data: { activeNav: '/centrifugo' },
            },
            // — MCP tool-governance audit. Read-only operator view
            // over GET /api/mcp/tools (ROLE_ADMIN, McpToolCatalogController):
            // the full inventory of tools external AI agents can invoke via
            // POST /api/mcp/rpc plus the authorization gate on each. Sits in
            // the /admin/--system section beside the Centrifugo dashboard --
            // both are platform-plumbing operator surfaces. The endpoint is
            // ROLE_ADMIN server-side, so a non-admin sees an error banner.
            {
                path: 'mcp/tools',
                loadComponent: () =>
                    import('./features/mcp/mcp-tools-page.component')
                        .then(m => m.McpToolsPageComponent),
                data: { activeNav: '/mcp/tools' },
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
            // Module settings (ROLE_ADMIN). The hub lists every settings block an
            // installed module DECLARED — it is generated from the contributor
            // registry, not a list maintained here, so an uninstalled module
            // simply has no row. Sits in the /admin/--system section. Every
            // /api/v1/module-settings operation is is_granted('ROLE_ADMIN'), so a
            // non-admin reaching these URLs directly sees an error, not a screen.
            {
                path: 'settings',
                loadChildren: () =>
                    import('./features/settings/settings.routes').then(m => m.SETTINGS_ROUTES),
                data: { activeNav: '/settings' },
            },
            // — Backup admin page. List on-disk backup bundles,
            // create a new one, and DRY-RUN a restore preview. Sits in the
            // /admin/--system ops section. The three /api/v1/backup*
            // endpoints are gated server-side by the root:backup 0o770 VFS node
            // (backup-group members only), so a non-member sees error banners.
            {
                path: 'backups',
                loadComponent: () =>
                    import('./features/backups/backups-list.page')
                        .then(m => m.BackupsListPageComponent),
                data: { activeNav: '/backups' },
            },
            // B.3.2 — Sync fleet admin page. Register/edit/remove edge
            // nodes, see health/cursor/principal/scope, trigger a fleet nudge.
            // Gated server-side by the NESTED root:sync_fleet 0o770 VFS node
            // (a different group from the machine-facing sync node, so an edge
            // service credential can never manage the fleet).
            {
                path: 'sync-fleet',
                loadComponent: () =>
                    import('./features/sync/sync-fleet-list.page')
                        .then(m => m.SyncFleetListPageComponent),
                data: { activeNav: '/sync-fleet' },
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
            {
                path: 'centrifugo/channel/:name',
                loadComponent: () =>
                    import('./features/centrifugo/centrifugo-channel-detail.component')
                        .then(m => m.CentrifugoChannelDetailComponent),
                data: { activeNav: '/centrifugo' },
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
            // Protected by the parent canActivate: [authGuard] above.
            // DynamicRecordListComponent fires forkJoin(schema + records) in
            // ngOnInit — both requests carry the token restored by RestoreSession
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
        ],
    },
    { path: '**', redirectTo: '' },
];
