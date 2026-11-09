import { type ContextMenuItem } from '@coolms/ui-angular';
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
 * one message or several, and whether any of them can still be marked read / unread / starred / unstarred.
 */
export function messageFacts(targets: readonly Pick<EmailMessageDto, 'seen' | 'flagged'>[]): Record<string, boolean> {
    return {
        _single:       targets.length === 1,
        _anyUnread:    targets.some(m => !(m.seen ?? false)),
        _anyRead:      targets.some(m => m.seen ?? false),
        _anyUnflagged: targets.some(m => !(m.flagged ?? false)),
        _anyFlagged:   targets.some(m => m.flagged ?? false),
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
