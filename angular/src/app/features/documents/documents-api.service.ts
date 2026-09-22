// Cut from the shell's api/api.service.ts on 2026-09-21: the Document (/document/generations, /document/instances) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type AudiencePreviewDto,
    type CreateDocumentGenerationPayload,
    type DocumentGenerationDto,
    type DocumentInstanceDto,
    type ListDocumentInstancesOptions,
} from './documents.types';

@Injectable({ providedIn: 'root' })
export class DocumentsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    /**
     * Preview the audience an RQL filter selects -- count plus a sample.
     *
     * Replaces `countUsers()`, which asked `GET /auth/users` for
     * `totalItems`. That endpoint returns a BARE ARRAY, so the read was
     * `undefined` on every call, for every filter, since the wizard shipped.
     * The recipients step's `canProceed` is `count > 0`, and `undefined > 0`
     * is false -- so typing ANY filter killed the Next button and Filter mode
     * could only ever be completed with an empty filter, i.e. "send to
     * everyone". Counting the returned rows instead would have been worse: the
     * endpoint pages at 20.
     *
     * `/document/generations/preview-audience` is the right call and already
     * existed. It runs the SAME `FilterAudienceMaterializer` the submit runs,
     * so the number the operator approves is the number that gets documents --
     * and it returns a `sample` so they can see WHO, not just how many.
     *
     * @param rqlBody raw query string from `CmsFilterBuilder`
     *                (`filter=expr1 and expr2`), or '' for "everyone"
     */
    previewDocumentAudience(entityType: string, rqlBody: string): Observable<AudiencePreviewDto> {
        return this.http.get<AudiencePreviewDto>(
            `${this.manifest.apiBase}/document/generations/preview-audience`,
            { params: new HttpParams().set('entityType', entityType).set('rql', rqlBody) },
        );
    }

    // -- DocumentGeneration --------------------------------------------------

    createDocumentGeneration(
        payload: CreateDocumentGenerationPayload,
    ): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + '/document/generations';
        return this.http.post<DocumentGenerationDto>(url, payload);
    }

    /**
     * Server-paginated list of generations for the admin list page.
     * Sort defaults to `-createdAt` server-side; pass `'createdAt'`
     * (asc) explicitly when the caller needs oldest-first.
     */
    listDocumentGenerations(
        params: { page?: number; limit?: number; sort?: string } = {},
    ): Observable<{ items: DocumentGenerationDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/generations';
        let httpParams = new HttpParams();
        if (params.page !== undefined) {
            httpParams = httpParams.set('page', String(params.page));
        }
        if (params.limit !== undefined) {
            httpParams = httpParams.set('limit', String(params.limit));
        }
        if (params.sort) {
            httpParams = httpParams.set('sort', params.sort);
        }
        return this.http
            .get<HydraCollection<DocumentGenerationDto>>(url, {
                headers: this.collectionHeaders.headers,
                params: httpParams,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Polling endpoint for the detail page. Returns the full generation
     * shape including counters, audience criteria, plain variables, and
     * (when `failedCount > 0`) the list of failed instance ids.
     */
    getDocumentGeneration(id: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(id)}/status`;
        return this.http.get<DocumentGenerationDto>(url);
    }

    /**
     * Re-dispatch every child instance in `failed` state for the given
     * generation. Returns the updated generation shape (`status` flipped
     * back to `running`, `failedCount` reset).
     */
    retryFailedInstances(generationId: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(generationId)}/retry-failed`;
        return this.http.post<DocumentGenerationDto>(url, {});
    }

    /**
     * Server-paginated instance list for the detail page's per-instance
     * grid (filter by `generationId`) or the template-detail panel
     * (filter by `templateId`). At least one of the two ids must be set
     * -- otherwise the backend falls through to the unfiltered legacy
     * branch and pagination is lost.
     */
    listDocumentInstances(
        options: ListDocumentInstancesOptions,
    ): Observable<{ items: DocumentInstanceDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/instances';
        let params = new HttpParams();
        if (options.generationId) {
            params = params.append('filter', `generationId eq "${options.generationId}"`);
        }
        if (options.templateId) {
            params = params.append('filter', `templateId eq "${options.templateId}"`);
        }
        if (options.status) {
            params = params.append('filter', `status eq "${options.status}"`);
        }
        if (options.outputFormat) {
            params = params.append('filter', `outputFormat eq "${options.outputFormat}"`);
        }
        if (options.search) {
            params = params.append('filter', `name cn "${options.search}"`);
        }
        if (options.sortKey) {
            const prefix = options.sortDir === 'asc' ? '' : '-';
            params = params.set('sort', `${prefix}${options.sortKey}`);
        }
        if (options.page !== undefined) {
            params = params.set('page', String(options.page));
        }
        if (options.limit !== undefined) {
            params = params.set('limit', String(options.limit));
        }
        return this.http
            .get<HydraCollection<DocumentInstanceDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }
}
