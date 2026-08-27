import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { type DocumentTemplate } from '../shared/document-explorer.types';

interface HydraCollection<T> {
    'hydra:member'?: T[];
    member?: T[];
}

/**
 * F.14c-1 — cross-format Document Explorer aggregator. Wraps the
 * F.14b unified endpoints so the explorer can list and create
 * templates without caring which format module owns the row.
 *
 * Per-format thin wrappers (`WordTemplateService` etc.) stay around
 * for format-specific call shapes (Word-only download URLs, future
 * Spreadsheet preview helpers, …); this service is the entry point
 * for cross-format work.
 */
/**
 * What a conversion produces. A template lands in the hidden templates folder
 * and is generated FROM; a document lands where the operator filed it and is
 * opened directly.
 */
export type NativeTarget = 'template' | 'document';

@Injectable({ providedIn: 'root' })
export class DocumentAggregatorService {
    private readonly http = inject(HttpClient);

    /**
     * Unified create-from-upload (F.14b). MIME-routes the multipart
     * body to the matching backend `DocumentFormatProviderInterface`.
     */
    uploadTemplate(
        file: File,
        folderPath: string,
        convert = false,
        target: NativeTarget = 'template',
    ): Observable<DocumentTemplate> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderPath', folderPath);
        // `convert` asks the backend to ALSO read the upload into its native
        // editable source, keeping the original beside it. Sent only when
        // asked for: the backend ignores it where the format cannot convert,
        // but not sending it keeps the common upload's body unchanged.
        if (convert) {
            formData.append('convert', '1');
            // What the conversion should PRODUCE. Sent only alongside
            // `convert`, because on its own it means nothing and a field the
            // server must ignore is a field someone later assumes is read.
            formData.append('target', target);
        }

        return this.http.post<DocumentTemplate>(
            '/api/v1/document/templates/upload',
            formData,
        );
    }

    /**
     * List templates across formats. Backend returns the polymorphic
     * `AbstractTemplate` shape with the `format` field set per row;
     * the grid dispatches icons/colours by that key.
     */
    listTemplates(): Observable<DocumentTemplate[]> {
        return this.http
            .get<HydraCollection<DocumentTemplate> | DocumentTemplate[]>(
                '/api/v1/document/templates',
            )
            .pipe(
                map((response) => {
                    if (Array.isArray(response)) {
                        return response;
                    }
                    return response['hydra:member'] ?? response.member ?? [];
                }),
            );
    }

    getTemplate(id: string): Observable<DocumentTemplate> {
        return this.http.get<DocumentTemplate>(
            `/api/v1/document/templates/${encodeURIComponent(id)}`,
        );
    }

    deleteTemplate(id: string): Observable<void> {
        return this.http.delete<void>(
            `/api/v1/document/templates/${encodeURIComponent(id)}`,
        );
    }

    /**
     * F.14b replace endpoint. Wired here even though the dialog
     * lands in F.14c-3 — the aggregator API contract is complete
     * for the whole F.14c phase so callers don't need to chase a
     * second wrapper.
     */
    replaceTemplateSource(id: string, file: File): Observable<DocumentTemplate> {
        const formData = new FormData();
        formData.append('file', file);

        return this.http.post<DocumentTemplate>(
            `/api/v1/document/templates/${encodeURIComponent(id)}/replace`,
            formData,
        );
    }

    /**
     * Optional `?folder=` query for future grid filtering. Kept on
     * the API even though F.14c-1 doesn't drive it from the folders
     * tree — F.14c-3 wires the filter once the tree's selection
     * propagates.
     */
    listTemplatesInFolder(folderPath: string): Observable<DocumentTemplate[]> {
        const params = new HttpParams().set('folder', folderPath);

        return this.http
            .get<HydraCollection<DocumentTemplate> | DocumentTemplate[]>(
                '/api/v1/document/templates',
                { params },
            )
            .pipe(
                map((response) => {
                    if (Array.isArray(response)) {
                        return response;
                    }
                    return response['hydra:member'] ?? response.member ?? [];
                }),
            );
    }
}
