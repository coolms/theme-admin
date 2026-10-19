import { inject, type Provider } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { EMPTY, catchError, concatMap, filter, map, of, switchMap, type Observable } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { VFS_NODE_WATCH, type VfsNodeChange, type VfsNodeWatch } from '@coolms/ui-angular';
import { VfsLiveEventsService } from './vfs-live-events.service';

/**
 * The admin's file watch for an open editor (2026-10-14: "A file that is deleted or changed elsewhere while open: the
 * editor says so, from the VFS change event"). The VFS publishes a node's changes on its folder's channel, so the
 * watch reads the folder's id, follows its channel -- shared with the listing beside it, which keeps it when the
 * editor closes -- and passes on this file's deletes and content updates. A watch that cannot start ends quietly: the
 * editor then learns of a change when it saves (412 / 404).
 */
export function provideVfsNodeWatch(): Provider {
    return {
        provide: VFS_NODE_WATCH,
        useFactory: (): VfsNodeWatch => {
            const live = inject(VfsLiveEventsService);
            const http = inject(HttpClient);
            const store = inject(Store);
            return node => {
                const folder = node.path.slice(0, node.path.lastIndexOf('/')) || '/';
                const base = store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
                return http.get<{ id: string }>(`${base}/vfs/files`, { params: { path: folder } }).pipe(
                    switchMap(dir => live.watch(dir.id)),
                    filter(event => event.nodeId === node.id
                        && (event.type === 'node.deleted' || event.type === 'node.content_updated')),
                    // A content update names no version on the folder's channel (it reaches listers, not only readers):
                    // the file's version is asked for here, as the reader the editor is, so the editor tells its own
                    // save from another's.
                    concatMap((event): Observable<VfsNodeChange> => event.type === 'node.deleted'
                        ? of({ kind: 'deleted' })
                        : http.get<{ contentHash?: string | null }>(`${base}/vfs/files`, { params: { path: node.path } }).pipe(
                            map(file => ({ kind: 'changed' as const, version: file.contentHash ?? null })),
                            // Only "not found" means the file went. Any other failure (a 5xx, a dropped connection,
                            // a 403) says nothing about the file: nothing is reported, and the save's If-Match decides.
                            catchError((error: unknown) => error instanceof HttpErrorResponse && error.status === 404
                                ? of({ kind: 'deleted' as const })
                                : EMPTY),
                        )),
                    catchError(() => EMPTY),
                );
            };
        },
    };
}
