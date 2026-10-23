import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { VFS_NODE_WATCH, type VfsNodeChange } from '@coolms/ui-angular';
import { provideVfsNodeWatch } from './vfs-node-watch.provider';
import { VfsLiveEventsService, type VfsNodeChangeEvent } from './vfs-live-events.service';

/**
 * The admin's file watch for an open editor: it follows the file's folder channel, passes on this file's deletes, and
 * on a content update asks for the file's version itself -- the folder's channel reaches listers, so it names none --
 * so the editor tells its own save from another's.
 */
describe('provideVfsNodeWatch -- an open file\'s changes elsewhere', () => {
    let http: HttpTestingController;
    let events: Subject<VfsNodeChangeEvent>;
    let watched: string[];

    beforeEach(() => {
        events = new Subject<VfsNodeChangeEvent>();
        watched = [];
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideVfsNodeWatch(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: VfsLiveEventsService, useValue: { watch: (id: string) => { watched.push(id); return events; } } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function event(type: VfsNodeChangeEvent['type'], nodeId: string): VfsNodeChangeEvent {
        return { type, parentNodeId: 'folder-1', nodeId, previousParentNodeId: null };
    }

    it('follows the folder, passes this file\'s delete, asks its version on an update, and ignores the others', () => {
        const seen: VfsNodeChange[] = [];
        TestBed.inject(VFS_NODE_WATCH)({ id: 'file-1', path: '/docs/a.txt' }).subscribe(c => seen.push(c));

        http.expectOne(r => r.url === '/api/v1/vfs/files' && r.params.get('path') === '/docs').flush({ id: 'folder-1' });
        expect(watched).toEqual(['folder-1']);

        events.next(event('node.content_updated', 'another-file'));
        events.next(event('node.renamed', 'file-1'));
        http.expectNone(r => r.url === '/api/v1/vfs/files' && r.params.get('path') === '/docs/a.txt');

        events.next(event('node.content_updated', 'file-1'));
        http.expectOne(r => r.url === '/api/v1/vfs/files' && r.params.get('path') === '/docs/a.txt').flush({ contentHash: 'h9' });

        events.next(event('node.deleted', 'file-1'));

        expect(seen).toEqual([{ kind: 'changed', version: 'h9' }, { kind: 'deleted' }]);
    });

    it('takes only a 404 for the version read as "deleted"; any other failure reports nothing', () => {
        const seen: VfsNodeChange[] = [];
        TestBed.inject(VFS_NODE_WATCH)({ id: 'file-1', path: '/docs/a.txt' }).subscribe(c => seen.push(c));
        http.expectOne(r => r.url === '/api/v1/vfs/files' && r.params.get('path') === '/docs').flush({ id: 'folder-1' });
        const versionRead = (): ReturnType<HttpTestingController['expectOne']> =>
            http.expectOne(r => r.url === '/api/v1/vfs/files' && r.params.get('path') === '/docs/a.txt');

        events.next(event('node.content_updated', 'file-1'));
        versionRead().flush('boom', { status: 500, statusText: 'Server Error' });
        events.next(event('node.content_updated', 'file-1'));
        versionRead().flush('no', { status: 403, statusText: 'Forbidden' });
        events.next(event('node.content_updated', 'file-1'));
        versionRead().error(new ProgressEvent('error'));
        expect(seen).withContext('a 500, a 403 and a dropped connection say nothing about the file').toEqual([]);

        events.next(event('node.content_updated', 'file-1'));
        versionRead().flush('gone', { status: 404, statusText: 'Not Found' });
        expect(seen).toEqual([{ kind: 'deleted' }]);
    });
});
