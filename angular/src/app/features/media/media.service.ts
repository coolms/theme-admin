import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { catchError, map, Observable, of } from 'rxjs';
import { AppConfigState, MediaApiManifest, VfsApiManifest, resolvePattern } from '@coolms/core-angular';
import {
    MediaAssetDto,
    MediaListResponse,
    MediaMimeCategory,
    MediaPermissionsRequest,
    MediaStatus,
    NodeMetaDto,
    NodeMetaWire,
    UploadProgress,
} from './media.types';

/** Real state of one collection dir, from GET /media/collections/info. */
export interface CollectionInfo {
    path:      string;
    preset:    string | null;
    dirMode:   number | null;
    cacheMode: number | null;
    /** Owner display name (the creator's identifier, or a system-user name). */
    owner:     string | null;
    ownerIsMe: boolean | null;
    /** Whether the caller may change permissions (owner OR ROLE_MEDIA_LIBRARY). */
    canManage: boolean | null;
}

@Injectable({ providedIn: 'root' })
export class MediaService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): MediaApiManifest {
        return this.store.selectSnapshot(AppConfigState.manifest)!.media!;
    }

    private get vfsManifest(): VfsApiManifest {
        return this.store.selectSnapshot(AppConfigState.manifest)!.vfs!;
    }

    /**
     * Posts the file to the generic VFS binary-write endpoint.
     * Media-specific post-processing (dimensions, thumbnails) runs in the
     * backend `MediaDimensionsExtractor` / `MediaThumbnailExtractor`
     * listeners triggered by the resulting `VfsNodeChangeEvent`.
     *
     * `targetDir` is the collection's directory path; the filename is
     * derived from `file.name` and appended to form the absolute VFS
     * `path` field the endpoint expects. The endpoint returns a Node
     * resource whose `id` is the new Node UUID -- the same identity the
     * Media resource exposes to callers post-Ship-1.
     */
    upload(file: File, targetDir: string = '/media/images/public'): Observable<UploadProgress> {
        const path = `${targetDir.replace(/\/$/, '')}/${file.name}`;
        const form = new FormData();
        form.append('file', file);
        form.append('path', path);
        form.append('overwrite', 'false');

        return this.http.request(
            new HttpRequest('POST', this.vfsManifest.binaryWriteUrl, form, {
                reportProgress: true,
            })
        ).pipe(
            map(event => {
                if (event.type === HttpEventType.UploadProgress) {
                    return {
                        file,
                        progress: Math.round(100 * (event.loaded / (event.total ?? event.loaded))),
                        status: 'uploading' as const,
                    };
                }
                if (event.type === HttpEventType.Response) {
                    const body = event.body as { id?: string };
                    return { file, progress: 100, status: 'done' as const, assetId: body?.id ?? '' };
                }
                return { file, progress: 0, status: 'uploading' as const };
            }),
            catchError(err => {
                /* Prefer the API Platform `detail` field over the generic HttpErrorResponse message */
                 
                const detail: string = (err)?.error?.detail
                    ?? (err)?.error?.['hydra:description']
                    ?? (err as Error).message
                    ?? 'Upload failed';
                return of({ file, progress: 0, status: 'error' as const, error: detail });
            }),
        );
    }

    list(params: {
        page?:     number;
        limit?:    number;
        mimeType?: string;
        status?:   MediaStatus;
        tags?:     string[];
        search?:   string;
        dir?:      string;
        rootPath?: string;
    } = {}): Observable<MediaListResponse> {
        const query = new URLSearchParams();
        if (params.page)     query.set('page',  String(params.page));
        if (params.limit)    query.set('limit', String(params.limit));
        if (params.mimeType) query.set('filter', `mimeType cn "${params.mimeType}"`);
        if (params.status)   query.set('filter', `status eq "${params.status}"`);
        if (params.search)   query.set('filter', `originalFilename cn "${params.search}"`);
        if (params.dir)      query.set('dir', params.dir);
        if (params.rootPath) query.set('rootPath', params.rootPath);

        const qs = query.toString();
        const url = this.manifest.listUrl + (qs ? '?' + qs : '');
        return this.http.get<Record<string, unknown>>(url).pipe(
            map(r => ({
                member:     (r['member'] ?? r['hydra:member'] ?? []) as MediaAssetDto[],
                totalItems: (r['totalItems'] ?? r['hydra:totalItems'] ?? 0) as number,
                page:       (r['page']  ?? params.page  ?? 1) as number,
                limit:      (r['limit'] ?? params.limit ?? 20) as number,
            })),
        );
    }

    /**
     * Fetch a single asset. When `locale` is given it rides as `?locale=`, so the
     * backend resolves `alt` / `caption` to that locale (override else canonical).
     * The Properties panel passes it to lazily reload one locale at a time.
     */
    get(id: string, locale?: string): Observable<MediaAssetDto> {
        const url = resolvePattern(this.manifest.itemUrl, { id })
            + (locale ? `?locale=${encodeURIComponent(locale)}` : '');
        return this.http.get<MediaAssetDto>(url);
    }

    /**
     * Resolve a VFS path to its MediaAsset (or null when no asset is mapped to
     * the given path). Used by the picker to hydrate the trigger chip when the
     * field stored `bindValue: 'path'`. The endpoint applies the same
     * ResourceAccessVoter as the rest of /api/v1/media, so callers don't
     * filter permissions client-side.
     */
    lookupByPath(path: string): Observable<MediaAssetDto | null> {
        // The manifest doesn't carry a dedicated by-path key; derive from listUrl
        // by replacing the trailing "/media" with "/media/by-path".
        const base = this.manifest.listUrl.replace(/\/media$/, '/media/by-path');
        const url  = `${base}?path=${encodeURIComponent(path)}`;
        return this.http.get<MediaAssetDto>(url).pipe(
            catchError(() => of(null)),
        );
    }

    /**
     * List the names of every configured thumbnail preset (small / medium / large
     * / print etc). Used by the picker to validate `display: 'preset:<name>'`
     * field configs against live config.
     */
    listPresets(): Observable<string[]> {
        const base = this.manifest.listUrl.replace(/\/media$/, '/media/presets');
        return this.http.get<{ names: string[] }>(base).pipe(
            map(r => Array.isArray(r?.names) ? r.names : []),
            catchError(() => of([])),
        );
    }

    /**
     * Patch an asset. `alt` / `caption` are LOCALE-SCOPED: pass `locale` so the
     * write targets that locale (default → canonical column, other → i18n
     * override). `tags` / `focalPoint` are locale-independent and apply as-is.
     */
    update(
        id: string,
        data: Partial<Pick<MediaAssetDto, 'title' | 'description' | 'tags' | 'taxonomy' | 'focalPoint'>>,
        locale?: string,
    ): Observable<MediaAssetDto> {
        const url = resolvePattern(this.manifest.itemUrl, { id })
            + (locale ? `?locale=${encodeURIComponent(locale)}` : '');
        return this.http.patch<MediaAssetDto>(url, data, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    /**
     * Base for the generic VFS node stat/update endpoint (`/api/v1/vfs/files`).
     * `fileContentUrl` is a PATTERN (`/api/v1/vfs/files/content?path={path}`), so we
     * strip everything from `/content` onward — NOT just a trailing `/content`.
     */
    private get vfsFilesUrl(): string {
        return this.vfsManifest.fileContentUrl.replace(/\/content.*$/, '');
    }

    private nodeMetaUrl(path: string, locale?: string): string {
        return `${this.vfsFilesUrl}?path=${encodeURIComponent(path)}`
            + (locale ? `&locale=${encodeURIComponent(locale)}` : '');
    }

    private toNodeMeta(n: NodeMetaWire): NodeMetaDto {
        return {
            title:       n.title ?? null,
            description: n.description ?? null,
            canWrite:    n.permissions?.write ?? false,
        };
    }

    /**
     * Read a collection (directory) Node's localized title/description, resolved
     * for `locale` (resolve-on-read model). Used by the collection Properties panel.
     */
    getNodeMeta(path: string, locale?: string): Observable<NodeMetaDto> {
        return this.http.get<NodeMetaWire>(this.nodeMetaUrl(path, locale)).pipe(
            map(n => this.toNodeMeta(n)),
        );
    }

    /**
     * Patch a Node's title/description, scoped to `locale` (default → canonical
     * column, other → `extras.i18n` override). Mirrors `PageService.updateVariant`.
     */
    updateNodeMeta(
        path: string,
        patch: { title?: string | null; description?: string | null },
        locale?: string,
    ): Observable<NodeMetaDto> {
        const body: Record<string, unknown> = { path };
        if (patch.title !== undefined)       body['title']       = patch.title;
        if (patch.description !== undefined) body['description'] = patch.description;
        return this.http.patch<NodeMetaWire>(this.nodeMetaUrl(path, locale), body, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        }).pipe(map(n => this.toNodeMeta(n)));
    }

    /**
     * Resolve a collection (directory) path to its VFS Node UUID via the generic
     * `GET /vfs/files?path=` stat — the identity the media gallery widget stores
     * (`{widget:media:<uuid> type=…}`). Mirrors the File Explorer / Media Library
     * folder stat. Returns null on any error (missing path, permission denied,
     * transport) so the caller can abort the gallery insert cleanly.
     */
    statCollectionId(path: string): Observable<string | null> {
        if (path === '') return of<string | null>(null);
        return this.http.get<{ id?: string }>(this.nodeMetaUrl(path), {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            map(node => (typeof node?.id === 'string' ? node.id : null)),
            catchError(() => of<string | null>(null)),
        );
    }

    applyPermissions(id: string, req: MediaPermissionsRequest): Observable<void> {
        const url = resolvePattern(this.manifest.permissionsUrl, { id });
        return this.http.patch<void>(url, req, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    /**
     * `canWrite` mirrors the backend's preset policy (`MediaUploadService::canUploadTo`).
     * Older API responses without this field default to `true` — see
     * "Backward compat" in prompt-upload-permission-precheck.md (deny-by-default
     * would block uploads on a fresh install before the field was added). The
     * server still enforces the real check on POST.
     */
    listCollections(rootPath: string = '/media', depth: number = 5): Observable<{ path: string; name: string; depth: number; canWrite: boolean }[]> {
        const url = `${this.manifest.collectionsUrl}?rootPath=${encodeURIComponent(rootPath)}&depth=${depth}`;
        // API Platform wraps GetCollection responses in a hydra envelope.
        return this.http.get<{ 'hydra:member'?: unknown[]; member?: unknown[] }>(url).pipe(
            map(res => {
                const items = (res['hydra:member'] ?? res['member'] ?? []) as ReadonlyArray<{ path: string; name: string; depth: number; canWrite?: boolean }>;
                return items.map(it => ({
                    path:     it.path,
                    name:     it.name,
                    depth:    it.depth,
                    canWrite: it.canWrite ?? true,
                }));
            }),
        );
    }

    createCollection(path: string, preset: string = 'public'): Observable<{ path: string; preset: string }> {
        return this.http.post<{ path: string; preset: string }>(
            this.manifest.collectionsCreateUrl,
            { path, preset },
        );
    }

    deleteCollection(path: string, recursive = false): Observable<void> {
        const params = recursive
            ? `?path=${encodeURIComponent(path)}&recursive=true`
            : `?path=${encodeURIComponent(path)}`;
        return this.http.delete<void>(`${this.manifest.collectionsUrl}${params}`);
    }

    applyCollectionPermissions(req: {
        path:            string;
        mode:            number;
        applyToFiles?:   boolean;
        applyRecursive?: boolean;
        applyToCache?:   boolean;
        cacheMode?:      number;
    }): Observable<void> {
        // API Platform PATCH requires the merge-patch media type; plain
        // application/json 415s.
        return this.http.patch<void>(this.manifest.collectionPermissionsUrl, req, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    getCollectionInfo(path: string): Observable<CollectionInfo> {
        // Derive from collectionsUrl (/api/v1/media/collections) + /info — NOT by
        // stripping listUrl's last segment, which dropped the `/media` prefix.
        const url = `${this.manifest.collectionsUrl}/info?path=${encodeURIComponent(path)}`;
        return this.http.get<CollectionInfo>(url);
    }

    move(id: string, targetDir: string): Observable<void> {
        const url = resolvePattern(this.manifest.moveUrl ?? (this.manifest.itemUrl + '/move'), { id });
        return this.http.post<void>(url, { targetDir });
    }

    /**
     * Move/rename a VFS node BY PATH via the generic
     * `POST /api/v1/vfs/files/move` — collections (directories) included,
     * which the by-id `move()` above cannot address (collections are not
     * media assets). The VFS manifest carries no dedicated move key;
     * derive from `binaryWriteUrl` (same convention as the by-path
     * derivation from listUrl above). The backend re-paths the whole
     * subtree and maps 404/403/409 (target exists) to problem details.
     */
    moveNode(source: string, target: string): Observable<void> {
        const url = this.vfsManifest.binaryWriteUrl.replace(/\/files\/binary$/, '/files/move');
        return this.http.post<void>(url, { source, target });
    }

    delete(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.itemUrl, { id });
        return this.http.delete<void>(url);
    }

    regenerate(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.regenerateUrl, { id });
        return this.http.post<void>(url, {});
    }

    thumbnailUrl(asset: MediaAssetDto, size: string = 'medium'): string | null {
        return asset.variants[size]?.url ?? asset.thumbnailUrl ?? null;
    }

    mimeCategory(mimeType: string | null | undefined): MediaMimeCategory {
        if (!mimeType) return 'other';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.includes('pdf') || mimeType.includes('document')) return 'document';
        return 'other';
    }

    mimeIcon(mimeType: string | null | undefined): string {
        const icons: Record<MediaMimeCategory, string> = {
            image:    'bi-file-earmark-image',
            video:    'bi-file-earmark-play',
            audio:    'bi-file-earmark-music',
            document: 'bi-file-earmark-pdf',
            other:    'bi-file-earmark',
        };
        return icons[this.mimeCategory(mimeType)];
    }
}
