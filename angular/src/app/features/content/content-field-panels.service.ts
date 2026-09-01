import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/**
 * The front-end widget descriptor a module contributes for a field type
 * (field-widget registry). Present only when an installed module provides a
 * richer input for the field's `type`; `kind` keys the FE component.
 */
export interface FieldWidgetDescriptorDto {
    readonly kind: string;
    readonly [key: string]: unknown;
}

/** One editable field inside a {@link ContentFieldPanelDto}. */
export interface ContentFieldDescriptorDto {
    readonly name: string;
    readonly type: string;
    readonly label: string;
    readonly locked: boolean;
    /** Module-contributed widget for this field's type, or absent for the built-in input. */
    readonly widget?: FieldWidgetDescriptorDto;
}

/** A labelled group of fields (e.g. "SEO", "Blog") — field set. */
export interface ContentFieldPanelDto {
    readonly group: string;
    readonly label: string;
    readonly fields: readonly ContentFieldDescriptorDto[];
}

/** Response of `GET /api/v1/content/field-panels?path=`. */
export interface ContentFieldPanelsDto {
    readonly path: string;
    readonly contentType?: string | null;
    readonly panels: readonly ContentFieldPanelDto[];
    /** Current value per field name (from the node's extras). */
    readonly values: Record<string, unknown>;
}

/**
 * Data layer for the module-contributed content field panels (, W1.c/d).
 *
 *  - `fetch(path)` -> the panels + current values that apply to the node.
 *  - `save(path, extras)` -> merge-patch the node's extras (same generic VFS
 *    write the page editor uses for variant metadata).
 */
@Injectable({ providedIn: 'root' })
export class ContentFieldPanelsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    fetch(path: string): Observable<ContentFieldPanelsDto> {
        const url = `${this.apiBase}/content/field-panels?path=${encodeURIComponent(path)}`;
        return this.http.get<ContentFieldPanelsDto>(url);
    }

    save(path: string, extras: Record<string, unknown>): Observable<unknown> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(path)}`;
        return this.http.patch(url, { path, extras }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
