import { HttpErrorResponse } from '@angular/common/http';
import { type NaviGraphNode } from '@coolms/core-angular';
import { type ContextMenuItem } from '@coolms/ui-angular';

import { type EmailFolderTreeNodeDto, type FolderJobAction, type FolderJobDto, type FolderJobReason } from './email.types';
import { waitInWords } from './mail-aliases';
import { actionOf, type NodeConditions } from './message-actions';

/** The tree whose nodes are the actions on a folder: a folder row's menu, and New folder at the foot of the list. */
export const FOLDER_TOOLBAR_TREE = 'navi.toolbar.email.folder';

/** The actions on a folder this page can run. Delete is not served yet: a node naming it is not drawn. */
export type FolderAction = 'mark-read' | 'create-child' | 'rename' | 'empty';

/** The list-level action: a folder at the top level. */
export const NEW_TOP_FOLDER = 'create-top';

/** Each action this page runs on a folder row, and the server's flag that alone may offer it. */
const FLAG_OF: Readonly<Record<FolderAction, keyof FolderFlags>> = {
    'mark-read': 'canMarkRead',
    'create-child': 'canCreateChild',
    rename: 'canRename',
    empty: 'canEmpty',
};

export const FOLDER_ACTIONS_HANDLED: ReadonlySet<string> = new Set<FolderAction>(['mark-read', 'create-child', 'rename', 'empty']);

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

const node = (path: string, title: string, action: string, icon: string, fact: string, order: number, danger = false): NaviGraphNode => ({
    id: `folder${path}`, path, title, parentId: null, sortOrder: order, isActive: true, isVisible: true, children: [],
    meta: {
        action, icon, label: title, surface: 'both', showWhen: { field: fact, op: 'eq', value: true },
        ...(danger ? { danger: true } : {}),
    },
});

/**
 * The folder actions until the server serves its folder action tree: the same nodes it is to serve, each shown by the
 * flag that offers it. Replaced by the server's as soon as it answers with any node.
 */
export const FOLDER_NODES_UNTIL_SERVED: readonly NaviGraphNode[] = [
    node('/mark-read', 'Mark all as read', 'mark-read', 'envelope-open', '_canMarkRead', 10),
    node('/create-child', 'New folder inside', 'create-child', 'folder-plus', '_canCreateChild', 20),
    node('/rename', 'Rename or move', 'rename', 'pencil', '_canRename', 30),
    node('/empty', 'Empty', 'empty', 'trash3', '_canEmpty', 35, true),
];

/** The list-level node until the tree is served: New folder, at the foot of the folder list. */
export const NEW_FOLDER_NODE_UNTIL_SERVED: NaviGraphNode = {
    ...node('/create-top', 'New folder', NEW_TOP_FOLDER, 'folder-plus', '_canCreateTop', 40),
    meta: { action: NEW_TOP_FOLDER, icon: 'folder-plus', label: 'New folder', position: 'list',
        showWhen: { field: '_canCreateTop', op: 'eq', value: true } },
};

/** The nodes to draw: the server's when it answered with any, else the ones above. */
export function folderNodes(served: readonly NaviGraphNode[]): readonly NaviGraphNode[] {
    return served.length > 0 ? served : [...FOLDER_NODES_UNTIL_SERVED, NEW_FOLDER_NODE_UNTIL_SERVED];
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
        if (surface === 'toolbar' || n.meta['position'] === 'list') {
            continue;
        }
        const action = actionOf(n);
        if (!offers(flags, action) || !conditions.isVisible(n, facts)) {
            continue;
        }
        const icon = n.meta['icon'];
        items.push({
            id: action, label: n.title,
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

/** A failed job in a sentence: its reason's, or a plain failure for a reason not known here. */
export function jobFailureText(job: Pick<FolderJobDto, 'action' | 'reason'>, name: string): string {
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

/** A name the server refused, in words, by the reason it gives. */
function invalidName(reason: unknown, delimiter: unknown): string {
    switch (reason) {
        case 'empty':
            return 'Give the folder a name.';
        case 'delimiter':
            return typeof delimiter === 'string' && delimiter !== ''
                ? `A folder name cannot contain "${delimiter}" on this mail server.`
                : 'This name holds a character the mail server uses between folder names.';
        case 'too-long':
            return 'This name is too long for the mail server.';
        case 'reserved':
            return 'The mail server keeps this name for itself.';
        default:
            return 'The mail server does not accept this name.';
    }
}

/**
 * Why the server refused a folder create, rename or move, in a sentence for the dialog: each problem type its own.
 * A folder that cannot hold folders (a server's \Noinferiors, which the tree cannot know) says so.
 */
export function folderChangeRefusalText(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 429) {
        const after = Number(err.headers.get('Retry-After'));

        return `Too many folder changes. Try again ${Number.isFinite(after) && after > 0 ? `in ${waitInWords(after)}` : 'later'}.`;
    }
    const { kind, fields } = problemFields(err);
    switch (kind) {
        case 'folder-exists':
            return 'A folder with this name is already there.';
        case 'folder-not-found':
            return 'This folder is no longer on the mail server.';
        case 'folder-protected':
            return 'The mail server keeps this folder for its own use: it cannot be changed.';
        case 'folder-name-invalid':
            return invalidName(fields['reason'], fields['delimiter']);
        case 'folder-parent-invalid':
            return 'The mail server does not allow folders inside this folder.';
        case 'folder-busy':
            return busyText(typeof fields['action'] === 'string' ? fields['action'] : null);
    }
    if (err instanceof HttpErrorResponse && err.status === 504) {
        return 'The mail server stopped answering after the change was sent: it may have been made.';
    }
    if (err instanceof HttpErrorResponse && err.status === 502) {
        return 'The mail server did not make the change.';
    }

    return 'The folder could not be changed.';
}

/** Why Mark all as read did not start, in a sentence. */
export function markReadRefusalText(err: unknown, name: string): string {
    const running = busyRefusal(err);
    if (running !== undefined) {
        return busyText(running);
    }
    const { kind } = problemFields(err);
    if (kind === 'folder-not-found') {
        return `${name} is no longer on the mail server.`;
    }
    if (err instanceof HttpErrorResponse && err.status === 502) {
        return `The mail server could not be reached: nothing in ${name} was marked read.`;
    }

    return `The messages in ${name} could not be marked read.`;
}

/** Why the server will not empty a folder (422 folder-not-emptiable), by its reason. */
const NOT_EMPTIABLE: Readonly<Record<string, (name: string) => string>> = {
    'not-allowed': name => `You may not empty ${name}: only the mailbox's owner and its managers may.`,
    'not-trash-or-spam': name => `${name} is not Trash or Spam: only those can be emptied.`,
    'ceiling-required': name => `The mail server needs a fresh count of ${name} before it can be emptied. Try Empty again.`,
    'no-uidplus': name => `This mail server cannot remove exactly the messages counted in ${name}, so it is not emptied `
        + 'from here.',
};

/** A refusal is the folder renumbered since its preview (409 folder-renumbered): the preview is asked again. */
export function isRenumbered(err: unknown): boolean {
    return problemFields(err).kind === 'folder-renumbered';
}

/** Why Empty, or its preview, was refused, in a sentence: each problem its own. */
export function emptyRefusalText(err: unknown, name: string): string {
    const { kind, fields } = problemFields(err);
    switch (kind) {
        case 'folder-not-emptiable': {
            const reason = fields['reason'];
            const said = typeof reason === 'string' ? NOT_EMPTIABLE[reason] : undefined;
            return said !== undefined ? said(name) : `${name} cannot be emptied.`;
        }
        case 'mailbox-held':
            return `This mailbox is under a legal hold: nothing in ${name} can be removed for good.`;
        case 'folder-renumbered':
            return `${name} changed on the mail server since it was counted. Nothing was removed; here is what it holds now.`;
        case 'folder-busy':
            return busyText(typeof fields['action'] === 'string' ? fields['action'] : null);
        case 'folder-not-found':
            return `${name} is no longer on the mail server.`;
    }
    if (err instanceof HttpErrorResponse && err.status === 502) {
        return `The mail server could not be reached: nothing in ${name} was removed.`;
    }

    return `${name} could not be emptied.`;
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
    };
}
