import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { type NaviGraphNode } from '@coolms/core-angular';

import {
    FOLDER_NODES_UNTIL_SERVED, NO_FLAGS, busyRefusal, busyText, flagsOf, folderChangeRefusalText, folderMenuItems,
    folderNodes, jobFailureText, markReadRefusalText, newFolderNode, offers, readFolderJobEvent, withJob,
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
const ids = (flags: FolderFlags, nodes: readonly NaviGraphNode[] = folderNodes([])): string[] =>
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
        expect(ids(only({ canCreateChild: true }))).toEqual(['create-child']);
        expect(ids(only({ canRename: true }))).toEqual(['rename']);
        expect(ids(only({ canMarkRead: true, canCreateChild: true, canRename: true })))
            .toEqual(['mark-read', 'create-child', 'rename']);
        expect(ids(NO_FLAGS)).toEqual([]);
    });

    it('a busy folder offers none, whatever its flags say', () => {
        const all = only({ canMarkRead: true, canCreateChild: true, canRename: true, canDelete: true, canEmpty: true });

        expect(ids({ ...all, busy: 'mark-read' })).toEqual([]);
        expect(ids(withJob(all, 'mark-read'))).withContext('a job started here').toEqual([]);
        expect(withJob(all, 'mark-read').busy).toBe('mark-read');
        expect(withJob(only({ busy: 'empty' }), null).busy).withContext('the tree\'s own busy stays').toBe('empty');
        for (const action of ['mark-read', 'create-child', 'rename']) {
            expect(offers({ ...all, busy: 'empty' }, action)).withContext(action).toBeFalse();
        }
    });

    it('a served node with no condition of its own is still gated by its flag', () => {
        const nodes = [served('mark-read', 'Mark all as read'), served('rename', 'Rename')];

        expect(ids(only({ canRename: true }), nodes)).toEqual(['rename']);
        expect(ids(only({ canMarkRead: true }), nodes)).toEqual(['mark-read']);
        expect(ids(NO_FLAGS, nodes)).toEqual([]);
    });

    it('Delete and Empty are not drawn, even when the flags allow them: the server serves no route for them yet', () => {
        const nodes = [served('delete', 'Delete'), served('empty', 'Empty'), served('mark-read', 'Mark all as read')];

        expect(ids(only({ canDelete: true, canEmpty: true, canMarkRead: true }), nodes)).toEqual(['mark-read']);
    });

    it('the tree\'s flags are read strictly: only true offers, and an unknown busy is none', () => {
        expect(flagsOf({})).toEqual(NO_FLAGS);
        expect(flagsOf({ canMarkRead: 'yes' as unknown as boolean, busy: 'sleep' as unknown as null })).toEqual(NO_FLAGS);
        expect(flagsOf({ canRename: true, busy: 'mark-read' })).toEqual(only({ canRename: true, busy: 'mark-read' }));
    });

    it('until the folder tree is served, the page\'s own nodes stand in, New folder among them at list level', () => {
        expect(folderNodes([]).length).toBe(FOLDER_NODES_UNTIL_SERVED.length + 1);
        expect(newFolderNode(folderNodes([]))?.title).toBe('New folder');
        expect(folderNodes([served('rename', 'Rename')]).map(n => n.title)).toEqual(['Rename']);
        expect(newFolderNode([served('rename', 'Rename')])).toBeNull();
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

    it('a folder-busy refusal names the running action, never a generic failure', () => {
        const busy = problem(409, { type: '/errors/email/folder-busy', action: 'empty' });

        expect(busyRefusal(busy)).toBe('empty');
        expect(markReadRefusalText(busy, 'Trash')).toBe('Empty is running in this folder.');
        expect(folderChangeRefusalText(busy)).toBe('Empty is running in this folder.');
        expect(folderChangeRefusalText(problem(409, { type: '/errors/email/folder-busy', action: 'mark-read' })))
            .toBe('Mark all as read is running in this folder.');
        expect(busyText(null)).toBe('Another action is running in this folder.');
        expect(busyRefusal(problem(404, { type: '/errors/email/folder-not-found' }))).toBeUndefined();
    });

    it('a folder that cannot hold folders (\\Noinferiors) says so; each refusal has its sentence', () => {
        expect(folderChangeRefusalText(problem(422, { type: '/errors/email/folder-parent-invalid' })))
            .toBe('The mail server does not allow folders inside this folder.');
        expect(folderChangeRefusalText(problem(409, { type: '/errors/email/folder-exists' })))
            .toBe('A folder with this name is already there.');
        expect(folderChangeRefusalText(problem(422, { type: '/errors/email/folder-name-invalid', reason: 'delimiter', delimiter: '/' })))
            .toBe('A folder name cannot contain "/" on this mail server.');
        expect(folderChangeRefusalText(problem(429, {}, new HttpHeaders({ 'Retry-After': '30' }))))
            .toBe('Too many folder changes. Try again in 30 seconds.');
        expect(folderChangeRefusalText(problem(500, {}))).toBe('The folder could not be changed.');
    });

    it('the realtime end of a job is read strictly', () => {
        const evt = { type: 'mail.folders.job', mailboxId: 'mb1', jobId: 'j1', folder: 'INBOX', action: 'mark-read',
            outcome: 'failed', count: 3, reason: 'renumbered' };

        expect(readFolderJobEvent(evt)).toEqual({ ...evt, type: 'mail.folders.job', action: 'mark-read', outcome: 'failed' });
        expect(readFolderJobEvent({ ...evt, outcome: 'running' })).withContext('a job ends: done or failed').toBeNull();
        expect(readFolderJobEvent({ ...evt, action: 'shred' })).toBeNull();
        expect(readFolderJobEvent({ ...evt, jobId: 7 })).toBeNull();
    });
});
