import { type NaviGraphNode } from '@coolms/core-angular';

/**
 * The actions a right-click on a mailbox offers: exactly the action bar's -- the toolbar tree's nodes outside the
 * page header -- so the menu never holds one the bar lacks, and never the page's own (Add mailbox, Email settings).
 * Which of them show is still the tree's conditions against the page's context (ContextMenuService.openFromNodes).
 */
export function mailboxMenuNodes(nodes: readonly NaviGraphNode[]): NaviGraphNode[] {
    return nodes.filter(n => 'header' !== n.meta['position']);
}
