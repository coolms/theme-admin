import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { ContextMenuService, DrawerService, FileEditorRegistry, ToastService, type VfsNodeDto } from '@coolms/ui-angular';
import { ElevationService } from '@coolms/core-angular';

import { VfsFilesComponent } from './vfs-files.component';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsIconService } from './vfs-icon.service';
import { VfsLiveEventsService, type VfsNodeChangeEvent } from './vfs-live-events.service';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsUploadService } from './vfs-upload.service';

/**
 * A live `content_updated` / `metadata_changed` event refreshes ONE row,
 * and the request it sends is one the server can answer.
 *
 * The stat operation `GET /vfs/files` is keyed by PATH: `NodeProvider`
 * reads only `?path=` and answers 400 "Path is required." to anything
 * else. The realtime event carries the node's UUID, and until 2026-09-14
 * this component asked `GET /vfs/files?id=<uuid>` -- a 400 on every
 * event, swallowed by the handler's silent error branch. Nothing else
 * refreshes a row on those two event types: the structural events reload
 * the listing and in-SPA mutations reload after their own request, but a
 * content change made elsewhere reached this grid as a flash on a stale
 * row. It was found in the network trail of the ADR-184 elevation walk,
 * where `elevation.changes$` happened to reload the listing alongside.
 *
 * !! The first case is the contract: exactly one request, keyed by the
 * path the listing already holds, and the row replaced from its answer
 * WITHOUT `reload()`. Put `?id=` back and `expectOne` fails on the URL.
 *
 * !! The other two are the denominator. A spec that only checks "the row
 * updated" passes when a full reload happens to run; a spec that only
 * checks "no request" passes when the harness never wired the client.
 * The structural case proves the event pipeline is live and reloads;
 * the unknown-UUID case pins the guard that keeps a node this grid does
 * not show from costing a request it could not use.
 */
describe('VfsFilesComponent -- a live node event refetches the row by path', () => {
    const API = '/api/v1';

    function node(id: string, path: string, size: number): VfsNodeDto {
        const name = path.substring(path.lastIndexOf('/') + 1);
        return {
            id,
            name,
            type: 'file',
            path,
            mode: '0644',
            modeString: '-rw-r--r--',
            size,
            humanSize: `${size} B`,
            mimeType: 'text/plain',
            extension: 'txt',
            uid: 'u1',
            gid: 'g1',
            uname: 'admin',
            gname: 'admin',
            createdAt: '2026-09-14T09:00:00+00:00',
            updatedAt: '2026-09-14T09:00:00+00:00',
            isRendered: false,
            isMaterialized: true,
            isSystem: false,
            isHidden: false,
            isContainer: false,
            title: null,
            description: null,
            permissions: { read: true, write: true, execute: false },
        };
    }

    function build(nodes: VfsNodeDto[], currentPath: string): {
        http: HttpTestingController;
        state: { nodes: WritableSignal<VfsNodeDto[]>; reload: jasmine.Spy };
        events$: Subject<VfsNodeChangeEvent>;
        watched: string[];
    } {
        const events$ = new Subject<VfsNodeChangeEvent>();
        const watched: string[] = [];
        const state = {
            currentPath:   signal(currentPath),
            nodes:         signal<VfsNodeDto[]>(nodes),
            loading:       signal(false),
            error:         signal<string | null>(null),
            viewMode:      signal('grid'),
            selectedNodes: signal<VfsNodeDto[]>([]),
            hasMore:       signal(false),
            reload:        jasmine.createSpy('reload'),
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: API }) } },
                { provide: VfsPageStateService, useValue: state },
                {
                    provide: VfsLiveEventsService,
                    useValue: {
                        watch: (parentNodeId: string): Subject<VfsNodeChangeEvent> => {
                            watched.push(parentNodeId);
                            return events$;
                        },
                    },
                },
                // Only what construction reaches for. The component is built
                // directly, not rendered: the template and its services stay
                // out of it -- this is about the live handler and one URL.
                { provide: ContextMenuService,   useValue: {} },
                { provide: DrawerService,        useValue: {} },
                { provide: Dialog,               useValue: {} },
                { provide: FileEditorRegistry,   useValue: {} },
                { provide: ToastService,         useValue: {} },
                { provide: VfsUploadService,     useValue: {} },
                { provide: VfsClipboardService,  useValue: {} },
                { provide: VfsHomeLabelService,  useValue: {} },
                { provide: VfsIconService,       useValue: {} },
                { provide: VfsActionsService,    useValue: {} },
                { provide: ElevationService,     useValue: {} },
            ],
        });

        TestBed.runInInjectionContext(() => new VfsFilesComponent());

        // `toObservable(currentPath)` emits from an effect: tick it, answer
        // the folder stat, and the component is subscribed to the folder's
        // channel exactly as it would be on the page.
        const http = TestBed.inject(HttpTestingController);
        TestBed.tick();
        http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/files?path=${encodeURIComponent(currentPath)}`)
            .flush(node('folder-id', currentPath, 0));

        return { http, state, events$, watched };
    }

    it('asks the stat endpoint by the path it holds and replaces that one row from the answer', () => {
        const a = node('a-id', '/docs/a.txt', 10);
        const b = node('b-id', '/docs/b.txt', 20);
        const { http, state, events$, watched } = build([a, b], '/docs');
        expect(watched).withContext('channel subscribed for the listed folder').toEqual(['folder-id']);

        events$.next({ type: 'node.content_updated', nodeId: 'b-id', parentNodeId: 'folder-id', previousParentNodeId: null });

        // The contract. `NodeProvider` answers only `?path=`; a `?id=`
        // query never reaches it. This is the line that goes red if the
        // by-id form comes back.
        const req = http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/files?path=%2Fdocs%2Fb.txt`);
        req.flush({ ...b, size: 2048, humanSize: '2 KB', updatedAt: '2026-09-14T10:00:00+00:00' });

        expect(state.nodes()[1].size).withContext('the event row carries the stat answer').toBe(2048);
        expect(state.nodes()[1].updatedAt).toBe('2026-09-14T10:00:00+00:00');
        expect(state.nodes()[0]).withContext('the other row is the same object').toBe(a);
        expect(state.reload).withContext('no full-listing reload was needed').not.toHaveBeenCalled();
        http.verify();
    });

    it('sends nothing for a UUID the listing does not hold', () => {
        const { http, state, events$ } = build([node('a-id', '/docs/a.txt', 10)], '/docs');

        events$.next({ type: 'node.metadata_changed', nodeId: 'elsewhere-id', parentNodeId: 'folder-id', previousParentNodeId: null });

        // Not a request to `?id=` that happens to fail -- no request.
        http.verify();
        expect(state.reload).not.toHaveBeenCalled();
    });

    it('reloads the listing on a structural event and does not stat', () => {
        const { http, state, events$ } = build([node('a-id', '/docs/a.txt', 10)], '/docs');

        events$.next({ type: 'node.created', nodeId: 'new-id', parentNodeId: 'folder-id', previousParentNodeId: null });

        expect(state.reload).toHaveBeenCalledTimes(1);
        http.verify();
    });
});
