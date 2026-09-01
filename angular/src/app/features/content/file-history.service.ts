import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import {
    FileBlame,
    FileRevisionContent,
    FileRevisionDiff,
    FileRevisionLog,
} from './file-history.types';

/**
 * Data layer for the VFS file-history UI ( W6.3): log, single-revision
 * body, any-two (or vs-current) diff, restore-forward, and line-level blame.
 *
 * The endpoints are generic over any VFS file Node and path-addressed, so the
 * `path` is always `encodeURIComponent`-escaped (a raw `\`-containing or
 * special-char path is mangled by the browser otherwise). Base URL resolves
 * from the API manifest, matching `PageService`.
 */
@Injectable({ providedIn: 'root' })
export class FileHistoryService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Newest-first revision timeline of a file (+ the caller's restore gate). */
    log(path: string): Observable<FileRevisionLog> {
        const url = `${this.apiBase}/vfs/files/revisions?path=${encodeURIComponent(path)}`;
        return this.http.get<FileRevisionLog>(url);
    }

    /** The stored body of one past revision (for preview). */
    content(path: string, revisionId: string): Observable<FileRevisionContent> {
        const url = `${this.apiBase}/vfs/files/revisions/content`
            + `?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(revisionId)}`;
        return this.http.get<FileRevisionContent>(url);
    }

    /**
     * Line-level diff between two points in history. `to` omitted compares the
     * `from` revision against the live current content.
     */
    diff(path: string, from: string, to?: string): Observable<FileRevisionDiff> {
        let url = `${this.apiBase}/vfs/files/revisions/diff`
            + `?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}`;
        if (to) {
            url += `&to=${encodeURIComponent(to)}`;
        }
        return this.http.get<FileRevisionDiff>(url);
    }

    /** Per-line attribution of the file's current content. */
    blame(path: string): Observable<FileBlame> {
        const url = `${this.apiBase}/vfs/files/revisions/blame?path=${encodeURIComponent(path)}`;
        return this.http.get<FileBlame>(url);
    }

    /**
     * Restore a past revision by writing its body forward as the new current
     * content (never destructive — the restore is itself recorded as a new
     * revision). Returns the refreshed log.
     */
    restore(path: string, revisionId: string): Observable<FileRevisionLog> {
        const url = `${this.apiBase}/vfs/files/revisions/restore`;
        return this.http.post<FileRevisionLog>(url, { path, revisionId });
    }
}
