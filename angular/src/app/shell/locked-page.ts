import { computed, signal } from '@angular/core';
import { naviAccessOf, type NaviGraphNode } from '@coolms/core-angular';

/**
 * The router path a menu item leads to: `meta.route` or `meta.routerLink`, else the node's path without the
 * `/admin` base the app is served under (router paths never carry it).
 */
export function routeOfNavItem(node: NaviGraphNode): string {
    const fromMeta = node.meta['route'] ?? node.meta['routerLink'];
    if (fromMeta) {
        const s = String(fromMeta);
        return s.startsWith('/') ? s : '/' + s;
    }
    return node.path.replace(/^\/admin/, '') || '/';
}

/** A heading or an action (sign-out, the terminal, a panel, a new tab) is no page. */
function leadsToPage(node: NaviGraphNode): boolean {
    const t = node.meta['target'];
    return (node.meta['type'] as string | undefined) !== 'separator'
        && t !== 'action.logout' && t !== '_blank' && t !== 'action.terminal'
        && !(typeof t === 'string' && t.startsWith('action.panel:'));
}

/**
 * The menu item a page belongs to: the one a child route nominates (`data.activeNav`), else the item whose route
 * is the longest that the path equals or lies under. Null when no item leads there (a page reached only from
 * another page) -- that page keeps its own state.
 */
export function navItemOfPage(nodes: readonly NaviGraphNode[], path: string, nominated: string | null): NaviGraphNode | null {
    const target = nominated ? '/' + nominated.replace(/^\//, '') : path;
    let best: NaviGraphNode | null = null;
    let bestLength = -1;
    const walk = (list: readonly NaviGraphNode[]): void => {
        for (const node of list) {
            if (leadsToPage(node)) {
                const route = routeOfNavItem(node);
                const under = target === route || (route === '/' ? false : target.startsWith(route + '/'));
                if (under && route.length > bestLength) {
                    best = node;
                    bestLength = route.length;
                }
            }
            walk(node.children ?? []);
        }
    };
    walk(nodes);

    return best;
}

/**
 * The menu item that locks this page: its item, when the server answered it 'elevate' for this session (a member
 * of admin, not elevated, whom elevation would let in). Null when the page is open, or belongs to no item.
 */
export function lockOfPage(nodes: readonly NaviGraphNode[], path: string, nominated: string | null): NaviGraphNode | null {
    const item = navItemOfPage(nodes, path, nominated);

    return item !== null && naviAccessOf(item) === 'elevate' ? item : null;
}

/**
 * What the main area shows for the page at `path`:
 * - `page`: the page itself -- its item is open, or it belongs to none;
 * - `gate`: the Elevate state in its place -- its item is locked and the page was never shown open since it was
 *   entered (a reload, a bookmark, the back button, a link): nothing behind it is read, and once the session is
 *   elevated the item opens and the page loads;
 * - `banner`: the page, with an Elevate notice above it -- it was shown open and its elevation has ended since. The
 *   page stays, with whatever was typed into it; what it reads or saves next asks for elevation as it always does.
 */
export type PageAccess = 'page' | 'gate' | 'banner';

export function pageAccess(lock: NaviGraphNode | null, shownOpen: boolean): PageAccess {
    if (lock === null) {
        return 'page';
    }
    return shownOpen ? 'banner' : 'gate';
}

/**
 * The main area's {@link PageAccess} as the page and the menu change. Until the menu has answered for this session
 * no page is taken for locked. A page is recorded as shown open once the menu answers and does not lock it; a lock
 * after that record is an elevation that ended, a lock without it is a page entered locked.
 */
export class PageLock {
    private readonly path = signal('/');
    private readonly answered = signal(false);
    private readonly shownOpenFor = signal<string | null>(null);

    /** The menu item that locks the page for this session, or null. */
    readonly lock = computed(() => this.answered() ? lockOfPage(this.menu(), this.path(), this.nominated()) : null);

    readonly access = computed(() => pageAccess(this.lock(), this.shownOpenFor() === this.path()));

    constructor(
        private readonly menu: () => readonly NaviGraphNode[],
        private readonly nominated: () => string | null,
    ) {
    }

    /** A page is in the main area now: its path, without query or fragment. */
    pageEntered(path: string): void {
        // Another page forgets the record: coming back to one is entering it again. The same path (a query or a
        // fragment changed) keeps it.
        if (path !== this.path()) {
            this.shownOpenFor.set(null);
        }
        this.path.set(path);
        this.noteShown();
    }

    /** The menu answered, the first time or again after a change of elevation. */
    menuAnswered(): void {
        this.answered.set(true);
        this.noteShown();
    }

    private noteShown(): void {
        if (this.answered() && this.lock() === null) {
            this.shownOpenFor.set(this.path());
        }
    }
}
