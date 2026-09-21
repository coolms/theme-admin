// Cut from the shell's api/api.service.ts on 2026-09-21: the VFS (/vfs/*) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type NodeDto,
    type ChmodDto,
    type ChownDto,
} from './vfs.types';

@Injectable({ providedIn: 'root' })
export class VfsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- VFS -----------------------------------------------------------------

    statNode(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.get<NodeDto>(url, { params: { path } });
    }

    listDirectory(path: string): Observable<NodeDto[]> {
        const url = this.manifest.apiBase + '/vfs/directories/list';
        return this.http
            .get<HydraCollection<NodeDto>>(url, {
                params: { path },
                headers: { Accept: 'application/ld+json' },
            })
            .pipe(map(r => r['member']));
    }

    chmodNode(dto: ChmodDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/permissions';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    chownNode(dto: ChownDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/owner';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    deleteNode(path: string, recursive = false): Observable<void> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.delete<void>(url, { params: { path, recursive: String(recursive) } });
    }

    mkdir(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path });
    }

    /**
     * Create a directory UNDER `parentPath`, named by the platform slug
     * of `title` and carrying `title` as its display name.
     *
     * Slugging server-side is the point: the platform slugger applies
     * national transliteration rule sets (`Счета` -> `scheta`, `Größe` ->
     * `groesse`), which no client-side ASCII fold can do -- it can only
     * drop the characters and report failure.
     */
    mkdirTitled(parentPath: string, title: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path: parentPath, title });
    }

    /**
     * Write a binary file into a VFS directory (multipart). Mirrors the
     * image editor's `writeVfsFile`; `overwrite=0` makes a name clash a
     * 409 rather than a silent replacement.
     *
     * `folderPath` is the PARENT -- the endpoint's `path` field is the
     * full destination file path, so passing a directory there makes it
     * try to write over the directory itself (a 409 that reads like a
     * duplicate-name error and is not one).
     */
    uploadBinary(file: File, folderPath: string, overwrite = false): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/binary';
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('path', `${folderPath.replace(/\/+$/, '')}/${file.name}`);
        form.append('overwrite', overwrite ? '1' : '0');

        return this.http.post<NodeDto>(url, form);
    }
}
