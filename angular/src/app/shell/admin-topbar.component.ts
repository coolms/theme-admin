import {
    ChangeDetectionStrategy, Component, computed, HostBinding, HostListener, inject, OnInit, output, signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ActivatedRoute, ActivatedRouteSnapshot, Router, NavigationEnd } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { ConsoleActivation, type NaviAccess, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { panelAccessIn } from './nav-offers';
import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';
import { ElevationBadgeComponent } from './elevation-badge.component';
import { PageTitleService } from '@coolms/ui-angular';
import { type Crumb, type CrumbLevel, resolveCrumbs } from './breadcrumbs';
import { CrumbNamesService } from './crumb-names.service';


/**
 * Full topbar: brand logo left, route breadcrumbs center, drawer toggle + profile right.
 * Breadcrumbs rebuild on every NavigationEnd.
 */
@Component({
    selector: 'app-admin-topbar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, NgComponentOutlet, AdminTopbarProfileComponent, ElevationBadgeComponent],
    template: `
        <div class="cms-topbar-row d-flex align-items-center h-100 px-3 gap-3">

            <!-- Logo / brand -->
            <a routerLink="/" class="cms-topbar-logo text-white text-decoration-none fw-bold me-2"
               style="font-size: 1rem; letter-spacing: .02em; flex-shrink: 0">
                CoolMS
            </a>

            <div class="cms-topbar-divider vr opacity-25 mx-1"></div>

            <!-- Breadcrumbs. The last crumb is whatever the page resolved: a
                 title, or a raw UUID when it did not. flex-nowrap stops the
                 LIST wrapping but not the text inside an item, and a browser
                 happily breaks a UUID after its hyphens - which put the topbar
                 on two lines and pushed the row out of shape. So the last crumb
                 is the only one allowed to shrink, and it ellipsises; the
                 ancestors are short and stay whole. Hover shows the full value.
                 (NO BACKTICKS in this comment - one would end the template.) -->
            <nav class="cms-topbar-crumbs flex-grow-1 overflow-hidden" style="min-width: 0" aria-label="breadcrumb">
                <ol class="breadcrumb mb-0 flex-nowrap" style="font-size: .8rem">
                    @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
                        <li class="breadcrumb-item"
                            [class.active]="last"
                            [class.text-nowrap]="!last"
                            [class.text-truncate]="last"
                            [style.flex-shrink]="last ? '1' : '0'"
                            [style.min-width]="last ? '0' : null">
                            @if (!last) {
                                <a [routerLink]="crumb.link ?? crumb.path"
                                   class="text-white-50 text-decoration-none">
                                    {{ crumb.label }}
                                </a>
                            } @else {
                                <span class="text-white" [title]="crumb.label">{{ crumb.label }}</span>
                            }
                        </li>
                    }
                </ol>
            </nav>

            <!-- Right actions: site selector + terminal toggle + drawer toggle + profile -->
            <div class="cms-topbar-actions d-flex align-items-center gap-2 ms-auto flex-shrink-0">

                <!-- ⚠️ NO SITE SELECTOR HERE, AND THE MEASUREMENT SAYS WHY.
                     It sat in this bar on every screen, including Users,
                     Groups, Definitions and Email, where the data is global.

                     Swept: 75 of the API's collection endpoints, fetched once
                     under every section. ZERO changed content -- the header
                     filters nothing, anywhere. Its one documented job was to
                     decide where a new page lands, and the Pages screen took
                     that away on purpose: openCreateDialog() passes the
                     explorer's own space key, which overrides the header (probed:
                     header coolms-docs + space site:coolms-site -> the page
                     lands in coolms-site). The one screen where the choice
                     still decides something is Settings, which is where the
                     control now lives. -->

                <!-- The modules' dock-panel toggles, from their console entries
                     (console@1): the terminal's is the one that reads >_. Each
                     follows the menu item that opens its panel: hidden where
                     the account has none, locked where it needs elevation. -->
                @for (panel of console.panels(); track panel.id) {
                    @if (panelAccess(panel.id); as access) {
                        <button type="button"
                                class="cms-topbar-panel cms-btn cms-btn-sm position-relative"
                                style="font-family: var(--cms-font-mono, monospace); font-size: .8rem; padding: 4px 10px"
                                [title]="panel.toggle.label + (access === 'elevate' ? ' -- needs an elevated session' : '')"
                                [attr.aria-label]="panel.toggle.label + (access === 'elevate' ? ', needs an elevated session' : '')"
                                (click)="panelToggle.emit(panel.id)">
                            @if (panel.toggle.text) {
                                {{ panel.toggle.text }}
                            } @else if (panel.toggle.icon) {
                                <i class="bi bi-{{ panel.toggle.icon }}" aria-hidden="true"></i>
                            }
                            @if (access === 'elevate') {
                                <i class="bi bi-lock-fill ms-1" aria-hidden="true" style="font-size: .65rem"></i>
                            }
                        </button>
                    }
                }

                <!-- The modules' quick-access tiles, from their console entries
                     (console@1), in their declared order and only for the
                     modules the manifest says are installed. -->
                @if (offeredPanels().length >= 2) {
                    <div class="cms-topbar-more position-relative">
                        <button type="button" class="cms-btn cms-btn-sm" data-test="topbar-more"
                                aria-label="More panels" title="More panels" aria-haspopup="menu"
                                [attr.aria-expanded]="moreOpen()" (click)="toggleMore($event)">
                            <i class="bi bi-three-dots" aria-hidden="true"></i>
                        </button>
                        @if (moreOpen()) {
                            <div class="cms-topbar-more__menu cms-page-surface position-absolute end-0 mt-1 py-1 rounded shadow"
                                 role="menu" aria-label="More panels">
                                @for (o of offeredPanels(); track o.panel.id) {
                                    <button type="button" role="menuitem" class="dropdown-item d-flex align-items-center gap-2"
                                            [attr.data-panel]="o.panel.id" (click)="openPanel(o.panel.id)">
                                        <span>{{ o.panel.toggle.label }}</span>
                                        @if (o.access === 'elevate') {
                                            <i class="bi bi-lock-fill" aria-hidden="true"></i>
                                            <span class="visually-hidden">, needs an elevated session</span>
                                        }
                                    </button>
                                }
                            </div>
                        }
                    </div>
                }

                @for (item of console.topbar(); track item.id) {
                    <ng-container *ngComponentOutlet="item.component" />
                }

                <!-- "Elevated until HH:MM", shown only while the session is
                     elevated. It sits AGAINST the profile block and behind its
                     own separator, not among the icons: the icons are places
                     to go, and this is what state you are in. It renders its
                     own separator so the divider cannot outlive it. -->
                <app-elevation-badge />

                <!-- Profile dropdown -->
                <app-admin-topbar-profile />
            </div>
        </div>
    `,
    styles: [`
        /* A phone keeps the logo, the panel buttons and the profile on the bar: the page header already says where
           you are, so the breadcrumb and its divider give their room, and the gaps and buttons tighten. No scroll
           container: the buttons' own popovers would be clipped by it. */
        .cms-topbar-more { display: none; }
        .cms-topbar-more__menu { z-index: 30; min-width: 220px; }
        @media (max-width: 599.98px) {
            .cms-topbar-row { gap: 4px !important; padding-left: 8px !important; padding-right: 8px !important; }
            .cms-topbar-divider, .cms-topbar-crumbs { display: none !important; }
            .cms-topbar-logo { margin-right: 0 !important; font-size: .9rem !important; }
            .cms-topbar-actions { gap: 4px !important; }
            /* A stated exception to the 44px touch target (--cms-touch-target-min): the top bar's items are 32px on a
               phone, until the modules' top-bar items have a menu form that lets them go behind the "More panels"
               menu. 32px stays above WCAG 2.5.8's 24px minimum target size (AA); every other control keeps 44px. */
            :host ::ng-deep .cms-topbar-actions .cms-btn,
            :host ::ng-deep .cms-topbar-actions .btn {
                min-width: 32px; height: 32px; padding: 4px 8px !important;
            }
            /* Two or more panel toggles go behind one menu; a single one stays on the bar. */
            :host(.cms-topbar--panels-menu) .cms-topbar-panel { display: none !important; }
            :host(.cms-topbar--panels-menu) .cms-topbar-more { display: block; }
            .cms-topbar-more__menu .dropdown-item { min-height: var(--cms-touch-target-min, 44px); }
        }
    `],
})
export class AdminTopbarComponent implements OnInit {
    /** The panel toggles this account is offered, in the console's order, each with its access. */
    protected readonly offeredPanels = computed(() =>
        this.console.panels()
            .map(panel => ({ panel, access: this.panelAccess(panel.id) }))
            .filter((o): o is { panel: typeof o.panel; access: NaviAccess } => o.access !== null),
    );

    /** The phone's "More panels" menu is open. */
    protected readonly moreOpen = signal(false);

    @HostBinding('class.cms-topbar--panels-menu')
    protected get panelsMenu(): boolean {
        return this.offeredPanels().length >= 2;
    }

    protected toggleMore(event: Event): void {
        event.stopPropagation();
        this.moreOpen.update(open => !open);
    }

    protected openPanel(id: string): void {
        this.moreOpen.set(false);
        this.panelToggle.emit(id);
    }

    /** Escape, or a press anywhere else, closes the menu. */
    @HostListener('document:keydown.escape')
    @HostListener('document:click')
    protected closeMore(): void {
        this.moreOpen.set(false);
    }

    /** The modules' console contributions, filtered by what the manifest says is installed. */
    protected readonly console        = inject(ConsoleActivation);
    private readonly router           = inject(Router);
    private readonly route            = inject(ActivatedRoute);
    private readonly pageTitleSvc     = inject(PageTitleService);

    private readonly crumbNames       = inject(CrumbNamesService);

    /** The matched route chain, read on every NavigationEnd: what the breadcrumb is built from (never the URL text). */
    private readonly matched = signal<{
        segments: string[];
        levels: CrumbLevel[];
        intermediate?: { label: string; routerLink: string };
    }>({ segments: [], levels: [] });
    private readonly nav              = inject(NaviGraphService).adminNav;
    /**
     * A dock panel's toggle was pressed: the panel id, for the layout that owns the dock. The layout applies the
     * navigation rule to it, as to the panel's keyboard shortcut (togglePanelByRule).
     */
    panelToggle = output<string>();

    /** The panel's access as the menu item that opens it says (see {@link panelAccessIn}); null hides its toggle. */
    panelAccess(panelId: string): NaviAccess | null {
        return panelAccessIn(this.nav(), panelId);
    }

    /**
     * The breadcrumb: names only -- a page's resolved name for a path, the route's
     * `data.crumb`, the admin menu's title for that path -- and a crumb nothing names is left out (breadcrumbs.ts).
     * A route that declares an intermediate crumb (`data.breadcrumb`) shows Home, that crumb, and the page's resolved
     * title once it has one.
     */
    readonly breadcrumbs = computed((): Crumb[] => {
        const m = this.matched();
        const title = this.pageTitleSvc.current();
        if (m.intermediate) {
            const full = '/' + m.segments.join('/');
            return [
                { path: '/', label: 'Home' },
                { path: m.intermediate.routerLink, label: m.intermediate.label },
                ...(title ? [{ path: full, label: title }] : []),
            ];
        }
        const titles = navTitles(this.nav());
        const names = this.crumbNames.names();
        return resolveCrumbs(m.segments, m.levels, {
            navTitle: p => titles.get(p),
            named: p => names.get(p),
            pageTitle: title,
            tail: this.crumbNames.tail(),
        });
    });

    ngOnInit(): void {
        this.router.events.pipe(
            filter(e => e instanceof NavigationEnd),
            startWith(null),
        ).subscribe(() => {
            // Clear the previous route's title before reading the new chain: until the page names itself, its crumb
            // is left out rather than shown as a path word.
            this.pageTitleSvc.clear();
            this.matched.set(matchedChain(this.router.routerState.snapshot.root));
        });
    }
}

/** The admin menu's title for each path it links to (separators and headings carry no path of their own). */
function navTitles(nodes: readonly NaviGraphNode[]): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (list: readonly NaviGraphNode[]): void => {
        for (const n of list) {
            if (n.path && n.title && !out.has(n.path)) {
                out.set(n.path, n.title);
            }
            walk(n.children ?? []);
        }
    };
    walk(nodes);
    return out;
}

/** The URL segments the matched routes consumed, and where each route's share ends with its declared crumb. */
function matchedChain(root: ActivatedRouteSnapshot): {
    segments: string[];
    levels: CrumbLevel[];
    intermediate?: { label: string; routerLink: string };
} {
    const segments: string[] = [];
    const levels: CrumbLevel[] = [];
    let intermediate: { label: string; routerLink: string } | undefined;
    for (let r: ActivatedRouteSnapshot | null = root; r; r = r.firstChild) {
        if (r.url.length > 0) {
            segments.push(...r.url.map(s => s.path));
            const crumb = r.routeConfig?.data?.['crumb'];
            levels.push({ end: segments.length, ...(typeof crumb === 'string' ? { label: crumb } : {}) });
        }
        if (!r.firstChild) {
            intermediate = r.data['breadcrumb'] as { label: string; routerLink: string } | undefined;
        }
    }
    return { segments, levels, ...(intermediate ? { intermediate } : {}) };
}
