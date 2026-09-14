import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { ContextMenuService, type VfsNodeDto } from '@coolms/ui-angular';

import { VfsTreeComponent } from './vfs-tree.component';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsIconService } from './vfs-icon.service';
import { type VfsNodeChangeEvent } from './vfs-live-events.service';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsTreeLiveSubscriptionsService } from './vfs-tree-live-subscriptions.service';

/**
 * The tree's live row refresh has the same contract as the files panel's
 * (see vfs-files.component.spec.ts): `GET /vfs/files` answers only
 * `?path=`, and this component used to ask `?id=<uuid>` -- a 400 per
 * event, silent. The path comes from `findPathByUuid`, the lookup the
 * structural branch already used; a UUID the tree has not loaded has no
 * row to replace and is skipped.
 *
 * Driven through the public seam: the reconciliation effect hands its
 * handler to `VfsTreeLiveSubscriptionsService.reconcile`, so a stub
 * captures the same function the channel would call.
 */
describe('VfsTreeComponent -- a live node event refetches the row by path', () => {
    const API = '/api/v1';

    function dir(id: string, path: string, title: string | null): VfsNodeDto {
        return {
            id,
            name: path.substring(path.lastIndexOf('/') + 1),
            type: 'directory',
            path,
            mode: '0755',
            modeString: 'drwxr-xr-x',
            size: 0,
            humanSize: '0 B',
            mimeType: null,
            extension: null,
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
            isContainer: true,
            title,
            description: null,
            permissions: { read: true, write: true, execute: true },
        };
    }

    function build(rootChildren: VfsNodeDto[]): {
        component: VfsTreeComponent;
        http: HttpTestingController;
        handler: () => (event: VfsNodeChangeEvent) => void;
        reconciled: string[][];
    } {
        const reconciled: string[][] = [];
        let captured: ((event: VfsNodeChangeEvent) => void) | null = null;

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: API }) } },
                {
                    provide: VfsPageStateService,
                    useValue: { currentPath: signal('/'), reloadTrigger: signal(0) },
                },
                {
                    provide: VfsTreeLiveSubscriptionsService,
                    useValue: {
                        reconcile: (ids: ReadonlySet<string>, handler: (event: VfsNodeChangeEvent) => void): void => {
                            reconciled.push([...ids]);
                            captured = handler;
                        },
                    },
                },
                { provide: VfsHomeLabelService, useValue: { register: (): void => {} } },
                { provide: ContextMenuService,  useValue: {} },
                { provide: VfsClipboardService, useValue: {} },
                { provide: VfsActionsService,   useValue: {} },
                { provide: VfsIconService,      useValue: {} },
            ],
        });

        const component = TestBed.runInInjectionContext(() => new VfsTreeComponent());
        const http = TestBed.inject(HttpTestingController);

        // Mount as the page does: the root listing and the root stat.
        component.ngOnInit();
        http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/directories/list?path=%2F&limit=50`)
            .flush({ member: rootChildren, hasMore: false, nextCursor: null });
        http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/files?path=%2F`)
            .flush(dir('root-id', '/', null));
        TestBed.tick();

        return {
            component,
            http,
            reconciled,
            handler: () => {
                if (captured === null) {
                    throw new Error('reconcile() never ran -- the live handler was not captured');
                }
                return captured;
            },
        };
    }

    it('asks the stat endpoint by the path it holds for the UUID and replaces that row', () => {
        const docs = dir('docs-id', '/docs', null);
        const { component, http, handler, reconciled } = build([docs]);
        expect(reconciled[reconciled.length - 1]).withContext('root channel subscribed').toEqual(['root-id']);

        handler()({ type: 'node.metadata_changed', nodeId: 'docs-id', parentNodeId: 'root-id', previousParentNodeId: null });

        // The contract -- the line that goes red if `?id=` comes back.
        http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/files?path=%2Fdocs`)
            .flush({ ...docs, title: 'Documents' });

        expect(component.childrenMap().get('/')?.[0].title).toBe('Documents');
        const first = component.flatNodes()[0];
        expect(first.kind === 'node' ? first.node.title : null).withContext('the rendered row').toBe('Documents');
        http.verify();
    });

    it('sends nothing for a UUID it has not loaded', () => {
        const { http, handler } = build([dir('docs-id', '/docs', null)]);

        handler()({ type: 'node.content_updated', nodeId: 'unloaded-id', parentNodeId: 'root-id', previousParentNodeId: null });

        http.verify();
    });

    it('re-lists the parent on a structural event and does not stat', () => {
        const { http, handler } = build([dir('docs-id', '/docs', null)]);

        handler()({ type: 'node.created', nodeId: 'new-id', parentNodeId: 'root-id', previousParentNodeId: null });

        http.expectOne(r => r.method === 'GET' && r.urlWithParams === `${API}/vfs/directories/list?path=%2F&limit=50`)
            .flush({ member: [], hasMore: false, nextCursor: null });
        http.verify();
    });
});
