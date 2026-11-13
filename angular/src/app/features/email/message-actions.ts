import { type NaviGraphNode } from '@coolms/core-angular';
import { capabilityStateOf, type ContextMenuItem, type PaneToolbarAction, refusalPhraseOf } from '@coolms/ui-angular';
import { type EmailFolderTreeNodeDto, type EmailMailboxDto, type EmailMessageDto } from './email.types';

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
 * Whether Archive applies to a target: `can` (the server says it can be archived), `blocked` (it cannot, but only
 * because of something the person can fix in the mailbox, so Archive stays drawn and can say why), or `no`.
 */
export type ArchiveFact = 'can' | 'blocked' | 'no';

/** What decides a `blocked` Archive, from the mailbox and its folders. */
export interface ArchiveContext {
    /** Why the mailbox cannot archive from its Inbox, as the mailbox list says (`all-mail-hidden`); null when nothing does. */
    readonly blockedBy: string | null;
    /** The folder in the inbox role in the mailbox's folder tree; null while the tree names none. */
    readonly inbox: string | null;
}

/** No mailbox block and no inbox known: Archive is `can` or `no`, never `blocked`. */
export const NO_ARCHIVE_CONTEXT: ArchiveContext = { blockedBy: null, inbox: null };

function inboxRoleFolder(nodes: readonly EmailFolderTreeNodeDto[]): string | null {
    for (const n of nodes) {
        if (n.role === 'inbox') {
            return n.folder;
        }
        const inner = inboxRoleFolder(n.children);
        if (inner !== null) {
            return inner;
        }
    }
    return null;
}

/**
 * The archive context of a mailbox: its `archiveBlockedBy` (absent, null or empty is not blocked, so a server that
 * does not serve it is never blocked) and the folder in the inbox role in its folder tree.
 */
export function archiveContextOf(
    mailbox: Pick<EmailMailboxDto, 'archiveBlockedBy'> | null | undefined,
    tree: readonly EmailFolderTreeNodeDto[] | null | undefined,
): ArchiveContext {
    const blockedBy = mailbox?.archiveBlockedBy;

    return {
        blockedBy: typeof blockedBy === 'string' && blockedBy !== '' ? blockedBy : null,
        inbox: tree ? inboxRoleFolder(tree) : null,
    };
}

/**
 * One message's Archive: `can` when the server says it can be archived; `blocked` when it says it cannot, the mailbox
 * says why, and the message is in the mailbox's Inbox (the folder in the inbox role); `no` otherwise.
 */
export function archiveFactOf(m: Pick<EmailMessageDto, 'canArchive' | 'folder'>, archive: ArchiveContext): ArchiveFact {
    if (m.canArchive === true) {
        return 'can';
    }
    const inInbox = archive.inbox !== null && m.folder === archive.inbox;

    return archive.blockedBy !== null && inInbox ? 'blocked' : 'no';
}

/** Several messages' Archive: `can` when any of them can, else `blocked` when any is blocked, else `no`. */
export function archiveFactOfAll(
    targets: readonly Pick<EmailMessageDto, 'canArchive' | 'folder'>[],
    archive: ArchiveContext,
): ArchiveFact {
    const each = targets.map(m => archiveFactOf(m, archive));

    return each.includes('can') ? 'can' : each.includes('blocked') ? 'blocked' : 'no';
}

/**
 * What the toolbar tree's `showWhen` conditions read about a target (the facts `navi.toolbar.email.message` names):
 * one message or several, whether any of them can still be marked read / unread / starred / unstarred, whether the
 * server says any of them can be archived (a missing or null `canArchive` is no), and whether the target is one
 * message for which the server says Reply all reaches someone Reply does not (a missing or null `replyAllUseful` is no).
 * `_archive` is the target's Archive (archiveFactOfAll), read with the mailbox's archive context.
 */
export function messageFacts(
    targets: readonly Pick<EmailMessageDto, 'seen' | 'flagged' | 'canArchive' | 'replyAllUseful' | 'folder'>[],
    archive: ArchiveContext = NO_ARCHIVE_CONTEXT,
): Record<string, boolean | ArchiveFact> {
    return {
        _single:        targets.length === 1,
        _replyAll:      targets.length === 1 && targets[0].replyAllUseful === true,
        _anyUnread:     targets.some(m => !(m.seen ?? false)),
        _anyRead:       targets.some(m => m.seen ?? false),
        _anyUnflagged:  targets.some(m => !(m.flagged ?? false)),
        _anyFlagged:    targets.some(m => m.flagged ?? false),
        _anyCanArchive: targets.some(m => m.canArchive === true),
        _archive:       archiveFactOfAll(targets, archive),
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
    'reply', 'reply-all', 'forward', 'archive', 'mark-read', 'mark-unread', 'star', 'unstar', 'move', 'delete', 'show-original',
]);

/** The action a node names: its `action`, else its path -- as the bars and the menu run it. */
export function actionOf(node: NaviGraphNode): string {
    const named = node.meta['action'];
    return typeof named === 'string' && named !== '' ? named : node.path;
}

/** The nodes a row's menu may draw: the separators, and those whose action this page has a handler for. */
export function handledNodes(nodes: readonly NaviGraphNode[], handled: ReadonlySet<string>): NaviGraphNode[] {
    return nodes.filter(n => n.meta['type'] === 'separator' || handled.has(actionOf(n)));
}

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
        const id = actionOf(node);
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

/**
 * The list row with the message's state as the detail answered it (canArchive, replyAllUseful, seen, flagged,
 * folder) written over it: the one record the toolbar, the row's menu and the checked-rows bar read. A field the
 * detail does not carry is kept.
 */
export function rowWithDetailState<T extends EmailMessageDto>(row: T, detail: EmailMessageDto): T {
    return {
        ...row,
        ...(detail.canArchive !== undefined ? { canArchive: detail.canArchive } : {}),
        ...(detail.replyAllUseful !== undefined ? { replyAllUseful: detail.replyAllUseful } : {}),
        ...(detail.seen !== undefined ? { seen: detail.seen } : {}),
        ...(detail.flagged !== undefined ? { flagged: detail.flagged } : {}),
        ...(detail.folder !== undefined ? { folder: detail.folder } : {}),
    };
}

/** An action pressed and not yet answered by the server: which one, and the messages it is on. */
export interface PendingAction {
    readonly action: string;
    readonly ids: ReadonlySet<string>;
}

/** The actions a press waits on the server for: pressed again before it answers, it is not run again. */
export const ACTIONS_THAT_WAIT: ReadonlySet<string> = new Set([
    'archive', 'delete', 'move', 'mark-read', 'mark-unread', 'star', 'unstar',
]);

/** The other state of a toggle: an action pressed that changed at once is shown by its partner while it waits. */
const TOGGLE_PARTNER: Readonly<Record<string, string>> = {
    'star': 'unstar', 'unstar': 'star', 'mark-read': 'mark-unread', 'mark-unread': 'mark-read',
};

/**
 * A row's actions while an action on any of its messages waits for the server: that one busy (or, for a toggle the
 * row already shows in its other state, that state), every other one disabled. A row with none of those messages is
 * drawn as it is.
 */
export function withPending(
    actions: readonly PaneToolbarAction[],
    pending: PendingAction | null,
    ids: readonly string[],
): PaneToolbarAction[] {
    if (pending === null || !ids.some(id => pending.ids.has(id))) {
        return [...actions];
    }

    const busy = actions.some(a => a.id === pending.action) ? pending.action : (TOGGLE_PARTNER[pending.action] ?? pending.action);

    return actions.map(a => (a.id === busy ? { ...a, busy: true } : { ...a, disabled: true }));
}
