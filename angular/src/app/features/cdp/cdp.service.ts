import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import { SegmentDto, SegmentRuleCheckDto, SegmentWriteDto, SubjectDto } from './cdp.types';

/**
 * Track E Phase 3 (CDP core, #1150) — admin API client for the Customer Data
 * Platform surfaces.
 *
 * Feature-local (not on the shared ApiService), mirroring {@link
 * ../analytics/analytics.service}: the CDP surface is small, self-contained,
 * and lives off the generic `manifest.apiBase` (no module-specific manifest
 * entry). Talks to two ledgers, both `ROLE_ADMIN`:
 *  - audience Segments — `/analytics/segments` (CRUD + `/validate`);
 *  - Subject profiles — `/analytics/subjects` (read-only, counts-only).
 */
@Injectable({ providedIn: 'root' })
export class CdpService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    // Collection GETs ask for JSON-LD so API Platform returns member/totalItems.
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    // API-Platform PATCH ops require merge-patch (else 415) — see ApiService.patchHeaders.
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    // ── Segments ──────────────────────────────────────────────────────────────

    listSegments(): Observable<SegmentDto[]> {
        return this.http
            .get<HydraCollection<SegmentDto>>(`${this.apiBase}/analytics/segments`, this.collectionHeaders)
            .pipe(map(res => res.member ?? []));
    }

    getSegment(key: string): Observable<SegmentDto> {
        return this.http.get<SegmentDto>(`${this.apiBase}/analytics/segments/${encodeURIComponent(key)}`);
    }

    createSegment(dto: SegmentWriteDto): Observable<SegmentDto> {
        return this.http.post<SegmentDto>(`${this.apiBase}/analytics/segments`, dto);
    }

    updateSegment(key: string, dto: SegmentWriteDto): Observable<SegmentDto> {
        return this.http.patch<SegmentDto>(
            `${this.apiBase}/analytics/segments/${encodeURIComponent(key)}`,
            dto,
            this.patchHeaders,
        );
    }

    deleteSegment(key: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/analytics/segments/${encodeURIComponent(key)}`);
    }

    /**
     * Live rule-lint — the SAME lint the create/update path enforces, so a rule
     * that validates here will not 400 on save. 200 in both verdicts (an invalid
     * RULE is a valid REQUEST); the caller reads `valid` + `message`.
     */
    validateRule(rule: string): Observable<SegmentRuleCheckDto> {
        return this.http.post<SegmentRuleCheckDto>(`${this.apiBase}/analytics/segments/validate`, { rule });
    }

    // ── Subjects ──────────────────────────────────────────────────────────────

    /**
     * One SERVER page of subjects (ledger #1662). Filters travel as repeated
     * `filter=` RQL terms — the endpoint is RQL-native, so the grid's
     * `columnFilters` go through verbatim, including the Segments multi-select
     * (`segments in [...]`), which the provider lifts out and turns into a JSON
     * membership test.
     *
     * `segment` stays a separate param: it is the segment page's "View members"
     * deep-link, independent of whatever the operator has typed into the filter
     * row.
     *
     * Replaces the old unpaged `listSubjects()`, which fetched EVERY subject —
     * one row per visitor — so the grid could filter in the browser.
     */
    listSubjectsPage(params: {
        page?:    number;
        perPage?: number;
        sort?:    string;
        filters?: readonly string[];
        segment?: string;
    } = {}): Observable<{ items: SubjectDto[]; totalItems: number }> {
        let httpParams = new HttpParams();
        if (params.perPage)               httpParams = httpParams.set('limit', String(params.perPage));
        if (params.page && params.page > 1) httpParams = httpParams.set('page', String(params.page));
        if (params.sort)                  httpParams = httpParams.set('sort', params.sort);
        if (params.segment)               httpParams = httpParams.set('segment', params.segment);
        for (const f of params.filters ?? []) {
            // Repeated `filter=…` keys — RqlParser collects all of them as AND conditions.
            httpParams = httpParams.append('filter', f);
        }

        return this.http
            .get<HydraCollection<SubjectDto>>(`${this.apiBase}/analytics/subjects`, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(res => ({
                items:      res.member ?? [],
                totalItems: res.totalItems ?? (res.member?.length ?? 0),
            })));
    }

    getSubject(key: string): Observable<SubjectDto> {
        return this.http.get<SubjectDto>(`${this.apiBase}/analytics/subjects/${encodeURIComponent(key)}`);
    }
}
