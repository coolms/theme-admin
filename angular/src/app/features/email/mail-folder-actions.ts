import { HttpErrorResponse } from '@angular/common/http';
import { type NaviGraphNode } from '@coolms/core-angular';
import { type ContextMenuItem } from '@coolms/ui-angular';

import { type EmailFolderTreeNodeDto, type FolderJobAction, type FolderJobDto, type FolderJobReason } from './email.types';
import { actionOf, type NodeConditions } from './message-actions';
import { refusalWords, sentenceOf } from './server-words';

/** The tree whose nodes are the actions on a folder: a folder row's menu, and New folder at the foot of the list. */
export const FOLDER_TOOLBAR_TREE = 'navi.toolbar.email.folder';

/** The actions on a folder this page can run. */
export type FolderAction = 'mark-read' | 'new-folder' | 'rename' | 'move' | 'empty' | 'delete';

/** The list-level action: a folder at the top level. */
export const NEW_TOP_FOLDER = 'new-top-folder';

/** Each action this page runs on a folder row, and the server's flag that alone may offer it. */
const FLAG_OF: Readonly<Record<FolderAction, keyof FolderFlags>> = {
    'mark-read': 'canMarkRead',
    'new-folder': 'canCreateChild',
    rename: 'canRename',
    move: 'canRename',
    empty: 'canEmpty',
    delete: 'canDelete',
};

export const FOLDER_ACTIONS_HANDLED: ReadonlySet<string> = new Set<FolderAction>(['mark-read', 'new-folder', 'rename', 'move', 'empty', 'delete']);

/** A folder's flags as the tree gives them. */
export type FolderFlags = Required<Pick<EmailFolderTreeNodeDto,
    'canCreateChild' | 'canRename' | 'canDelete' | 'canEmpty' | 'canMarkRead'>> & {
    readonly busy: FolderJobAction | null;
};

/** No flags: nothing offered. What a folder the tree does not describe (or an older server) has. */
export const NO_FLAGS: FolderFlags = {
    canCreateChild: false, canRename: false, canDelete: false, canEmpty: false, canMarkRead: false, busy: null,
};

const isJobAction = (v: unknown): v is FolderJobAction => v === 'mark-read' || v === 'empty' || v === 'delete';

/** A tree node's flags, read strictly: only `true` offers, and a busy that is not a known job is none. */
export function flagsOf(node: Partial<EmailFolderTreeNodeDto>): FolderFlags {
    return {
        canCreateChild: node.canCreateChild === true,
        canRename: node.canRename === true,
        canDelete: node.canDelete === true,
        canEmpty: node.canEmpty === true,
        canMarkRead: node.canMarkRead === true,
        busy: isJobAction(node.busy) ? node.busy : null,
    };
}

/**
 * A folder's flags with a job this page knows runs on it (started here, before the tree is read again): busy with
 * that job. While busy, nothing is offered, whatever a flag says.
 */
export function withJob(flags: FolderFlags, running: FolderJobAction | null): FolderFlags {
    const busy = running ?? flags.busy;

    return busy === null ? flags : { ...NO_FLAGS, busy };
}

/** What the folder tree's `showWhen` conditions read about a folder. */
export function folderFacts(flags: FolderFlags): Record<string, boolean | string | null> {
    const free = flags.busy === null;

    return {
        _canCreateChild: free && flags.canCreateChild,
        _canRename: free && flags.canRename,
        _canDelete: free && flags.canDelete,
        _canEmpty: free && flags.canEmpty,
        _canMarkRead: free && flags.canMarkRead,
        _busy: flags.busy,
    };
}

/** Whether the server's flags offer this action on the folder: never while it is busy. */
export function offers(flags: FolderFlags, action: string): boolean {
    if (flags.busy !== null || !FOLDER_ACTIONS_HANDLED.has(action)) {
        return false;
    }

    return flags[FLAG_OF[action as FolderAction]] === true;
}


/** The nodes to draw: the server's tree as it serves it; none while it serves none. */
export function folderNodes(served: readonly NaviGraphNode[]): readonly NaviGraphNode[] {
    return served;
}

/** What a node is called where it is drawn: its label, else its title. */
export function nodeLabel(n: NaviGraphNode): string {
    const label = n.meta['label'];
    return typeof label === 'string' && label !== '' ? label : n.title;
}

/** The list-level node (New folder) of the nodes, or null when the tree has none. */
export function newFolderNode(nodes: readonly NaviGraphNode[]): NaviGraphNode | null {
    return nodes.find(n => actionOf(n) === NEW_TOP_FOLDER) ?? null;
}

/**
 * A folder row's menu: the nodes this page has a handler for, that the folder's flags offer, and whose conditions the
 * facts meet, in the tree's order. A flag that is false keeps its action out whatever the node says; a busy folder
 * offers none. Separators are kept only between two items.
 */
export function folderMenuItems(
    nodes: readonly NaviGraphNode[],
    flags: FolderFlags,
    conditions: Pick<NodeConditions, 'isVisible'>,
): ContextMenuItem[] {
    const facts = folderFacts(flags);
    const items: ContextMenuItem[] = [];
    for (const n of nodes) {
        if (n.meta['type'] === 'separator') {
            if (items.length > 0 && items[items.length - 1].divider !== true) {
                items.push({ id: n.path, divider: true });
            }
            continue;
        }
        const surface = n.meta['surface'];
        if (surface === 'toolbar' || surface === 'list' || n.meta['position'] === 'list') {
            continue;
        }
        const action = actionOf(n);
        if (!offers(flags, action) || !conditions.isVisible(n, facts)) {
            continue;
        }
        const icon = n.meta['icon'];
        items.push({
            id: action, label: nodeLabel(n),
            ...(typeof icon === 'string' && icon !== '' ? { icon } : {}),
            ...(n.meta['danger'] === true ? { danger: true } : {}),
        });
    }
    while (items.length > 0 && items[items.length - 1].divider === true) {
        items.pop();
    }

    return items;
}

/** Each job's name, as the menu and the busy row say it. */
const JOB_NAMES: Readonly<Record<FolderJobAction, string>> = {
    'mark-read': 'Mark all as read',
    empty: 'Empty',
    delete: 'Delete',
};

/** A job's name; any other action is "Another action". */
export function jobName(action: string | null | undefined): string {
    return isJobAction(action) ? JOB_NAMES[action] : 'Another action';
}

/** What a busy folder says: the action running on it. */
export function busyText(action: string | null | undefined): string {
    return `${jobName(action)} is running in this folder.`;
}

const isReason = (v: unknown): v is FolderJobReason =>
    v === 'server-failed' || v === 'folder-not-found' || v === 'renumbered';

/** Why a Mark all as read failed, in a sentence, by the server's reason code. */
const MARK_READ_FAILURES: Readonly<Record<FolderJobReason, (name: string) => string>> = {
    'server-failed': name => `The mail server did not finish marking the messages in ${name} as read.`,
    'folder-not-found': name => `${name} is no longer on the mail server, so its messages were not all marked read.`,
    renumbered: name => `The mail server renumbered the messages in ${name} while they were being marked read; `
        + 'some may still be unread.',
};

/** Why an Empty failed, in a sentence, by the server's reason code. */
const EMPTY_FAILURES: Readonly<Record<FolderJobReason, (name: string) => string>> = {
    'server-failed': name => `The mail server did not finish emptying ${name}; some messages may still be there.`,
    'folder-not-found': name => `${name} is no longer on the mail server, so it was not emptied.`,
    renumbered: name => `The mail server renumbered the messages in ${name} while it was being emptied; `
        + 'nothing more was removed.',
};

/** A failed job in a sentence: the server's sentence for its reason as given, else a plain failure of the action. */
export function jobFailureText(job: Pick<FolderJobDto, 'action' | 'reason' | 'reasonText'>, name: string): string {
    const said = sentenceOf(job.reasonText);
    if (said !== null) {
        return said;
    }
    if (job.action === 'mark-read') {
        return isReason(job.reason) ? MARK_READ_FAILURES[job.reason](name) : `Marking the messages in ${name} as read did not finish.`;
    }
    if (job.action === 'empty') {
        return isReason(job.reason) ? EMPTY_FAILURES[job.reason](name) : `Emptying ${name} did not finish.`;
    }

    return `${jobName(job.action)} did not finish in ${name}.`;
}

/** The problem's last segment and its fields, from a refused folder call. */
function problemFields(err: unknown): { kind: string | null; fields: Record<string, unknown> } {
    const body = err instanceof HttpErrorResponse && typeof err.error === 'object' && err.error !== null
        ? err.error as Record<string, unknown>
        : {};
    const type = body['type'];
    const kind = typeof type === 'string' && type.includes('/errors/email/') ? type.slice(type.lastIndexOf('/') + 1) : null;

    return { kind, fields: body };
}

/** A refused folder call's running job (folder-busy), or undefined when it is not that refusal. */
export function busyRefusal(err: unknown): string | null | undefined {
    const { kind, fields } = problemFields(err);
    if (kind !== 'folder-busy') {
        return undefined;
    }

    return typeof fields['action'] === 'string' ? fields['action'] : null;
}

/** Why the server refused a folder create, rename or move: its detail as given, or the generic sentence for a fault. */
export function folderChangeRefusalText(err: unknown): string {
    return refusalWords(err);
}

/** Why Mark all as read did not start: the server's detail as given, or the generic sentence for a fault. */
export function markReadRefusalText(err: unknown, _name: string): string {
    return refusalWords(err);
}

/** A refusal is the folder renumbered since its preview (409 folder-renumbered): the preview is asked again. */
export function isRenumbered(err: unknown): boolean {
    return problemFields(err).kind === 'folder-renumbered';
}

/** Why Empty, or its preview, was refused: the server's detail as given, or the generic sentence for a fault. */
export function emptyRefusalText(err: unknown, _name: string): string {
    return refusalWords(err);
}

/** The realtime end of a folder job, on the person's mail channel. */
export interface MailFolderJobEvent extends FolderJobDto {
    readonly type: 'mail.folders.job';
    readonly outcome: 'done' | 'failed';
}

/** The event, read strictly: anything not in its shape is no event. */
export function readFolderJobEvent(raw: unknown): MailFolderJobEvent | null {
    const job = readFolderJob(raw);
    if (job === null || (raw as Record<string, unknown>)['type'] !== 'mail.folders.job' || job.outcome === 'running') {
        return null;
    }

    return { ...job, type: 'mail.folders.job', outcome: job.outcome };
}

/** A job as the server answers it, read strictly; null when it is not one. */
export function readFolderJob(raw: unknown): FolderJobDto | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const outcome = o['outcome'];
    if (typeof o['jobId'] !== 'string' || typeof o['mailboxId'] !== 'string' || typeof o['folder'] !== 'string'
        || !isJobAction(o['action']) || (outcome !== 'running' && outcome !== 'done' && outcome !== 'failed')) {
        return null;
    }

    return {
        jobId: o['jobId'],
        mailboxId: o['mailboxId'],
        folder: o['folder'],
        action: o['action'],
        outcome,
        count: typeof o['count'] === 'number' && Number.isInteger(o['count']) && o['count'] >= 0 ? o['count'] : 0,
        reason: typeof o['reason'] === 'string' && o['reason'] !== '' ? o['reason'] : null,
        reasonText: sentenceOf(o['reasonText']),
    };
}
