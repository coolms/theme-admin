import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { ContextMenuService, DrawerService, FileEditorRegistry, ToastService, type CapabilityState, type VfsNodeDto } from '@coolms/ui-angular';
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
 * row. It was found in the network trail of the live elevation walk,
 * where `elevation.changes$` happened to reload the listing alongside.
 *
 * !! The first case is the contract: exactly one request, keyed by the
 * path the listing already holds, and the row replaced from its answer
 * WITHOUT `reload()`. Put `?id=` back and `expectOne` fails on the URL.
 *
 * !! The other two are the denominator. A spec that only checks "the row
 * updated" passes when a full reload happens to run; a spec that only
 * checks "no request" passes when the setup never wired the client.
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

/**
 * The right-click menu on a row carries the server's answer for the node it acts on, and what is chosen
 * from it goes through VfsActionsService.whenAllowed -- the menu draws `denied` disabled and `elevate` locked from
 * that answer (ui-angular), and whenAllowed decides whether and when the action runs.
 */
describe('VfsFilesComponent -- the right-click menu carries the node\'s capability answer', () => {
    const chmodNode = { path: '/chmod', meta: { action: 'VfsChmod', capability: 'vfs.node.chmod' } };

    function focusedNode(): VfsNodeDto {
        return {
            id: 'f-id', name: 'a.txt', type: 'file', path: '/docs/a.txt', mode: '0644', modeString: '-rw-r--r--',
            size: 1, humanSize: '1 B', mimeType: 'text/plain', extension: 'txt', uid: 'u1', gid: 'g1',
            uname: 'admin', gname: 'admin', createdAt: '2026-10-13T09:00:00+00:00', updatedAt: '2026-10-13T09:00:00+00:00',
            isRendered: false, isMaterialized: true, isSystem: false, isHidden: false, isContainer: false,
            title: null, description: null, permissions: { read: true, write: true, execute: false },
            capabilities: { 'vfs.node.chmod': 'elevate', 'vfs.node.delete': 'denied' },
        };
    }

    const deleteNode = { path: '/delete', meta: { action: 'VfsDelete', capability: 'vfs.node.delete' } };

    function nodeAt(path: string, del: CapabilityState): VfsNodeDto {
        return { ...focusedNode(), id: path, path, name: path, capabilities: { 'vfs.node.delete': del } };
    }

    function build(selected: VfsNodeDto[] = []): {
        component: VfsFilesComponent; openFromNodes: jasmine.Spy; whenAllowed: jasmine.Spy; executeOn: jasmine.Spy;
    } {
        const openFromNodes = jasmine.createSpy('openFromNodes');
        const whenAllowed = jasmine.createSpy('whenAllowed');
        const executeOn = jasmine.createSpy('executeOn');
        const state = {
            currentPath:     signal('/docs'),
            nodes:           signal<VfsNodeDto[]>([]),
            loading:         signal(false),
            error:           signal<string | null>(null),
            viewMode:        signal('grid'),
            selectedNodes:   signal<VfsNodeDto[]>(selected),
            hasMore:         signal(false),
            vfsToolbarNodes: signal([chmodNode, deleteNode]),
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: VfsPageStateService, useValue: state },
                { provide: VfsLiveEventsService, useValue: { watch: () => new Subject<VfsNodeChangeEvent>() } },
                { provide: ContextMenuService,   useValue: { openFromNodes } },
                { provide: DrawerService,        useValue: {} },
                { provide: Dialog,               useValue: {} },
                { provide: FileEditorRegistry,   useValue: { resolve: () => null } },
                { provide: ToastService,         useValue: {} },
                { provide: VfsUploadService,     useValue: {} },
                { provide: VfsClipboardService,  useValue: { hasAny: () => false } },
                { provide: VfsHomeLabelService,  useValue: {} },
                { provide: VfsIconService,       useValue: {} },
                { provide: VfsActionsService,    useValue: { whenAllowed, executeOn } },
                { provide: ElevationService,     useValue: {} },
            ],
        });

        const component = TestBed.runInInjectionContext(() => new VfsFilesComponent());

        return { component, openFromNodes, whenAllowed, executeOn };
    }

    it('puts the focused node\'s answer in the menu\'s record', () => {
        const { component, openFromNodes } = build();

        component.onContextMenu({ item: focusedNode(), event: new MouseEvent('contextmenu') });

        const record = openFromNodes.calls.mostRecent().args[2] as Record<string, unknown>;
        expect(record['_capabilities']).toEqual({ 'vfs.node.chmod': 'elevate', 'vfs.node.delete': 'denied' });
    });

    it('sends what is chosen through whenAllowed, with the focused node as its subject', () => {
        const { component, openFromNodes, whenAllowed, executeOn } = build();
        const focused = focusedNode();

        component.onContextMenu({ item: focused, event: new MouseEvent('contextmenu') });
        const onAction = openFromNodes.calls.mostRecent().args[3] as (id: string) => void;
        onAction('VfsChmod');

        expect(whenAllowed).toHaveBeenCalledTimes(1);
        const [node, subjects, act] = whenAllowed.calls.mostRecent().args as [unknown, VfsNodeDto[], () => void];
        expect(node).toBe(chmodNode);
        expect(subjects).toEqual([focused]);
        expect(executeOn).not.toHaveBeenCalled();
        act();
        expect(executeOn).toHaveBeenCalledWith(chmodNode, [focused]);
    });

    // A right-click INSIDE a multi-selection acts on the whole selection, so the selection's least answer
    // decides and the menu says how many refuse (2026-10-14). It used to take the clicked node's answer and
    // act on that node alone. The clicked node is ALLOWED here, so an answer read from it alone fails.
    it('takes a multi-selection\'s least answer and its refusals when the right-click is inside it', () => {
        const [a, b, c] = [nodeAt('/docs/a', 'allowed'), nodeAt('/docs/b', 'denied'), nodeAt('/docs/c', 'elevate')];
        const { component, openFromNodes } = build([a, b, c]);

        component.onContextMenu({ item: a, event: new MouseEvent('contextmenu') });

        const record = openFromNodes.calls.mostRecent().args[2] as Record<string, unknown>;
        expect(record['_single']).toBe(false);
        expect(record['_capabilities']).toEqual({ 'vfs.node.delete': 'denied' });
        expect(record['_capabilityRefusals']).toEqual({ 'vfs.node.delete': { refused: 1, of: 3 } });
    });

    it('runs what is chosen inside a multi-selection on every selected node, through whenAllowed', () => {
        const [a, b] = [nodeAt('/docs/a', 'allowed'), nodeAt('/docs/b', 'elevate')];
        const { component, openFromNodes, whenAllowed, executeOn } = build([a, b]);

        component.onContextMenu({ item: b, event: new MouseEvent('contextmenu') });
        (openFromNodes.calls.mostRecent().args[3] as (id: string) => void)('VfsDelete');

        const [node, subjects, act] = whenAllowed.calls.mostRecent().args as [unknown, VfsNodeDto[], () => void];
        expect(node).toBe(deleteNode);
        expect(subjects).toEqual([a, b]);
        act();
        expect(executeOn).toHaveBeenCalledWith(deleteNode, [a, b]);
    });

    it('takes the clicked node alone when the right-click is outside the selection', () => {
        const [a, b] = [nodeAt('/docs/a', 'allowed'), nodeAt('/docs/b', 'denied')];
        const { component, openFromNodes } = build([b]);

        component.onContextMenu({ item: a, event: new MouseEvent('contextmenu') });

        const record = openFromNodes.calls.mostRecent().args[2] as Record<string, unknown>;
        expect(record['_capabilities']).toEqual({ 'vfs.node.delete': 'allowed' });
        expect(record['_capabilityRefusals']).toEqual({});
    });
});

describe('VfsFilesComponent -- two homes with one name show their owners', () => {
    function home(uuid: string, title: string | null, uname: string): VfsNodeDto {
        return {
            id: uuid, name: uuid, type: 'directory', path: `/home/${uuid}`, mode: '0711', modeString: 'drwx--x--x',
            size: 0, humanSize: '0 B', mimeType: null as unknown as string, extension: '', uid: uuid, gid: 'g1',
            uname, gname: 'user', createdAt: '2026-10-28T09:00:00+00:00', updatedAt: '2026-10-28T09:00:00+00:00',
            isRendered: false, isMaterialized: false, isSystem: false, isHidden: false, isContainer: true,
            title, description: null, permissions: { read: true, write: false, execute: true }, capabilities: {},
        };
    }

    const probeA = home('01a0ce7f-3068-7556-a2f2-d0237d777f3c', 'Site Probe', 'probe-a@example.test');
    const probeB = home('01a0ce9f-a2b4-7896-8378-90083aa95507', 'Site Probe', 'probe-b@example.test');
    const dzmitry = home('019cbd7f-edf6-7a69-9fa5-6e495122686e', 'Dzmitry Papou', 'd.popov@example.test');
    const untitled = home('019c7566-20f3-7bc4-906b-2b7cae3d9a27', null, 'admin');

    function build(nodes: VfsNodeDto[]): VfsFilesComponent {
        const state = {
            currentPath:     signal('/home'),
            nodes:           signal<VfsNodeDto[]>(nodes),
            loading:         signal(false),
            error:           signal<string | null>(null),
            viewMode:        signal('list'),
            selectedNodes:   signal<VfsNodeDto[]>([]),
            hasMore:         signal(false),
            vfsToolbarNodes: signal([]),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: VfsPageStateService, useValue: state },
                { provide: VfsLiveEventsService, useValue: { watch: () => new Subject<VfsNodeChangeEvent>() } },
                { provide: ContextMenuService,   useValue: {} },
                { provide: DrawerService,        useValue: {} },
                { provide: Dialog,               useValue: {} },
                { provide: FileEditorRegistry,   useValue: { resolve: () => null } },
                { provide: ToastService,         useValue: {} },
                { provide: VfsUploadService,     useValue: {} },
                { provide: VfsClipboardService,  useValue: { hasAny: () => false } },
                { provide: VfsHomeLabelService,  useValue: { labelFor: (name: string) => signal(name) } },
                { provide: VfsIconService,       useValue: {} },
                { provide: VfsActionsService,    useValue: {} },
                { provide: ElevationService,     useValue: {} },
            ],
        });

        return TestBed.runInInjectionContext(() => new VfsFilesComponent());
    }

    it('shows the owner under each of two homes that carry the same name', () => {
        const component = build([probeA, probeB, dzmitry]);

        expect(component.nodeSecondaryLabel(probeA)).toBe('probe-a@example.test');
        expect(component.nodeSecondaryLabel(probeB)).toBe('probe-b@example.test');
    });

    it('shows nothing under a name no other home in the listing carries', () => {
        const component = build([probeA, probeB, dzmitry]);

        expect(component.nodeSecondaryLabel(dzmitry)).toBeNull();
    });

    it('shows nothing once the listing no longer holds the other home of that name', () => {
        const component = build([probeA, dzmitry]);

        expect(component.nodeSecondaryLabel(probeA)).toBeNull();
    });

    it('shows nothing for a node that is not a home, nor for a label that already is the identifier', () => {
        const file: VfsNodeDto = { ...probeA, id: 'f', name: 'a.txt', path: '/docs/a.txt', type: 'file' };
        const component = build([probeA, probeB, untitled, file]);

        expect(component.nodeSecondaryLabel(file)).toBeNull();
        expect(component.nodeSecondaryLabel({ ...untitled, title: 'admin' })).toBeNull();
    });
});
