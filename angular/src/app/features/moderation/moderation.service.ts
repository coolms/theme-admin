import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/**
 * W7.d — one pending comment awaiting moderation.
 *
 * Mirrors the backend `Comment` read serialization group (`comment:read`):
 * the author email + honeypot are write-only and never arrive here.
 */
export interface PendingCommentDto {
    readonly id:         string;
    readonly postId:     string;
    readonly parentId:   string | null;
    readonly authorName: string;
    readonly body:       string;
    readonly status:     string;
    readonly createdAt:  string;
}

/**
 * W7.d — the comment-moderation queue admin API client.
 *
 * Talks to the W7.a endpoints (`GET /moderation/comments`,
 * `POST /comments/{id}/approve|reject`) off the generic `manifest.apiBase`,
 * so no module-specific manifest entry is needed. Feature-local (not on the
 * shared ApiService) — the moderation surface is small and self-contained.
 */
@Injectable({ providedIn: 'root' })
export class ModerationService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        // The manifest is loaded before any admin route activates; the `?.`/fallback
        // keeps the build's strict null-check happy (the snapshot type is nullable).
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /**
     * One PAGE of the moderation queue — newest-first, server-filtered and
     * sorted (#1724).
     *
     * Replaces the old `listPending()`, which fetched the whole queue for a
     * client-mode grid. The endpoint capped that at 200 rows, so the browser was
     * filtering a truncated backlog and calling it complete — harmless on a
     * drained queue, and broken during exactly the spam flood a moderator needs
     * it for.
     *
     * `filters` go through VERBATIM — the endpoint is RQL-native and its
     * allowlist comes from the same `comment:moderation` YAML that renders the
     * filter row.
     */
    listPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: PendingCommentDto[]; totalItems: number }> {
        let params = new HttpParams()
            .set('page', String(opts.page ?? 1))
            .set('limit', String(opts.pageSize ?? 50));

        if (opts.sort) params = params.set('sort', opts.sort);
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') params = params.append('filter', f);
        }

        return this.http
            .get<HydraCollection<PendingCommentDto>>(`${this.apiBase}/moderation/comments`, { params })
            .pipe(map(res => ({ items: res.member ?? [], totalItems: res.totalItems ?? 0 })));
    }

    approve(id: string): Observable<PendingCommentDto> {
        return this.http.post<PendingCommentDto>(`${this.apiBase}/comments/${encodeURIComponent(id)}/approve`, {});
    }

    reject(id: string): Observable<PendingCommentDto> {
        return this.http.post<PendingCommentDto>(`${this.apiBase}/comments/${encodeURIComponent(id)}/reject`, {});
    }
}
