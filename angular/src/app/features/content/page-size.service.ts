import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/** One page-size preset (the admin select's options). */
export interface PageSizeOption {
    readonly value: string;
    readonly label: string;
}

/** Response of `GET /api/v1/content/page-size?path=`. */
export interface PageSizeDto {
    /** The preset catalog (A4 / Letter / Legal / Wide / Full / Custom). */
    readonly options: readonly PageSizeOption[];
    /** The page's current size, or null when unset (default container). */
    readonly pageSize?: string | null;
    /** The custom pixel width (only meaningful when `pageSize === 'custom'`). */
    readonly pageWidth?: number | null;
    readonly path?: string | null;
}

/**
 * Data layer for the per-document page-size control (Track B — page-size /
 * docx-width). Mirrors {@link BlockEditorService}: read via the path-aware
 * `/content/page-size`, save via a generic VFS merge-patch on the Package's
 * `extras.pageSize` / `extras.pageWidth`. The SSR + DOCX renderers read those
 * extras live (the shared backend catalog), so no republish is needed.
 */
@Injectable({ providedIn: 'root' })
export class PageSizeService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    fetch(path: string): Observable<PageSizeDto> {
        const url = `${this.apiBase}/content/page-size?path=${encodeURIComponent(path)}`;
        return this.http.get<PageSizeDto>(url);
    }

    /**
     * Persist the page's size. `null`/`pageSize` clears the override (the
     * merge-patch sends explicit `null`s so the keys are removed). The custom
     * width is only sent for the `custom` preset.
     */
    save(path: string, pageSize: string | null, pageWidth: number | null): Observable<unknown> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(path)}`;
        const extras = {
            pageSize: pageSize && pageSize !== '' ? pageSize : null,
            pageWidth: pageSize === 'custom' && pageWidth && pageWidth > 0 ? pageWidth : null,
        };
        return this.http.patch(url, { path, extras }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
