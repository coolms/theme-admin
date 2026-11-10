import { type NaviGraphNode } from '@coolms/core-angular';
import { capabilityStateOf, type ContextMenuItem, type PaneToolbarAction, refusalPhraseOf } from '@coolms/ui-angular';
import { type EmailMessageDto } from './email.types';

/** The tree whose nodes are the actions on messages: the icon bars and a message row's menu. */
export const MESSAGE_TOOLBAR_TREE = 'navi.toolbar.email.message';

/**
 * Which messages an action on a row targets: the checked rows when the row is one
 * of them -- "with several messages checked, actions apply to all of them" -- else that row alone. A right-click on an
 * unchecked row never silently acts on a checked selection elsewhere in the list.
 */
export function rowTargetIds(checked: ReadonlySet<string>, rowId: string): string[] {
    return checked.has(rowId) ? [...checked] : [rowId];
}

/**
 * What the toolbar tree's `showWhen` conditions read about a target (the facts `navi.toolbar.email.message` names):
 * one message or several, whether any of them can still be marked read / unread / starred / unstarred, and whether
 * the server says any of them can be archived (a missing or null `canArchive` is no).
 */
export function messageFacts(targets: readonly Pick<EmailMessageDto, 'seen' | 'flagged' | 'canArchive'>[]): Record<string, boolean> {
    return {
        _single:        targets.length === 1,
        _anyUnread:     targets.some(m => !(m.seen ?? false)),
        _anyRead:       targets.some(m => m.seen ?? false),
        _anyUnflagged:  targets.some(m => !(m.flagged ?? false)),
        _anyFlagged:    targets.some(m => m.flagged ?? false),
        _anyCanArchive: targets.some(m => m.canArchive === true),
    };
}

/** Move's second step: the folders given other than the one the messages are in, in that order and by those names. */
export function moveMenuItems(
    folders: readonly { readonly folder: string; readonly name: string }[],
    current: string,
): ContextMenuItem[] {
    const targets = folders.filter(f => f.folder !== current);
    return targets.length > 0
        ? targets.map(f => ({ id: `move:${f.folder}`, label: f.name, icon: 'folder' }))
        : [{ id: 'none', label: 'No other folders', disabled: true }];
}

/** The tree whose nodes are the list pane's actions. */
export const LIST_TOOLBAR_TREE = 'navi.toolbar.email.list';

/** The list pane's actions this page can run. */
export const LIST_ACTIONS_HANDLED: ReadonlySet<string> = new Set(['refresh']);

/** The actions on messages this page can run (onMessageAction): a node naming any other is not drawn. */
export const MESSAGE_ACTIONS_HANDLED: ReadonlySet<string> = new Set([
    'reply', 'forward', 'archive', 'mark-read', 'mark-unread', 'star', 'unstar', 'move', 'delete',
]);

/** How a node's conditions are read: the NaviGraph service's own evaluation. */
export interface NodeConditions {
    isVisible(node: NaviGraphNode, record: Record<string, unknown>): boolean;
    matchesShowWhen(condition: Record<string, unknown> | undefined | null, record: Record<string, unknown>): boolean;
}

const condition = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;

/**
 * A pane's row of actions from the server's toolbar nodes, for this target: the nodes shown for its facts, outside the
 * header and the context menu, that this page has a handler for. Only what a node carries is mapped and nothing is
 * made up: with no `group` every node is in one group, in the tree's order; with no numeric `overflow` an action never
 * goes behind More actions; `danger`, `disabledWhen`, `busyWhen` and a denied `capability` (with its refusal) as given.
 */
export function paneActionsOf(
    nodes: readonly NaviGraphNode[],
    facts: Record<string, unknown>,
    handled: ReadonlySet<string>,
    conditions: NodeConditions,
): PaneToolbarAction[] {
    const actions: PaneToolbarAction[] = [];
    for (const node of nodes) {
        const meta = node.meta;
        const position = meta['position'];
        if (meta['type'] === 'separator' || meta['surface'] === 'context' || position === 'header' || position === 'right') {
            continue;
        }
        if (!conditions.isVisible(node, facts)) {
            continue;
        }
        const named = meta['action'];
        const id = typeof named === 'string' && named !== '' ? named : node.path;
        if (!handled.has(id)) {
            continue;
        }
        const label = meta['label'];
        const icon = meta['icon'];
        const group = meta['group'];
        const overflow = meta['overflow'];
        const unavailable = condition(meta['disabledWhen']);
        const running = condition(meta['busyWhen']);
        const busy = running !== null && conditions.matchesShowWhen(running, facts);
        const denied = capabilityStateOf(meta, facts) === 'denied';
        const disabled = denied || (unavailable !== null && conditions.matchesShowWhen(unavailable, facts));
        actions.push({
            id,
            label: typeof label === 'string' && label !== '' ? label : node.title,
            icon: typeof icon === 'string' ? icon : '',
            group: typeof group === 'string' || typeof group === 'number' ? group : '',
            ...(typeof overflow === 'number' && Number.isFinite(overflow) ? { overflow } : {}),
            ...(meta['danger'] === true ? { danger: true } : {}),
            ...(disabled ? { disabled: true } : {}),
            ...(denied ? { reason: refusalPhraseOf(meta, facts) } : {}),
            ...(busy ? { busy: true } : {}),
        });
    }

    return actions;
}
