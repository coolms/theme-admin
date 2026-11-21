import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { type NaviGraphNode } from '@coolms/core-angular';

import {
    NO_FLAGS, busyRefusal, busyText, confirmOf, emptyRefusalText, flagsOf, folderChangeRefusalText,
    folderMenuItems, folderNodes, isRenumbered, jobFailureText, markReadRefusalText, newFolderNode, nodeLabel, offers,
    readFolderJob, readFolderJobEvent, withJob,
    type FolderFlags,
} from './mail-folder-actions';

/** The showWhen evaluation the menu uses, for `eq` conditions: what the NaviGraph service does with them. */
const conditions = {
    isVisible: (node: NaviGraphNode, record: Record<string, unknown>): boolean => {
        const when = node.meta['showWhen'] as { field: string; value: unknown } | undefined;
        return when === undefined || (when.field in record && record[when.field] === when.value);
    },
};

const only = (over: Partial<FolderFlags>): FolderFlags => ({ ...NO_FLAGS, ...over });
/** One node of navi.toolbar.email.folder as the server serves it (FolderMenuContributor): title and label alike. */
function treeNode(action: string, label: string, icon: string, fact: string, sortOrder: number,
                  extra: Record<string, unknown> = {}): NaviGraphNode {
    return {
        id: action, path: `/${action}`, title: label, parentId: null, sortOrder, isActive: true, isVisible: true, children: [],
        meta: { icon, label, action, surface: 'context', resource: 'GET /api/v1/email/mailboxes',
                showWhen: { field: fact, op: 'eq', value: true }, ...extra },
    };
}

const PREVIEW = 'GET /api/v1/email/mailboxes/{mailboxId}/folders/action-preview';

/** The served tree, in its order. */
const TREE: readonly NaviGraphNode[] = [
    treeNode('new-folder', 'New folder inside', 'folder-plus', '_canCreateChild', 10),
    treeNode('rename', 'Rename', 'pencil', '_canRename', 20),
    treeNode('move', 'Move to…', 'folder-symlink', '_canRename', 30),
    treeNode('mark-read', 'Mark all as read', 'envelope-open', '_canMarkRead', 40),
    treeNode('empty', 'Empty', 'trash3', '_canEmpty', 50, { danger: true, confirm: { preview: PREVIEW, action: 'empty' } }),
    treeNode('delete', 'Delete folder', 'folder-x', '_canDelete', 60, { danger: true, confirm: { preview: PREVIEW, action: 'delete' } }),
    treeNode('new-top-folder', 'New folder', 'folder-plus', '_canCreateTop', 70, { surface: 'list' }),
];

const ids = (flags: FolderFlags, nodes: readonly NaviGraphNode[] = folderNodes(TREE)): string[] =>
    folderMenuItems(nodes, flags, conditions).map(i => i.id);

/** A served node as the server's folder tree might give it: no condition of its own. */
function served(action: string, title: string): NaviGraphNode {
    return {
        id: action, path: `/${action}`, title, parentId: null, sortOrder: 0, isActive: true, isVisible: true,
        children: [], meta: { action },
    };
}

const problem = (status: number, body: Record<string, unknown>, headers?: HttpHeaders): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: body, ...(headers ? { headers } : {}) });

describe('folder actions: what the server\'s flags offer', () => {
    it('each flag offers its action and nothing else; no flag, no action', () => {
        expect(ids(only({ canMarkRead: true }))).toEqual(['mark-read']);
        expect(ids(only({ canCreateChild: true }))).toEqual(['new-folder']);
        expect(ids(only({ canRename: true }))).withContext('Move is offered with Rename').toEqual(['rename', 'move']);
        expect(ids(only({ canDelete: true }))).toEqual(['delete']);
        expect(ids(only({ canMarkRead: true, canCreateChild: true, canRename: true })))
            .withContext('in the tree\'s order').toEqual(['new-folder', 'rename', 'move', 'mark-read']);
        expect(ids(NO_FLAGS)).toEqual([]);
    });

    it('a busy folder offers none, whatever its flags say', () => {
        const all = only({ canMarkRead: true, canCreateChild: true, canRename: true, canDelete: true, canEmpty: true });

        expect(ids({ ...all, busy: 'mark-read' })).toEqual([]);
        expect(ids(withJob(all, 'mark-read'))).withContext('a job started here').toEqual([]);
        expect(withJob(all, 'mark-read').busy).toBe('mark-read');
        expect(withJob(only({ busy: 'empty' }), null).busy).withContext('the tree\'s own busy stays').toBe('empty');
        for (const action of ['mark-read', 'new-folder', 'rename']) {
            expect(offers({ ...all, busy: 'empty' }, action)).withContext(action).toBeFalse();
        }
    });

    it('a served node with no condition of its own is still gated by its flag', () => {
        const nodes = [served('mark-read', 'Mark all as read'), served('rename', 'Rename')];

        expect(ids(only({ canRename: true }), nodes)).toEqual(['rename']);
        expect(ids(only({ canMarkRead: true }), nodes)).toEqual(['mark-read']);
        expect(ids(NO_FLAGS, nodes)).toEqual([]);
    });

    it('Empty and Delete are offered only where their flags are true, both in the danger style', () => {
        const nodes = [served('delete', 'Delete'), served('empty', 'Empty'), served('mark-read', 'Mark all as read')];

        expect(ids(only({ canDelete: true, canEmpty: true, canMarkRead: true }), nodes)).toEqual(['delete', 'empty', 'mark-read']);
        expect(ids(only({ canDelete: true, canMarkRead: true }), nodes)).withContext('canEmpty false').toEqual(['delete', 'mark-read']);
        expect(ids(only({ canEmpty: true }))).withContext('the served tree').toEqual(['empty']);
        expect(folderMenuItems(folderNodes(TREE), only({ canDelete: true }), conditions)[0].danger).toBeTrue();
        expect(ids(only({ canEmpty: true, busy: 'mark-read' }))).withContext('busy').toEqual([]);
        expect(folderMenuItems(folderNodes(TREE), only({ canEmpty: true }), conditions)[0].danger).toBeTrue();
    });

    it('the tree\'s flags are read strictly: only true offers, and an unknown busy is none', () => {
        expect(flagsOf({})).toEqual(NO_FLAGS);
        expect(flagsOf({ canMarkRead: 'yes' as unknown as boolean, busy: 'sleep' as unknown as null })).toEqual(NO_FLAGS);
        expect(flagsOf({ canRename: true, busy: 'mark-read' })).toEqual(only({ canRename: true, busy: 'mark-read' }));
    });

    it('the menu is the served tree as given: none served, no item and no New folder; no stand-in of the page\'s own', () => {
        expect(folderNodes([])).toEqual([]);
        expect(ids(only({ canRename: true, canDelete: true }), folderNodes([]))).toEqual([]);
        expect(newFolderNode(folderNodes([]))).toBeNull();
        expect(newFolderNode(folderNodes(TREE))?.meta['label']).toBe('New folder');
        expect(folderNodes([served('rename', 'Rename')]).map(n => n.title)).toEqual(['Rename']);
        expect(newFolderNode([served('rename', 'Rename')])).toBeNull();
    });

    it('each item is drawn by the node\'s label, its title only when it has none', () => {
        const items = folderMenuItems(folderNodes(TREE), only({ canRename: true, canDelete: true }), conditions);
        expect(items.map(i => i.label)).toEqual(['Rename', 'Move to…', 'Delete folder']);
        const titled = { ...TREE[1], title: 'Rename this folder', meta: { ...TREE[1].meta, label: 'Rename' } };
        expect(nodeLabel(titled)).toBe('Rename');
        expect(nodeLabel(served('rename', 'Rename this folder'))).toBe('Rename this folder');
    });

    it('a confirmed action is the one the node\'s meta.confirm names; a node without it, or a malformed one, has none', () => {
        expect(confirmOf(TREE, 'empty')).toEqual({ action: 'empty' });
        expect(confirmOf(TREE, 'delete')).toEqual({ action: 'delete' });
        expect(confirmOf(TREE, 'rename')).toBeNull();
        expect(confirmOf([], 'empty')).toBeNull();
        const odd = [treeNode('empty', 'Empty', 'trash3', '_canEmpty', 50, { confirm: { action: 'format-disk' } })];
        expect(confirmOf(odd, 'empty')).toBeNull();
        expect(confirmOf([treeNode('empty', 'Empty', 'trash3', '_canEmpty', 50, { confirm: 'yes' })], 'empty')).toBeNull();
    });
});

describe('folder actions: what is said', () => {
    it('a job that failed says its reason, each in its own sentence', () => {
        const said = ['server-failed', 'folder-not-found', 'renumbered', 'other']
            .map(reason => jobFailureText({ action: 'mark-read', reason }, 'Projects'));

        expect(new Set(said).size).withContext('four different sentences').toBe(4);
        expect(jobFailureText({ action: 'mark-read', reason: null }, 'Projects')).withContext('no reason: the plain one')
            .toBe(said[3]);
        said.forEach(s => expect(s).toContain('Projects'));
        expect(said[0]).toContain('did not finish');
        expect(said[1]).toContain('no longer on the mail server');
        expect(said[2]).toContain('renumbered');
    });

    it('a folder refusal says the server\'s detail as given; one without says Not available right now; a fault the generic sentence', () => {
        const busy = problem(409, { type: '/errors/email/folder-busy', action: 'empty', detail: 'Empty is running in this folder.' });
        expect(busyRefusal(busy)).withContext('the code still drives behaviour').toBe('empty');
        expect(markReadRefusalText(busy, 'Trash')).toBe('Empty is running in this folder.');
        expect(folderChangeRefusalText(busy)).toBe('Empty is running in this folder.');
        expect(emptyRefusalText(problem(409, { type: '/errors/email/mailbox-held', detail: 'Said by the server.' }), 'Trash')).toBe('Said by the server.');
        expect(folderChangeRefusalText(problem(422, { type: '/errors/email/folder-parent-invalid' }))).toBe('Not available right now');
        expect(folderChangeRefusalText(problem(500, { detail: 'internals' }))).toBe('Something went wrong. Try again.');
        expect(emptyRefusalText(problem(502, {}), 'Trash')).toBe('Something went wrong. Try again.');
        expect(busyText(null)).toBe('Another action is running in this folder.');
        expect(busyRefusal(problem(404, { type: '/errors/email/folder-not-found' }))).toBeUndefined();
        expect(isRenumbered(problem(409, { type: '/errors/email/folder-renumbered' }))).toBeTrue();
        expect(isRenumbered(problem(409, { type: '/errors/email/mailbox-held' }))).toBeFalse();
    });

    it('a failed Empty says its reason, each in its own sentence', () => {
        const said = ['server-failed', 'folder-not-found', 'renumbered', null]
            .map(reason => jobFailureText({ action: 'empty', reason }, 'Spam'));

        expect(new Set(said).size).toBe(4);
        said.forEach(s => expect(s).toContain('Spam'));
    });

    it('a failed job says the server\'s sentence as given; without one, the action\'s plain failure', () => {
        expect(jobFailureText({ action: 'empty', reason: 'renumbered', reasonText: 'Said by the server.' }, 'Trash')).toBe('Said by the server.');
        expect(jobFailureText({ action: 'empty', reason: 'something-new', reasonText: null }, 'Trash')).toBe('Emptying Trash did not finish.');
        expect(readFolderJob({ jobId: 'j', mailboxId: 'mb', folder: 'F', action: 'empty', outcome: 'failed', count: 0, reason: 'x', reasonText: 'Sentence.' })?.reasonText)
            .toBe('Sentence.');
    });

    it('the realtime end of a job is read strictly', () => {
        const evt = { type: 'mail.folders.job', mailboxId: 'mb1', jobId: 'j1', folder: 'INBOX', action: 'mark-read',
            outcome: 'failed', count: 3, reason: 'renumbered' };

        expect(readFolderJobEvent(evt)).toEqual({ ...evt, type: 'mail.folders.job', action: 'mark-read', outcome: 'failed', reasonText: null });
        expect(readFolderJobEvent({ ...evt, outcome: 'running' })).withContext('a job ends: done or failed').toBeNull();
        expect(readFolderJobEvent({ ...evt, action: 'shred' })).toBeNull();
        expect(readFolderJobEvent({ ...evt, jobId: 7 })).toBeNull();
    });
});
