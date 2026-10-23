import { type NaviGraphNode } from '@coolms/core-angular';

import { mailboxMenuNodes } from './mailbox-menu';

/** A right-click on a mailbox offers the action bar's actions, never the page header's. */
describe('mailboxMenuNodes -- the mailbox menu is the action bar', () => {
    const node = (path: string, meta: Record<string, unknown>): NaviGraphNode =>
        ({ path, meta } as unknown as NaviGraphNode);
    const TREE = [
        node('/add-mailbox', { action: 'add-mailbox', position: 'header' }),
        node('/module-settings', { action: 'module-settings', position: 'header' }),
        node('/compose', { action: 'compose', position: 'header' }),
        node('/mailbox-settings', { action: 'mailbox-settings', surface: 'both' }),
    ];

    it('holds the bar\'s nodes only: the mailbox\'s Settings, not Add mailbox, Email settings or Compose', () => {
        expect(mailboxMenuNodes(TREE).map(n => n.meta['action'])).toEqual(['mailbox-settings']);
    });

    it('a tree with nothing in the bar gives an empty menu, which the menu service does not open', () => {
        expect(mailboxMenuNodes(TREE.slice(0, 3))).toEqual([]);
    });
});
