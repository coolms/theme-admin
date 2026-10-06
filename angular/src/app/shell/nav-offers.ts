import { type Signal, computed } from '@angular/core';
import { type NaviGraphNode } from '@coolms/core-angular';

/**
 * Whether the admin's navigation, AS THE SERVER ANSWERED IT TO THIS ACCOUNT, offers an item that reads
 * `resource` (its `meta.resource`, e.g. `/api/v1/chat/conversations`, or the normalised `GET <path>`).
 *
 * The server lists an item only when the caller may call its resource, so this is the account's own grant, asked
 * once with the navigation the layout loads anyway (Dmitry, 2026-10-06: "an account sees in any theme exactly what
 * its groups grant"). A top-bar tile or a panel that reads a module's routes shows, and starts its polling and its
 * realtime subscriptions, only where this is true: outside the module's group every one of those calls is refused,
 * and a tile that kept asking would fail quietly forever.
 *
 * False until the navigation has loaded, so a tile appears once and never flashes in and out.
 */
export function navOffers(nav: Signal<readonly NaviGraphNode[]>, resource: string): Signal<boolean> {
    return computed(() => offers(nav(), resource));
}

function offers(nodes: readonly NaviGraphNode[], resource: string): boolean {
    for (const node of nodes) {
        // The item's own declaration (a bare path), or the server's normalised form beside it ('GET <path>').
        const normalised = (node as unknown as Record<string, unknown>)['resource'];
        if (node.meta?.['resource'] === resource || normalised === 'GET ' + resource
            || offers(node.children ?? [], resource)) {
            return true;
        }
    }

    return false;
}
