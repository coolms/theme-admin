import { type NaviGraphNode } from '@coolms/core-angular';
import { MESSAGE_ACTIONS_HANDLED, messageFacts, moveMenuItems, paneActionsOf, rowTargetIds, type NodeConditions } from './message-actions';

/** A node as the server's tree serves it: the meta it carries, and nothing more. */
function node(path: string, meta: Record<string, unknown>, title = path.slice(1)): NaviGraphNode {
    return { id: path, path, title, parentId: null, sortOrder: 0, isActive: true, isVisible: true, meta, children: [] } as NaviGraphNode;
}

/** The served tree's evaluation, reduced to what these nodes use: showWhen on one fact, equal to a value. */
const conditions: NodeConditions = {
    matchesShowWhen: (c, record) => !c || record[String(c['field'])] === c['value'],
    isVisible: (n, record) => conditions.matchesShowWhen(n.meta['showWhen'] as Record<string, unknown> | undefined, record),
};


/**
 * The rules behind the message bars and a message row's menu: which messages an
 * action targets, and the facts the server's toolbar tree decides its actions on.
 */
describe('message actions', () => {
    describe('rowTargetIds', () => {
        it('acts on every checked message when the row is one of them', () => {
            expect(rowTargetIds(new Set(['a', 'b', 'c']), 'b').sort()).toEqual(['a', 'b', 'c']);
        });

        it('acts on the row alone when it is not checked, whatever else is', () => {
            expect(rowTargetIds(new Set(['a', 'b']), 'z')).toEqual(['z']);
            expect(rowTargetIds(new Set<string>(), 'z')).toEqual(['z']);
        });
    });

    describe('messageFacts', () => {
        it('says one message, and what it can still become', () => {
            expect(messageFacts([{ seen: false, flagged: true, canArchive: true }])).toEqual({
                _single: true, _anyUnread: true, _anyRead: false, _anyUnflagged: false, _anyFlagged: true, _anyCanArchive: true,
            });
        });

        it('says several, and offers each change any of them can take', () => {
            expect(messageFacts([{ seen: true, flagged: false, canArchive: false }, { seen: false, flagged: false, canArchive: true }])).toEqual({
                _single: false, _anyUnread: true, _anyRead: true, _anyUnflagged: true, _anyFlagged: false, _anyCanArchive: true,
            });
        });

        it('reads a missing seen or flagged as false', () => {
            const facts = messageFacts([{}]);
            expect(facts['_anyUnread']).toBeTrue();
            expect(facts['_anyFlagged']).toBeFalse();
        });

        it('can archive only when the server says so of one target: a missing, null or false canArchive is no', () => {
            expect(messageFacts([{}])['_anyCanArchive']).toBeFalse();
            expect(messageFacts([{ canArchive: null }])['_anyCanArchive']).toBeFalse();
            expect(messageFacts([{ canArchive: false }, { canArchive: null }])['_anyCanArchive']).toBeFalse();
            expect(messageFacts([{ canArchive: false }, { canArchive: true }])['_anyCanArchive']).toBeTrue();
            expect(messageFacts([])['_anyCanArchive']).toBeFalse();
        });
    });

    it('offers the folders the messages are not in, in the order and by the names given, or says there are none', () => {
        const folders = [
            { folder: 'INBOX', name: 'Вхідні' },
            { folder: 'Zeta', name: 'Zeta' },
            { folder: '[Gmail]/Trash', name: 'Кошик' },
        ];

        expect(moveMenuItems(folders, 'INBOX').map(i => [i.id, i.label])).toEqual([
            ['move:Zeta', 'Zeta'], ['move:[Gmail]/Trash', 'Кошик'],
        ]);
        expect(moveMenuItems([{ folder: 'INBOX', name: 'Inbox' }], 'INBOX'))
            .toEqual([{ id: 'none', label: 'No other folders', disabled: true }]);
    });

    describe('paneActionsOf', () => {
        /** The served tree today: no group, no overflow, no Archive. */
        const served = [
            node('/reply', { icon: 'reply', label: 'Reply', action: 'reply', surface: 'both', showWhen: { field: '_single', op: 'eq', value: true } }),
            node('/forward', { icon: 'forward', label: 'Forward', action: 'forward', surface: 'both', showWhen: { field: '_single', op: 'eq', value: true } }),
            node('/star', { icon: 'star', label: 'Star', action: 'star', surface: 'both' }),
            node('/move', { icon: 'folder-symlink', label: 'Move', action: 'move', surface: 'both' }),
            node('/delete', { icon: 'trash', label: 'Delete', action: 'delete', danger: true, surface: 'both' }),
        ];

        it('maps only what a node carries: no group is one group in the tree order, no overflow never overflows', () => {
            const actions = paneActionsOf(served, { _single: true }, MESSAGE_ACTIONS_HANDLED, conditions);
            expect(actions.map(a => a.id)).toEqual(['reply', 'forward', 'star', 'move', 'delete']);
            expect(new Set(actions.map(a => a.group))).toEqual(new Set(['']));
            expect(actions.some(a => 'overflow' in a)).toBeFalse();
            expect(actions.find(a => a.id === 'move')).toEqual({ id: 'move', label: 'Move', icon: 'folder-symlink', group: '' });
        });

        it('keeps danger on the node that carries it, and on no other', () => {
            const actions = paneActionsOf(served, { _single: true }, MESSAGE_ACTIONS_HANDLED, conditions);
            expect(actions.filter(a => a.danger === true).map(a => a.id)).toEqual(['delete']);
        });

        it('takes group and overflow as a node gives them', () => {
            const sent = [
                node('/reply', { icon: 'reply', label: 'Reply', action: 'reply', group: 'respond' }),
                node('/star', { icon: 'star', label: 'Star', action: 'star', group: 'mark', overflow: 1 }),
                node('/unstar', { icon: 'star-fill', label: 'Unstar', action: 'unstar', group: 'mark', overflow: 1 }),
                node('/move', { icon: 'folder-symlink', label: 'Move', action: 'move', group: 'mark', overflow: '2' }),
            ];
            expect(paneActionsOf(sent, {}, MESSAGE_ACTIONS_HANDLED, conditions).map(a => [a.id, a.group, a.overflow])).toEqual([
                ['reply', 'respond', undefined], ['star', 'mark', 1], ['unstar', 'mark', 1], ['move', 'mark', undefined],
            ]);
        });

        it('draws no action the page has no handler for, such as a Snooze the server may send', () => {
            const withSnooze = [...served, node('/snooze', { icon: 'clock', label: 'Snooze', action: 'snooze' })];
            expect(paneActionsOf(withSnooze, { _single: true }, MESSAGE_ACTIONS_HANDLED, conditions).map(a => a.id))
                .not.toContain('snooze');
            expect(paneActionsOf(withSnooze, { _single: true }, new Set([...MESSAGE_ACTIONS_HANDLED, 'snooze']), conditions).map(a => a.id))
                .toContain('snooze');
        });

        it('draws the served Archive only when a target can archive, as its node says: place, icon and group from the node', () => {
            const archive = node('/archive', { icon: 'archive', label: 'Archive', action: 'archive', group: 'file', surface: 'both',
                showWhen: { field: '_anyCanArchive', op: 'eq', value: true } });
            const sent = [...served, archive];
            const drawn = (targets: Parameters<typeof messageFacts>[0]) =>
                paneActionsOf(sent, messageFacts(targets), MESSAGE_ACTIONS_HANDLED, conditions).find(a => a.id === 'archive');

            expect(drawn([{ canArchive: true }])).toEqual({ id: 'archive', label: 'Archive', icon: 'archive', group: 'file' });
            expect(drawn([{ canArchive: false }])).withContext('the server says it cannot').toBeUndefined();
            expect(drawn([{}])).withContext('a message read before canArchive was served').toBeUndefined();
            expect(drawn([{ canArchive: false }, { canArchive: true }])).withContext('one of several can').toBeDefined();
        });

        it("follows showWhen for the target, and leaves out the context menu's and the header's nodes and separators", () => {
            const more = [
                ...served,
                node('/menu-only', { icon: 'x', label: 'X', action: 'star', surface: 'context' }),
                node('/head', { icon: 'x', label: 'X', action: 'move', position: 'header' }),
                node('/sep', { type: 'separator' }),
            ];
            expect(paneActionsOf(more, { _single: false }, MESSAGE_ACTIONS_HANDLED, conditions).map(a => a.id))
                .toEqual(['star', 'move', 'delete']);
        });

        it('disables a node by its disabledWhen, and marks it busy by its busyWhen', () => {
            const sent = [node('/move', { icon: 'm', label: 'Move', action: 'move',
                disabledWhen: { field: '_locked', value: true }, busyWhen: { field: '_moving', value: true } })];
            expect(paneActionsOf(sent, { _locked: true, _moving: false }, MESSAGE_ACTIONS_HANDLED, conditions)[0])
                .toEqual({ id: 'move', label: 'Move', icon: 'm', group: '', disabled: true });
            expect(paneActionsOf(sent, { _locked: false, _moving: true }, MESSAGE_ACTIONS_HANDLED, conditions)[0])
                .toEqual({ id: 'move', label: 'Move', icon: 'm', group: '', busy: true });
        });
    });
});
