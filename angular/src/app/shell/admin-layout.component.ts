import { Component, computed, DestroyRef, HostListener, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass, NgComponentOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, NaviGraphService, NaviGraphNode, UserPreferencesService, ThemeService, SidebarStateService } from '@coolms/core-angular';
import {
    BottomDrawerService,
    ContextMenuComponent,
    ContextMenuService,
    DrawerService,
    ToastOutletComponent,
} from '@coolms/ui-angular';
import { AdminTopbarComponent } from './admin-topbar.component';
import { TerminalPanelComponent } from '../features/terminal/terminal-panel.component';
import { RtcCallOverlayComponent } from '../features/rtc/rtc-call-overlay.component';
import { CallScreenpopOverlayComponent } from '../features/call/call-screenpop-overlay.component';
import { SidebarNavItemComponent } from './sidebar-nav-item.component';

/**
 * Root admin shell — three-zone layout: topbar / sidebar / main / right drawer.
 * Terminal panel slides in from the bottom on demand (Ctrl+` or >_ button).
 *
 * Sidebar navigation is fully driven by the navi.admin NaviGraph tree.
 * Drawer content is controlled by DrawerService — any component can open it.
 *
 * NOTE: Intentionally uses Default CD (no OnPush).
 * Routed child components use store.select().subscribe() with plain property
 * assignment — they rely on zone-triggered top-down CD traversal. An OnPush
 * shell would block that traversal when not dirty, freezing the main area.
 */
@Component({
    selector: 'coolms-admin-layout',
    standalone: true,
    imports: [RouterOutlet, NgClass, NgComponentOutlet, AdminTopbarComponent, TerminalPanelComponent, ToastOutletComponent, ContextMenuComponent, SidebarNavItemComponent, RtcCallOverlayComponent, CallScreenpopOverlayComponent],
    styles: [`
        .coolms-admin-shell {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .coolms-topbar {
            height: 56px;
            flex-shrink: 0;
            background: var(--cms-sidebar-bg);
            /*
             * ⚠️ The bar painted its background dark and never said what
             * colour text is, so it inherited --cms-text -- near-black -- from
             * body. 21 children overrode it to white and 19 inherited the
             * near-black; the site selector uses color: inherit and came out
             * at ~1.1:1. The bar is always dark in both themes, so its ink is
             * the sidebar's, not the page's.
             */
            color: var(--cms-sidebar-text);
            border-bottom: 1px solid rgba(255,255,255,.08);
            z-index: 100;
        }
        .coolms-body {
            display: flex;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        /* Collapse the body area so the terminal panel can fill everything. */
        .coolms-body.terminal-maximized {
            flex: 0;
            min-height: 0;
            overflow: hidden;
        }
        .coolms-sidebar {
            width: 240px;
            flex-shrink: 0;
            background: var(--cms-sidebar-bg);
            overflow-y: auto;
            overflow-x: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 8px rgba(0,0,0,.25);
            transition: width 180ms ease;
        }
        /* Hide the scrollbar on the sidebar (both the outer container
           and the inner __nav, whichever ends up being the scroll
           ancestor at runtime) while keeping wheel / touch scroll
           working. Looks cluttered against the dark sidebar background
           and the user can still scroll naturally. */
        .coolms-sidebar,
        .coolms-sidebar__nav {
            scrollbar-width: none;       /* Firefox */
            -ms-overflow-style: none;    /* IE / legacy Edge */
        }
        .coolms-sidebar::-webkit-scrollbar,
        .coolms-sidebar__nav::-webkit-scrollbar {
            display: none;               /* Chrome / Safari / modern Edge */
        }
        /* Collapsed: icon-only rail. Width fits a 16px icon + 20px
           horizontal padding on each side comfortably. Labels and
           section captions hide; the active-item left bar stays visible
           via the existing :is(.cms-nav-item.active) box-shadow rule. */
        .coolms-sidebar--collapsed {
            width: 56px;
        }
        .coolms-sidebar--collapsed .cms-nav-item__label,
        .coolms-sidebar--collapsed .cms-nav-separator-label {
            display: none;
        }
        /* Centre the icon when there's no label next to it. */
        .coolms-sidebar--collapsed .cms-nav-item {
            justify-content: center;
            padding-left: 0;
            padding-right: 0;
        }
        /* Separator becomes a slim divider line when collapsed; no
           label text to anchor it. */
        .coolms-sidebar--collapsed .cms-nav-separator {
            padding: 8px 12px;
        }
        .coolms-sidebar--collapsed .cms-nav-separator::after {
            content: '';
            display: block;
            height: 1px;
            background: rgba(255,255,255,.08);
            width: 100%;
        }
        /* Collapse-toggle button inside each section header. The
           caption text stays styled by the existing
           .cms-nav-separator-label rule in styles.scss; this rule
           handles the wrapping button + the chevron alignment. */
        .cms-nav-separator__toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 0;
            border: 0;
            background: transparent;
            cursor: pointer;
            color: inherit;
            text-align: left;
        }
        .cms-nav-separator__toggle:hover .cms-nav-separator-label,
        .cms-nav-separator__toggle:hover .cms-nav-separator__chevron {
            color: var(--cms-sidebar-text);
        }
        .cms-nav-separator__chevron {
            font-size: .65rem;
            color: var(--cms-sidebar-text-muted);
            transition: color 120ms ease;
        }
        /* Hide the chevron entirely when the sidebar is in icon-only
           mode -- the caption is hidden by the existing rule, so the
           chevron alone would look orphaned. */
        .coolms-sidebar--collapsed .cms-nav-separator__chevron {
            display: none;
        }
        /* And the button stops being interactive when there's nothing
           visible to interact with. */
        .coolms-sidebar--collapsed .cms-nav-separator__toggle {
            pointer-events: none;
        }

        /* The toggle button pins to the bottom of the sidebar via
           margin-top: auto on its container. Sits flush with the
           bottom edge and aligns its chevron to the right-hand side so
           when collapsed it visually points "the way to expand". */
        .coolms-sidebar__nav {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            /* Bootstrap's .nav class defaults to "flex-wrap: wrap",
               so when the sidebar's vertical space shrinks (e.g. the
               bottom terminal opens), items that don't fit wrap into
               a second column instead of overflowing into a scroll.
               Force single-column so overflow-y handles it. */
            flex-wrap: nowrap;
        }
        .coolms-sidebar__toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 8px 16px;
            border: 0;
            background: transparent;
            color: var(--cms-sidebar-text-muted);
            border-top: 1px solid rgba(255,255,255,.06);
            cursor: pointer;
            font-size: 1rem;
            transition: color 120ms ease, background 120ms ease;
        }
        .coolms-sidebar__toggle:hover {
            color: var(--cms-text-inverse);
            background: var(--cms-sidebar-hover);
        }
        .coolms-sidebar--collapsed .coolms-sidebar__toggle {
            justify-content: center;
            padding-left: 0;
            padding-right: 0;
        }
        .coolms-main {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            /* AUTO, not hidden (#2072). Pages that manage their own inner
               scroller — the explorers, the editors — bound themselves to this
               box and never overflow it, so they see no change: auto only
               produces a scrollbar when there is something to scroll. A page
               that is simply LONG had nowhere to go: the UI Kit measured
               4,168px of content inside an 804px box, clipped with no way to
               reach the rest.
               The horizontal axis stays hidden so a stray wide child still
               cannot shove the whole shell sideways. */
            overflow-y: auto;
            overflow-x: hidden;
            padding: var(--cms-content-padding, 20px);
            background: var(--cms-bg);
        }
        .coolms-drawer {
            width: 0;
            flex-shrink: 0;
            overflow: hidden;
            transition: width 200ms ease;
            background: var(--cms-surface);
            border-left: 1px solid var(--cms-border);
        }
        .coolms-drawer.open {
            width: 320px;
        }

        .coolms-bottom-drawer {
            flex-shrink: 0;
            background: var(--cms-surface);
            border-top: 1px solid var(--cms-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: height 200ms ease;
        }

        .bd-resize-handle {
            height: 5px;
            flex-shrink: 0;
            cursor: ns-resize;
            background: transparent;
        }
        .bd-resize-handle:hover { background: var(--cms-info); opacity: .5; }

        .bd-header {
            display: flex;
            align-items: center;
            padding: 4px 12px;
            border-bottom: 1px solid var(--cms-border-light);
            background: var(--cms-bg);
            flex-shrink: 0;
            gap: 8px;
        }

        .bd-title {
            flex: 1;
            font-size: .78rem;
            font-weight: 600;
            color: var(--cms-text-muted);
            text-transform: uppercase;
            letter-spacing: .04em;
        }

        .bd-close {
            width: 22px; height: 22px;
            border: none; background: transparent;
            color: var(--cms-text-muted); cursor: pointer;
            border-radius: var(--cms-radius-sm, 4px);
            display: flex; align-items: center; justify-content: center;
            font-size: .75rem; padding: 0;
            transition: background .1s, color .1s;
        }
        .bd-close:hover { background: var(--cms-border-light); color: var(--cms-text); }

        .bd-body {
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
    `],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
        <div class="coolms-admin-shell">

            <header class="coolms-topbar">
                <app-admin-topbar (terminalToggle)="toggleTerminal()" />
            </header>

            <!-- Body: sidebar + main — collapses when terminal is maximized -->
            <div class="coolms-body" [class.terminal-maximized]="terminalMaximized()">

                <!-- Sidebar -->
                <nav class="coolms-sidebar"
                     [class.coolms-sidebar--collapsed]="sidebarState.collapsed()">
                    <ul class="coolms-sidebar__nav nav flex-column gap-1 px-2 py-3">
                        @for (section of sections(); track section.id) {
                            @if (section.caption) {
                                <li class="cms-nav-separator">
                                    <button type="button"
                                            class="cms-nav-separator__toggle"
                                            [title]="sidebarState.collapsed() ? section.caption : null"
                                            (click)="sidebarState.toggleSection(section.id)">
                                        <span class="cms-nav-separator-label">{{ section.caption }}</span>
                                        <i class="bi cms-nav-separator__chevron"
                                           [ngClass]="sidebarState.isSectionCollapsed(section.id) ? 'bi-chevron-right' : 'bi-chevron-down'"></i>
                                    </button>
                                </li>
                            }
                            @if (showSectionItems(section.id)) {
                                @for (node of section.items; track node.id) {
                                    <cms-sidebar-nav-item
                                        [node]="node"
                                        [depth]="0"
                                        [collapsed]="sidebarState.collapsed()"
                                        [activeOverride]="activeNavOverride()"
                                        (specialClick)="handleSpecialNav($event)" />
                                }
                            }
                        }
                    </ul>
                    <!-- Collapse toggle pinned to the bottom of the
                         sidebar via margin-top: auto in the rule above.
                         The chevron rotates to indicate the action that
                         the next click will perform. -->
                    <button type="button"
                            class="coolms-sidebar__toggle"
                            [title]="sidebarState.collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
                            (click)="sidebarState.toggle()">
                        <i class="bi"
                           [ngClass]="sidebarState.collapsed() ? 'bi-chevron-double-right' : 'bi-chevron-double-left'"></i>
                    </button>
                </nav>

                <!-- Main content -->
                <main class="coolms-main">
                    <router-outlet />
                </main>

                <!-- Right drawer -->
                <aside class="coolms-drawer" [class.open]="drawerService.isOpen()">
                    @if (drawerService.component()) {
                        <div class="d-flex flex-column h-100">
                            <div class="d-flex align-items-center justify-content-between p-3 border-bottom">
                                <span class="fw-semibold small text-muted">{{ drawerService.title() || 'Panel' }}</span>
                                <button class="btn-close btn-sm"
                                        (click)="drawerService.close()"></button>
                            </div>
                            <div class="flex-grow-1 overflow-y-auto p-3">
                                <ng-container *ngComponentOutlet="drawerService.component();
                                    inputs: drawerService.inputs()" />
                            </div>
                        </div>
                    }
                </aside>
            </div>

            <!-- Terminal panel — self-manages its own height/flex via host bindings -->
            @if (terminalVisible()) {
                <app-terminal-panel
                    (maximizedChange)="terminalMaximized.set($event)"
                    (close)="closeTerminal()" />
            }

            <!-- Bottom drawer — resizable editor panel -->
            @if (bottomDrawer.isOpen() && bottomDrawer.component()) {
                <div class="coolms-bottom-drawer" [style.height.px]="bottomDrawer.height()">
                    <div class="bd-resize-handle" (mousedown)="onBdResizeStart($event)"></div>
                    <div class="bd-header">
                        <span class="bd-title">Editor</span>
                        <button class="bd-close" (click)="bottomDrawer.close()" title="Close">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                    <div class="bd-body">
                        <ng-container *ngComponentOutlet="bottomDrawer.component();
                            inputs: bottomDrawer.inputs()" />
                    </div>
                </div>
            }

        </div>

        <!-- Global toast notifications — rendered outside the body flex so they always float above -->
        <app-toast-outlet />

        <!-- Global context menu — rendered last so it always floats above toast and drawers -->
        <coolms-context-menu />

        <!-- Global WebRTC call overlay (Track B) — incoming ring + in-call bar, above every route -->
        <app-rtc-call-overlay />

        <!-- Global telephony (PBX) incoming-call screen-pop (M9.g) — a non-intrusive
             card as calls ring/answer/end, driven by the calls.broadcast firehose -->
        <app-call-screenpop-overlay />
    `,
})
export class AdminLayoutComponent implements OnInit {
    readonly naviGraph     = inject(NaviGraphService);
    readonly drawerService = inject(DrawerService);
    readonly bottomDrawer  = inject(BottomDrawerService);
    readonly sidebarState  = inject(SidebarStateService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly prefs      = inject(UserPreferencesService);
    private readonly theme      = inject(ThemeService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly ctxMenuSvc = inject(ContextMenuService);

    terminalVisible   = signal(false);
    terminalMaximized = signal(false);

    private bdResizing = false;
    private bdStartY   = 0;
    private bdStartH   = 0;
    /**
     * When a child route declares `data.activeNav = '/some/path'`, that path
     * is stored here so the sidebar can highlight the correct item even when
     * the current URL doesn't match directly.
     */
    activeNavOverride = signal<string | null>(null);

    /**
     * Sidebar nodes grouped by meta.section.
     *
     * Each non-separator node declares which section it belongs to via
     * meta.section (the path of its separator node). The sidebar renders
     * separator headers and their items grouped together, regardless of
     * sortOrder. Empty sections (no visible items) are hidden automatically.
     *
     * Nodes without a section are appended at the end in sortOrder.
     */
    readonly filteredAdminNav = computed(() => {
        const all = this.naviGraph.adminNav().filter(n => n.isVisible);

        // Index separators by path
        const separators = new Map<string, NaviGraphNode>();
        for (const node of all) {
            if ((node.meta?.['type'] as string) === 'separator') {
                separators.set(node.path, node);
            }
        }

        // Group non-separator nodes by their meta.section
        const grouped = new Map<string, NaviGraphNode[]>();
        const unsectioned: NaviGraphNode[] = [];
        for (const node of all) {
            if ((node.meta?.['type'] as string) === 'separator') continue;
            const section = node.meta?.['section'] as string | undefined;
            if (section && separators.has(section)) {
                if (!grouped.has(section)) grouped.set(section, []);
                grouped.get(section)!.push(node);
            } else {
                unsectioned.push(node);
            }
        }

        // Build output: separators (sorted by sortOrder) + their items (sorted by sortOrder); skip empty sections
        const result: NaviGraphNode[] = [];
        const sortedSeps = [...separators.values()].sort((a, b) => a.sortOrder - b.sortOrder);
        for (const sep of sortedSeps) {
            const items = (grouped.get(sep.path) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
            if (items.length === 0) continue;
            result.push(sep);
            result.push(...items);
        }
        result.push(...unsectioned.sort((a, b) => a.sortOrder - b.sortOrder));
        return result;
    });

    /**
     * Partition the flat sidebar nav into sections for collapse/expand
     * rendering. Walks the result of filteredAdminNav() and buckets
     * non-separator items under the most recent separator. Items that
     * appear before any separator land in a synthetic ungrouped bucket
     * (always visible -- no header to click).
     *
     * Section id is the separator's path (e.g. `/struc`, `/iden`),
     * which is stable across NaviGraph re-seeds. The persisted
     * collapsed state in SidebarStateService keys off this id.
     */
    readonly sections = computed(() => {
        const flat = this.filteredAdminNav();
        const out: { id: string; caption: string; items: NaviGraphNode[] }[] = [];
        let current: { id: string; caption: string; items: NaviGraphNode[] } | null = null;
        let ungrouped: { id: string; caption: string; items: NaviGraphNode[] } | null = null;

        for (const node of flat) {
            if (this.nodeType(node) === 'separator') {
                current = { id: node.path, caption: node.title || '', items: [] };
                out.push(current);
            } else if (current) {
                current.items.push(node);
            } else {
                if (!ungrouped) {
                    ungrouped = { id: '__ungrouped__', caption: '', items: [] };
                    out.unshift(ungrouped);
                }
                ungrouped.items.push(node);
            }
        }

        return out.filter(s => s.items.length > 0);
    });

    /**
     * When the sidebar is icon-collapsed (rail mode), section headers
     * hide and the items always render. When expanded, items hide
     * inside collapsed sections. Centralised here so the template stays
     * readable.
     */
    showSectionItems(sectionId: string): boolean {
        if (this.sidebarState.collapsed()) return true;
        return !this.sidebarState.isSectionCollapsed(sectionId);
    }

    /**
     * Suppress the native browser context menu everywhere in the admin shell.
     * DataGridComponent opens our custom ContextMenuComponent on right-click instead.
     * Other right-clickable areas (e.g. VFS) call event.stopPropagation() to opt out.
     */
    @HostListener('document:contextmenu', ['$event'])
    onContextMenu(event: MouseEvent): void {
        // Only prevent default if our custom menu isn't handling it.
        // When menu is open, the event was already handled by the
        // component that opened the menu.
        if (!this.ctxMenuSvc.menu()) {
            event.preventDefault();
        }
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && event.key === '`') {
            event.preventDefault();
            this.toggleTerminal();
        }
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove(event: MouseEvent): void {
        if (!this.bdResizing) return;
        const delta = this.bdStartY - event.clientY;
        this.bottomDrawer.setHeight(this.bdStartH + delta);
    }

    @HostListener('document:mouseup')
    onMouseUp(): void { this.bdResizing = false; }

    onBdResizeStart(event: MouseEvent): void {
        this.bdResizing = true;
        this.bdStartY   = event.clientY;
        this.bdStartH   = this.bottomDrawer.height();
        event.preventDefault();
    }

    toggleTerminal(): void {
        this.terminalVisible.update(v => !v);
        if (!this.terminalVisible()) {
            this.terminalMaximized.set(false); // reset maximize on close
        }
    }

    closeTerminal(): void {
        this.terminalVisible.set(false);
        this.terminalMaximized.set(false);
    }

    ngOnInit(): void {
        // The stored `preferences.theme` has existed since the profile
        // Preferences tab shipped (light / dark / system default) and nothing
        // ever applied it. Loading it here — the authenticated shell — is what
        // turns dark mode on (#2031). Failure is non-fatal by design: the
        // service keeps the cached-or-OS value rather than forcing light.
        this.theme.ensureLoaded().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url = manifest?.navi?.adminNavGraph;
        if (url) {
            this.naviGraph.loadAdminNav(url).subscribe();
        }

        // Resolve activeNav override for the already-active route on fresh load.
        this.updateRouteData();
        this.expandActiveSection();

        // Track route data across subsequent navigations
        // and persist the last visited route for session restoration.
        this.router.events.pipe(
            filter(e => e instanceof NavigationEnd),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe((e) => {
            this.updateRouteData();
            this.expandActiveSection();
            const url = (e).urlAfterRedirects;
            if (!url.startsWith('/login')) {
                this.prefs.setPageState('nav', { lastRoute: url });
            }
        });
    }

    /**
     * If the active route lives inside a manually-collapsed section,
     * force that section to expand so the user can see how they got
     * there. The user can collapse it again afterwards; the collapse
     * state only re-asserts when navigating away. Called on initial
     * mount and on every NavigationEnd.
     */
    private expandActiveSection(): void {
        const url    = this.router.url.split('?')[0].split('#')[0];
        const target = this.activeNavOverride() ?? url;
        for (const section of this.sections()) {
            for (const item of section.items) {
                const itemPath = this.routerLinkFor(item);
                if (itemPath === target || target.startsWith(itemPath + '/')) {
                    this.sidebarState.ensureExpanded(section.id);
                    return;
                }
            }
        }
    }

    private updateRouteData(): void {
        // Use routerState.snapshot (always current, populated before components are created)
        // rather than this.route.firstChild which may be null during ngOnInit.
        let child = this.router.routerState.snapshot.root.firstChild;
        while (child?.firstChild) child = child.firstChild;
        this.activeNavOverride.set((child?.data['activeNav'] as string | null) ?? null);
    }

    /** Classify a nav node for template rendering. */
    nodeType(node: NaviGraphNode): 'separator' | 'link' {
        return (node.meta?.['type'] as string) === 'separator' ? 'separator' : 'link';
    }

    /** Return Bootstrap Icons slug from node meta, or empty string. */
    nodeIcon(node: NaviGraphNode): string {
        return String(node.meta?.['icon'] ?? '');
    }

    /** Regular route nav items — use RouterLink for proper zone/CD integration. */
    routerLinkFor(node: NaviGraphNode): string {
        // meta.route (PHP/YAML convention) or meta.routerLink (typed field) take priority.
        const fromMeta = node.meta['route'] ?? node.meta['routerLink'];
        if (fromMeta) {
            const s = String(fromMeta);
            return s.startsWith('/') ? s : '/' + s;
        }
        // Fallback to node.path. The app is served under base-href /admin/, but
        // Angular router paths must NOT include that prefix — strip it.
        return node.path.replace(/^\/admin/, '') || '/';
    }

    /**
     * Only logout, external (_blank) and action targets need the click-handler path.
     * Everything else uses [routerLink] above.
     */
    isSpecialTarget(node: NaviGraphNode): boolean {
        const t = node.meta['target'];
        return t === 'action.logout' || t === '_blank' || t === 'action.terminal';
    }

    onSpecialNavClick(event: MouseEvent, node: NaviGraphNode): void {
        event.preventDefault();
        this.handleSpecialNav(node);
    }

    /**
     * Route a non-link nav target (logout / external / terminal). Emitted
     * by {@link SidebarNavItemComponent} via its `specialClick` output, since
     * the recursive item component renders the row but the shell owns these
     * side effects (terminal toggle lives here).
     */
    handleSpecialNav(node: NaviGraphNode): void {
        if (node.meta['target'] === 'action.terminal') {
            this.toggleTerminal();
            return;
        }
        this.naviGraph.handleClick(node);
    }

    isActive(node: NaviGraphNode): boolean {
        // Router.url includes query params + fragment ("?host=..." /
        // "#section"); strip both so an active-state match is decided
        // by the path alone. Without this, /vfs?host=... never matches
        // the /vfs nav node and the active highlight sticks on whatever
        // was active before the query params got attached.
        const path = this.router.url.split('?')[0].split('#')[0];
        const nodePath = '/' + (node.meta['route'] ?? node.path).toString().replace(/^\//, '');

        // A child route may declare data.activeNav to nominate which sidebar
        // item should be highlighted (e.g. dynamic-records → /system/entities).
        const override = this.activeNavOverride();
        if (override) {
            const overridePath = '/' + override.replace(/^\//, '');
            if (nodePath === overridePath) return true;
        }

        return path === nodePath || path.startsWith(nodePath + '/');
    }
}
