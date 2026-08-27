import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/** One field of a {@link BlockTypeSchemaDto} — kind drives the editor widget. */
export interface BlockFieldSchemaDto {
    readonly name: string;
    /** 'text' | 'textarea' | 'url' | 'group'. */
    readonly kind: string;
    /** Typed sub-fields when `kind === 'group'` (W5.e); empty otherwise. */
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
    /** The page's current normalized sections (instance mode). */
    readonly blocks: readonly BlockModel[];
    /** The page's content-type discriminator (`'landing'` enables the editor). */
    readonly contentType?: string | null;
    readonly path?: string | null;
}

/**
 * Data layer for the W5.d landing-page block editor (ADR-130).
 *
 *  - `fetch(path)` → the block-type catalog + the page's current sections +
 *    its `contentType` (the same path-aware `/content/landing-blocks` the
 *    palette uses, instance mode).
 *  - `save(path, blocks)` → merge-patch the page Package's `extras.blocks`
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

    save(path: string, blocks: readonly BlockModel[]): Observable<unknown> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(path)}`;
        return this.http.patch(url, { path, extras: { blocks } }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
