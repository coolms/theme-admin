import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/** One field of a {@link BlockTypeSchemaDto} -- kind drives the editor widget. */
export interface BlockFieldSchemaDto {
    readonly name: string;
    /** 'text' | 'textarea' | 'url' | 'group'. */
    readonly kind: string;
    /**
     * Optional control HINT from the backend, e.g. 'process-capture'.
     *
     * Never required: `kind` still governs storage and validation, so a hint
     * this admin does not recognise falls through to the control `kind`
     * implies. That is what lets a module contribute a block type with a
     * richer editor WITHOUT this file naming the block type -- an admin that
     * hardcoded 'process_diagram' would be a hardcoded consumer beside an
     * extensible registry, which is the defect the hint exists to avoid.
     */
    readonly editor?: string | null;
    /** Typed sub-fields when `kind === 'group'`; empty otherwise. */
    readonly itemFields: readonly BlockFieldSchemaDto[];
}

/** A landing block type from the catalog (palette entry). */
export interface BlockTypeSchemaDto {
    readonly id: string;
    readonly label: string;
    readonly fields: readonly BlockFieldSchemaDto[];
}

/** One authored section block: `{ type, ...fields }` (group fields hold arrays). */
export type BlockModel = Record<string, unknown>;

/** Response of `GET /api/v1/content/landing-blocks?path=`. */
export interface LandingBlocksDto {
    /** The block-type catalog (palette). */
    readonly types: readonly BlockTypeSchemaDto[];
    /**
     * The page's sections as the public site renders them -- unknown types and undeclared keys dropped, live data
     * added. A view: never written back.
     */
    readonly blocks: readonly BlockModel[];
    /** The page's sections exactly as stored (extras.blocks, in order): what the editor edits and saves. */
    readonly storedBlocks?: readonly BlockModel[] | null;
    /** The version the page's details were read at: every save names it (If-Match). */
    readonly version?: string | null;
    /** The page's content-type discriminator (`'landing'` enables the editor). */
    readonly contentType?: string | null;
    readonly path?: string | null;
}

/**
 * Data layer for the landing-page block editor.
 *
 *  - `fetch(path)` -> the block-type catalog + the page's current sections +
 *    its `contentType` (the same path-aware `/content/landing-blocks` the
 *    palette uses, instance mode).
 *  - `save(path, blocks)` -> merge-patch the page Package's `extras.blocks`
 *    (the same generic VFS write the page editor uses for variant metadata and
 *    the content field panels). The renderer reads `extras.blocks` live, so no
 *    republish is needed for the change to show on the public site.
 */
@Injectable({ providedIn: 'root' })
export class BlockEditorService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    fetch(path: string): Observable<LandingBlocksDto> {
        const url = `${this.apiBase}/content/landing-blocks?path=${encodeURIComponent(path)}`;
        return this.http.get<LandingBlocksDto>(url);
    }

    /**
     * Merge-patches the page's `extras.blocks`, only over the version the sections were read at (If-Match: a newer
     * version answers 412); answers the version the save wrote (its ETag).
     */
    save(path: string, blocks: readonly BlockModel[], version: string): Observable<string | null> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(path)}`;
        return this.http.patch(url, { path, extras: { blocks } }, {
            headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': `"${version}"` },
            observe: 'response',
        }).pipe(map(r => {
            const v = (r.headers.get('ETag') ?? '').replace(/^W\//, '').replace(/"/g, '').trim();
            return v === '' ? null : v;
        }));
    }
}
