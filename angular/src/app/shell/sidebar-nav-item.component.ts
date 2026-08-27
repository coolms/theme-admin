import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NaviGraphService, NaviGraphNode, SidebarStateService } from '@coolms/core-angular';
/**
 * Recursive admin-sidebar nav item — renders one NaviGraph node and its
 * descendants, supporting up to three visible levels:
 *
 *   L1 (depth 0)  — top-level item under a section caption (as before).
 *   L2 (depth 1)  — children rendered INLINE, indented, with a chevron
 *                   that toggles the sub-tree (mirrors section collapse).
 *   L3 (depth ≥1's children) — rendered in a HOVER/FOCUS/CLICK flyout
 *                   anchored to the right of the L2 row.
 *
 * The icon-only collapsed rail also uses the flyout for a top-level
 * item's children (there's no room to expand inline).
 *
 * The flyout is `position: fixed` (coords computed from the row's
 * bounding rect on open) so it escapes the sidebar's `overflow:hidden`
 * clipping. Hover opens it; a 160ms close delay bridges the gap between
 * the row and the detached panel; keyboard focus opens it and focus
 * leaving the whole item closes it; Esc closes it. Touch users get an
 * explicit chevron that toggles the flyout.
 *
 * Backend already permission-filters the graph, so children arrive
 * pre-authorised — no re-filtering here. Special targets (logout /
 * external / terminal) bubble up via {@link specialClick} so the host
 * shell keeps owning those side effects.
 */
@Component({
    selector: 'cms-sidebar-nav-item',
    standalone: true,
    imports: [RouterLink, NgClass, NgTemplateOutlet, SidebarNavItemComponent],
    template: `
        <li class="cms-nav-tree-item nav-item"
            (mouseenter)="onEnter()"
            (mouseleave)="onLeave()"
            (focusin)="onEnter()"
            (focusout)="onFocusOut($event)"
            (keydown.escape)="closeFlyout()">

            <div #rowEl class="cms-nav-tree-item__row">
                @if (isSpecialTarget()) {
                    <a href="#"
                       class="cms-nav-item"
                       [class.active]="isActive()"
                       [style.paddingLeft.px]="indentPx()"
                       [title]="collapsed() ? node().title : null"
                       (click)="onSpecialClick($event)">
                        <ng-container [ngTemplateOutlet]="rowInner" />
                    </a>
                } @else {
                    <a [routerLink]="routerLinkFor()"
                       class="cms-nav-item"
                       [class.active]="isActive()"
                       [style.paddingLeft.px]="indentPx()"
                       [title]="collapsed() ? node().title : null">
                        <ng-container [ngTemplateOutlet]="rowInner" />
                    </a>
                }

                @if (showInlineChevron()) {
                    <button type="button"
                            class="cms-nav-tree-item__toggle"
                            [attr.aria-expanded]="!collapsedInline()"
                            [attr.aria-label]="(collapsedInline() ? 'Expand ' : 'Collapse ') + node().title"
                            (click)="toggleInline($event)">
                        <i class="bi"
                           [ngClass]="collapsedInline() ? 'bi-chevron-right' : 'bi-chevron-down'"></i>
                    </button>
                }
                @if (showFlyoutIndicator()) {
                    <button type="button"
                            class="cms-nav-tree-item__toggle"
                            [attr.aria-expanded]="flyoutOpen()"
                            [attr.aria-label]="'Show ' + node().title + ' submenu'"
                            (click)="toggleFlyout($event)">
                        <i class="bi bi-chevron-right"></i>
                    </button>
                }
            </div>

            @if (inlineExpanded()) {
                <ul class="cms-nav-tree-item__children nav flex-column">
                    @for (child of node().children; track child.id) {
                        <cms-sidebar-nav-item
                            [node]="child"
                            [depth]="depth() + 1"
                            [collapsed]="false"
                            [activeOverride]="activeOverride()"
                            (specialClick)="specialClick.emit($event)" />
                    }
                </ul>
            }

            @if (usesFlyout() && flyoutOpen()) {
                <div class="cms-nav-tree-item__flyout"
                     [style.top.px]="flyoutTop()"
                     [style.left.px]="flyoutLeft()"
                     (mouseenter)="cancelClose()"
                     (mouseleave)="onLeave()">
                    <div class="cms-nav-tree-item__flyout-title">{{ node().title }}</div>
                    <ul class="nav flex-column">
                        @for (child of node().children; track child.id) {
                            <cms-sidebar-nav-item
                                [node]="child"
                                [depth]="depth() + 1"
                                [collapsed]="false"
                                [inFlyout]="true"
                                [activeOverride]="activeOverride()"
                                (specialClick)="specialClick.emit($event)" />
                        }
                    </ul>
                </div>
            }
        </li>

        <ng-template #rowInner>
            @if (nodeIcon()) {
                <i class="bi" [ngClass]="'bi-' + nodeIcon()"></i>
            } @else {
                <span class="cms-nav-tree-item__icon-spacer"></span>
            }
            <span class="cms-nav-item__label">{{ node().title }}</span>
        </ng-template>
    `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
        .cms-nav-tree-item {
            display: block;
            position: relative;
            list-style: none;
        }
        .cms-nav-tree-item__row {
            display: flex;
            align-items: center;
        }
        /* The link fills the row; the toggle button sits at the far right. */
        .cms-nav-tree-item__row > .cms-nav-item {
            flex: 1;
            min-width: 0;
        }
        .cms-nav-tree-item__icon-spacer {
            width: 16px;
            display: inline-block;
            flex-shrink: 0;
        }
        .cms-nav-tree-item__toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            align-self: stretch;
            border: 0;
            background: transparent;
            color: var(--cms-sidebar-text-muted);
            cursor: pointer;
            font-size: .65rem;
            padding: 0;
            transition: color .12s ease, background .12s ease;
        }
        .cms-nav-tree-item__toggle:hover {
            color: var(--cms-text-inverse);
            background: var(--cms-sidebar-hover);
        }
        .cms-nav-tree-item__children {
            gap: 1px;
        }
        /* Subtle guide line down the indented sub-tree. */
        .cms-nav-tree-item__children {
            position: relative;
        }
        .cms-nav-tree-item__children::before {
            content: '';
            position: absolute;
            top: 2px;
            bottom: 2px;
            left: 21px;
            width: 1px;
            background: rgba(255, 255, 255, .08);
        }
        /* Flyout — detached, fixed-positioned panel for L3 / collapsed-rail. */
        .cms-nav-tree-item__flyout {
            position: fixed;
            z-index: 1100;
            min-width: 200px;
            max-width: 280px;
            padding: 6px 0;
            background: var(--cms-sidebar-bg);
            border: 1px solid rgba(255, 255, 255, .1);
            border-radius: var(--cms-radius, 6px);
            box-shadow: 4px 4px 16px rgba(0, 0, 0, .35);
        }
        .cms-nav-tree-item__flyout-title {
            padding: 4px 14px 6px;
            font-size: .625rem;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
            color: var(--cms-sidebar-text-muted);
            white-space: nowrap;
        }
        .cms-nav-tree-item__flyout .nav {
            gap: 1px;
        }
    `],
})
export class SidebarNavItemComponent {
    readonly node           = input.required<NaviGraphNode>();
    readonly depth          = input<number>(0);
    readonly collapsed      = input<boolean>(false);
    readonly inFlyout       = input<boolean>(false);
    readonly activeOverride = input<string | null>(null);

    /** Non-route targets (logout / _blank / terminal) — handled by the shell. */
    readonly specialClick = output<NaviGraphNode>();

    private readonly router       = inject(Router);
    private readonly naviGraph    = inject(NaviGraphService);
    private readonly sidebarState = inject(SidebarStateService);

    private readonly rowEl = viewChild<ElementRef<HTMLElement>>('rowEl');

    readonly flyoutOpen = signal(false);
    readonly flyoutTop  = signal(0);
    readonly flyoutLeft = signal(0);

    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    // ─── structure ───────────────────────────────────────────────────────

    hasChildren(): boolean {
        return (this.node().children?.length ?? 0) > 0;
    }

    /** True when a descendant route is the active one (keeps the trail open). */
    private hasActiveDescendant(): boolean {
        const path = this.router.url.split('?')[0].split('#')[0];
        const walk = (nodes: NaviGraphNode[]): boolean =>
            nodes.some(n => this.matchesPath(n, path) || walk(n.children ?? []));
        return walk(this.node().children ?? []);
    }

    collapsedInline(): boolean {
        return this.sidebarState.isItemCollapsed(this.node().id);
    }

    /** Inline (indented) children — only top-level items, in the expanded rail. */
    inlineExpanded(): boolean {
        if (this.collapsed() || this.depth() !== 0 || !this.hasChildren()) return false;
        return !this.collapsedInline() || this.hasActiveDescendant();
    }

    /** Flyout children — the collapsed icon rail (L1) or any deeper level (L2→L3). */
    usesFlyout(): boolean {
        if (!this.hasChildren()) return false;
        return (this.collapsed() && this.depth() === 0) || (!this.collapsed() && this.depth() >= 1);
    }

    showInlineChevron(): boolean {
        return !this.collapsed() && this.depth() === 0 && this.hasChildren();
    }

    showFlyoutIndicator(): boolean {
        return !this.collapsed() && this.depth() >= 1 && this.hasChildren();
    }

    /** Indent inline sub-items; flyout contents and the collapsed rail stay flush. */
    indentPx(): number {
        if (this.collapsed() || this.inFlyout()) return 14;
        return 14 + this.depth() * 14;
    }

    // ─── node helpers (mirror AdminLayoutComponent) ──────────────────────

    nodeIcon(): string {
        return String(this.node().meta?.['icon'] ?? '');
    }

    routerLinkFor(): string {
        const fromMeta = this.node().meta['route'] ?? this.node().meta['routerLink'];
        if (fromMeta) {
            const s = String(fromMeta);
            return s.startsWith('/') ? s : '/' + s;
        }
        return this.node().path.replace(/^\/admin/, '') || '/';
    }

    isSpecialTarget(): boolean {
        const t = this.node().meta['target'];
        return t === 'action.logout' || t === '_blank' || t === 'action.terminal';
    }

    private matchesPath(node: NaviGraphNode, currentPath: string): boolean {
        const nodePath = '/' + (node.meta['route'] ?? node.path).toString().replace(/^\//, '');
        return currentPath === nodePath || currentPath.startsWith(nodePath + '/');
    }

    isActive(): boolean {
        const path = this.router.url.split('?')[0].split('#')[0];
        const override = this.activeOverride();
        if (override) {
            const overridePath = '/' + override.replace(/^\//, '');
            const nodePath = '/' + (this.node().meta['route'] ?? this.node().path).toString().replace(/^\//, '');
            if (nodePath === overridePath) return true;
        }
        return this.matchesPath(this.node(), path);
    }

    onSpecialClick(event: MouseEvent): void {
        event.preventDefault();
        this.specialClick.emit(this.node());
    }

    // ─── inline expand ───────────────────────────────────────────────────

    toggleInline(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.sidebarState.toggleItem(this.node().id);
    }

    // ─── flyout open / close ─────────────────────────────────────────────

    onEnter(): void {
        if (!this.usesFlyout()) return;
        this.openFlyout();
    }

    onLeave(): void {
        if (!this.usesFlyout()) return;
        this.scheduleClose();
    }

    onFocusOut(event: FocusEvent): void {
        if (!this.usesFlyout()) return;
        // Closing only when focus left the whole item (row + flyout).
        const next = event.relatedTarget as Node | null;
        const host = this.rowEl()?.nativeElement.closest('.cms-nav-tree-item');
        if (host && next && host.contains(next)) return;
        this.closeFlyout();
    }

    toggleFlyout(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.flyoutOpen()) {
            this.closeFlyout();
        } else {
            this.openFlyout();
        }
    }

    private openFlyout(): void {
        const el = this.rowEl()?.nativeElement;
        if (el) {
            const rect = el.getBoundingClientRect();
            this.flyoutTop.set(Math.round(rect.top));
            this.flyoutLeft.set(Math.round(rect.right));
        }
        this.cancelClose();
        this.flyoutOpen.set(true);
    }

    closeFlyout(): void {
        this.cancelClose();
        this.flyoutOpen.set(false);
    }

    private scheduleClose(): void {
        this.cancelClose();
        this.closeTimer = setTimeout(() => this.flyoutOpen.set(false), 160);
    }

    cancelClose(): void {
        if (this.closeTimer !== null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
}
