import { type Signal, computed } from '@angular/core';
import { type NaviAccess, type NaviGraphNode, naviAccessOf } from '@coolms/core-angular';

/**
 * Whether the admin's navigation, AS THE SERVER ANSWERED IT TO THIS ACCOUNT, opens an item that reads `resource`
 * (its `meta.resource`, e.g. `/api/v1/chat/conversations`, or the normalised `GET <path>`) to this account now.
 *
 * The server lists an item only when the caller may call its resource, so this is the account's own grant, asked
 * once with the navigation the layout loads anyway (Dmitry, 2026-10-06: "an account sees in any theme exactly what
 * its groups grant"). A top-bar tile or a panel that reads a module's routes shows, and starts its polling and its
 * realtime subscriptions, only where this is true: outside the module's group every one of those calls is refused,
 * and a tile that kept asking would fail quietly forever.
 *
 * An item the server marks `elevate` (a member of admin whose own rights refuse it until the session is elevated,
 * 2026-10-12) does NOT count here: its calls are refused until the grant, so nothing may start on it. It is
 * {@link navLocked} -- shown with a lock, asking for elevation first.
 *
 * False until the navigation has loaded, so a tile appears once and never flashes in and out.
 */
export function navOffers(nav: Signal<readonly NaviGraphNode[]>, resource: string): Signal<boolean> {
    return computed(() => accessIn(nav(), resource) === 'allowed');
}

/**
 * Whether the item that reads `resource` is in the navigation LOCKED for this account: a member of admin whose own
 * rights refuse it, and whom elevation would let in. Its control shows with a lock and asks for elevation before it
 * does anything; it starts no polling and no subscription.
 */
export function navLocked(nav: Signal<readonly NaviGraphNode[]>, resource: string): Signal<boolean> {
    return computed(() => accessIn(nav(), resource) === 'elevate');
}

/**
 * A console panel's access, read from the menu item that opens it: the item whose target is `action.panel:<id>`, or
 * `action.terminal` for the terminal's panel (the graph's own name for it). The panel's top-bar toggle and its
 * keyboard shortcut follow the navigation rule as every item does (2026-10-13, "the header terminal button follows
 * the navigation rule"):
 * - 'allowed': the toggle shows and opens the panel;
 * - 'elevate': it shows with a lock and asks for elevation first;
 * - null: no such item for this account. The toggle is hidden and the shortcut does nothing.
 * Null until the navigation has loaded, as for the tiles.
 */
export function panelAccessIn(nodes: readonly NaviGraphNode[], panelId: string): NaviAccess | null {
    for (const node of nodes) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the wire may omit meta
        const target = node.meta?.['target'];
        if (target === 'action.panel:' + panelId || (panelId === 'terminal' && target === 'action.terminal')) {
            return naviAccessOf(node);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the wire may omit children
        const below = panelAccessIn(node.children ?? [], panelId);
        if (below !== null) {
            return below;
        }
    }
    return null;
}

/** The access of the first item that reads `resource`; null when the navigation has none for this account. */
function accessIn(nodes: readonly NaviGraphNode[], resource: string): NaviAccess | null {
    for (const node of nodes) {
        // The item's own declaration (a bare path), or the server's normalised form beside it ('GET <path>').
        const normalised = (node as unknown as Record<string, unknown>)['resource'];
        // Defensive as it always was: every tile reads this computed, so a node that arrives without meta or
        // children must not throw in it.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the wire may omit meta
        if (node.meta?.['resource'] === resource || normalised === 'GET ' + resource) {
            return naviAccessOf(node);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the wire may omit children
        const below = accessIn(node.children ?? [], resource);
        if (below !== null) {
            return below;
        }
    }
    return null;
}
