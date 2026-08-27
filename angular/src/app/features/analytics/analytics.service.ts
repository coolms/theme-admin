import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/**
 * W8 — one "top page" row.
 *
 * Mirrors the backend `PageView` read serialization group (`pageview:read`):
 * a normalized request `path` plus its aggregate view `count`. The backend
 * stores no personal data — these rows are a `GROUP BY path COUNT(*)` over the
 * window, so there is nothing else to surface.
 */
export interface TopPageDto {
    readonly path:  string;
    readonly views: number;
}

/**
 * W3.3.c — one search-analytics row (#816).
 *
 * Mirrors the backend `SearchQueryStat` read group (`search_stat:read`): a
 * normalized search `term` plus its aggregate `searches` count over the window.
 * Used for both the "top queries" leaderboard and the "zero-result queries"
 * content-gap list — the two share this shape, differing only in which
 * aggregate the backend runs.
 */
export interface SearchQueryStatDto {
    readonly term:     string;
    readonly searches: number;
}

/**
 * Track E — one event-stream summary row (#1057/#1070).
 *
 * Mirrors the backend `AnalyticsEventSummary` collection
 * (`GET /analytics/events/summary?days=`): an event `type` (lowercase dotted,
 * e.g. `pageview` / `lead.submit`) plus its total `count` over the window,
 * busiest-type first. Counts only — the generic store is privacy-safe by
 * construction (no IP / UA / durable identity).
 */
export interface EventSummaryDto {
    readonly type:  string;
    readonly count: number;
}

/**
 * W8 — the analytics dashboard admin API client.
 *
 * Talks to two privacy-first ledgers off the generic `manifest.apiBase` (so no
 * module-specific manifest entry is needed):
 *  - the page-view ledger (`GET /analytics/top-pages?days=&limit=`, #780), and
 *  - the search-query log (`GET /search/analytics/{top-queries,
 *    zero-result-queries}?days=&limit=`, #816).
 *
 * Feature-local (not on the shared ApiService) — the analytics surface is small
 * and self-contained. Mirrors the W7.d ModerationService / W8.c LeadsService.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        // The manifest is loaded before any admin route activates; the `?.`/fallback
        // keeps the build's strict null-check happy (the snapshot type is nullable).
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Shared `?days=&limit=` query string for every analytics read. */
    private windowParams(days: number, limit: number): HttpParams {
        return new HttpParams()
            .set('days', String(days))
            .set('limit', String(limit));
    }

    /**
     * The most-viewed paths over the last `days`, busiest-first (server-ordered).
     * The backend clamps `days`/`limit` to sane bounds (defaults 30 days / 20 rows).
     */
    topPages(days: number, limit: number): Observable<TopPageDto[]> {
        return this.http
            .get<HydraCollection<TopPageDto>>(`${this.apiBase}/analytics/top-pages`, {
                params: this.windowParams(days, limit),
            })
            .pipe(map(res => res.member ?? []));
    }

    /**
     * The most-frequent search terms over the last `days`, busiest-first
     * (server-ordered). Same clamping as {@link topPages}.
     */
    topQueries(days: number, limit: number): Observable<SearchQueryStatDto[]> {
        return this.http
            .get<HydraCollection<SearchQueryStatDto>>(`${this.apiBase}/search/analytics/top-queries`, {
                params: this.windowParams(days, limit),
            })
            .pipe(map(res => res.member ?? []));
    }

    /**
     * Search terms whose searches returned nothing over the last `days` — the
     * actionable content-gap signal ("what to write next"), busiest-first.
     */
    zeroResultQueries(days: number, limit: number): Observable<SearchQueryStatDto[]> {
        return this.http
            .get<HydraCollection<SearchQueryStatDto>>(`${this.apiBase}/search/analytics/zero-result-queries`, {
                params: this.windowParams(days, limit),
            })
            .pipe(map(res => res.member ?? []));
    }

    /**
     * Per-type totals over the generic Track E event stream (#1057/#1070) for
     * the last `days`, busiest-type first (server-ordered). The backend clamps
     * `days` to 1..365 (default 30); there is no `limit` — the type set is small
     * and bounded, so the whole window is returned.
     */
    eventSummary(days: number): Observable<EventSummaryDto[]> {
        return this.http
            .get<HydraCollection<EventSummaryDto>>(`${this.apiBase}/analytics/events/summary`, {
                params: new HttpParams().set('days', String(days)),
            })
            .pipe(map(res => res.member ?? []));
    }
}
