import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** One page-size preset (the Edit Template dialog's dropdown options). */
export interface DocumentPageSizeOption {
    readonly value: string;
    readonly label: string;
}

/** Paper dimensions as CSS lengths, orientation already applied. */
export interface DocumentSheetGeometry {
    readonly width: string;
    readonly height: string;
}

/** Response of `GET /api/v1/document/page-size?templateId=`. */
export interface DocumentPageSizeDto {
    /** The DOCX preset catalog (A4 / A3 / Letter / Legal / Wide). */
    readonly options: readonly DocumentPageSizeOption[];
    /** The template's current size, or null when unset (PHPWord default page). */
    readonly pageSize?: string | null;
    /** The template Node's VFS path — the target of the merge-patch save. */
    readonly path?: string | null;
    /** Portrait / landscape, a separate axis from the size. */
    readonly orientationOptions?: readonly DocumentPageSizeOption[];
    readonly pageOrientation?: string | null;
    /**
     * The sheet the paged canvas draws. ABSENT (not null) when the template
     * opted into no size — API Platform omits null properties, so read it as
     * `?? null` and never with a `null ===` guard.
     */
    readonly sheet?: DocumentSheetGeometry | null;
}

/**
 * Data layer for the document-builder page-size control— page-size /
 * docx-width). Mirrors {@link PageSizeService} on the content side: read the
 * DOCX preset catalog + the template's current size via the path-aware
 * `/document/page-size`, save via a generic VFS merge-patch on the template
 * Node's `extras.pageSize`. The DOCX renderer reads that extra live (the shared
 * backend catalog), so the next generation honours the new size with no
 * republish. No `pageWidth` here — the docx-meaningful presets are paper
 * sizes, not free pixel widths.
 */
@Injectable({ providedIn: 'root' })
export class DocumentPageSizeService {
    private readonly http = inject(HttpClient);

    fetch(templateId: string): Observable<DocumentPageSizeDto> {
        return this.http.get<DocumentPageSizeDto>(
            `/api/v1/document/page-size?templateId=${encodeURIComponent(templateId)}`,
        );
    }

    /**
     * Persist the template's page size and orientation. An empty / null value
     * clears that override (the merge-patch sends an explicit `null` so the key
     * is removed and the renderer falls back — to PHPWord's default page for
     * the size, and to however the size declares itself for the orientation).
     *
     * Both keys go in ONE patch: they are two halves of the same paper, and
     * saving them separately leaves a window where a document is A3 portrait
     * because the second request has not landed yet.
     */
    save(path: string, pageSize: string | null, pageOrientation: string | null = null): Observable<unknown> {
        const url = `/api/v1/vfs/files?path=${encodeURIComponent(path)}`;
        const extras = {
            pageSize: pageSize && pageSize !== '' ? pageSize : null,
            pageOrientation: pageOrientation && pageOrientation !== '' ? pageOrientation : null,
        };
        return this.http.patch(url, { path, extras }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
