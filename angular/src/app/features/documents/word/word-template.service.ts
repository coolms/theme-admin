import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { type DocumentTemplate } from '../shared/document-explorer.types';

interface HydraCollection<T> {
    'hydra:member'?: T[];
    member?: T[];
    'hydra:totalItems'?: number;
    totalItems?: number;
}

/**
 * Word-format thin CRUD wrapper over `/api/v1/document/templates`.
 *
 * F.14c-1 renamed this from `DocumentTemplateService` (F.13b) to
 * `WordTemplateService` and parked it in the Word feature module so
 * future format modules (Spreadsheet, Markdown) can each ship their
 * own equivalent without colliding with this one — even though the
 * backend endpoint is shared. The aggregator
 * (`DocumentAggregatorService` in `explorer/`) drives cross-format
 * listing; this service stays for any Word-only call shape we add
 * later (e.g. Word-specific download URL helpers).
 *
 * Document templates use API Platform, so list responses arrive in
 * JSON-LD Hydra collection shape — `unwrap()` normalises to a plain
 * array regardless of which JSON-LD context variant the server
 * emits.
 *
 * The service deliberately does not poll, cache, or signal-hold
 * results — page-level state belongs in `DocumentPageStateService`.
 */
@Injectable({ providedIn: 'root' })
export class WordTemplateService {
    private readonly http = inject(HttpClient);

    /**
     * Create an empty NATIVE template.
     *
     * The named format yields a node of that format's native source mime
     * under the space's `.templates/` — `text/x-dtmpl` for `'word'`,
     * `application/x-coolms-sheet+json` for `'spreadsheet'`. Verified on the
     * wire: the created template comes back `native: true` with a `path`,
     * which is what makes it immediately openable in the editor registered
     * for that mime. The space is resolved server-side, so callers do not
     * pass a path.
     *
     * `format` is a PARAMETER rather than the hard-coded `'word'` it was
     * through –: the backend has minted native spreadsheets since
     * and renders and edits them, but nothing could ask
     * for one. Callers should source the value from
     * `FormatInfoService.nativeAuthoringFormats()` — the backend's own list
     * of formats with native authoring — so this stays the only place that
     * needs to know the endpoint, and neither place needs to know the
     * formats. A format the provider cannot author natively is refused with
     * a 422.
     *
     * — sends the NAME only. The slug is derived server-side by the
     * platform slugger, with national transliteration, so a template can
     * be called `Счета` and still be `scheta.dtmpl` on disk. An explicit
     * `slug` is still accepted by the endpoint for callers that own one.
     */
    createNative(name: string, format: string): Observable<DocumentTemplate> {
        return this.http.post<DocumentTemplate>(
            '/api/v1/document/templates',
            { name, format },
            { headers: { 'Content-Type': 'application/ld+json', Accept: 'application/ld+json' } },
        );
    }

    list(): Observable<DocumentTemplate[]> {
        return new Observable<DocumentTemplate[]>((subscriber) => {
            this.http
                .get<HydraCollection<DocumentTemplate> | DocumentTemplate[]>(
                    '/api/v1/document/templates',
                )
                .subscribe({
                    next: (response) => {
                        subscriber.next(this.unwrap(response));
                        subscriber.complete();
                    },
                    error: (err) => subscriber.error(err),
                });
        });
    }

    get(id: string): Observable<DocumentTemplate> {
        return this.http.get<DocumentTemplate>(
            `/api/v1/document/templates/${encodeURIComponent(id)}`,
        );
    }

    delete(id: string): Observable<void> {
        return this.http.delete<void>(
            `/api/v1/document/templates/${encodeURIComponent(id)}`,
        );
    }

    /**
     * F.14c-3a — PATCH editable metadata. Backend whitelists fields
     * and validates `instanceNameSuffix` as DTMPL syntax (422 on parse
     * failure) + `defaultOutputFormat` against the template format's
     * allow list.
     */
    update(id: string, payload: UpdateTemplatePayload): Observable<DocumentTemplate> {
        return this.http.patch<DocumentTemplate>(
            `/api/v1/document/templates/${encodeURIComponent(id)}`,
            payload,
            { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
    }

    /**
     * F.14c-3b — parses the uploaded replacement WITHOUT committing.
     * Backend MIME-checks against template format and returns the
     * schema-diff classification + per-variable lists so the Replace
     * dialog can render its preview.
     */
    previewReplace(id: string, file: File): Observable<ReplacePreviewResponse> {
        const fd = new FormData();
        fd.append('file', file);
        return this.http.post<ReplacePreviewResponse>(
            `/api/v1/document/templates/${encodeURIComponent(id)}/replace-preview`,
            fd,
        );
    }

    /**
     * F.14c-3b — commits the replacement: writes new file to VFS
     * (overwrites the template's source) and applies the adaptive
     * contextSchema policy (no-op / merge / full replace) based on the
     * server's classification. Returns the updated template.
     */
    commitReplace(id: string, file: File): Observable<DocumentTemplate> {
        const fd = new FormData();
        fd.append('file', file);
        return this.http.post<DocumentTemplate>(
            `/api/v1/document/templates/${encodeURIComponent(id)}/replace`,
            fd,
        );
    }

    private unwrap(
        response: HydraCollection<DocumentTemplate> | DocumentTemplate[],
    ): DocumentTemplate[] {
        if (Array.isArray(response)) {
            return response;
        }
        return response['hydra:member'] ?? response.member ?? [];
    }
}

/**
 * F.14c-3a -- partial-update payload for the Edit Template form.
 * Fields are optional; backend whitelists `name` / `description` /
 * `instanceNameSuffix` / `defaultOutputFormat` / `publiclyAccessible`
 * for this caller.
 */
export interface UpdateTemplatePayload {
    name?: string;
    description?: string | null;
    instanceNameSuffix?: string | null;
    defaultOutputFormat?: string;
    /**
     * Phase 1b-3 widget track -- admin opt-in for anonymous public
     * widget renders. Omit to leave the field unchanged; pass
     * true / false to flip it explicitly.
     */
    publiclyAccessible?: boolean;
}

/**
 * F.14c-3b — Replace-preview endpoint response shape.
 */
export interface ReplacePreviewResponse {
    classification: 'compatible' | 'extended' | 'different';
    newVariables: string[];
    existingVariables: string[];
    added: string[];
    removed: string[];
    unchanged: string[];
}
