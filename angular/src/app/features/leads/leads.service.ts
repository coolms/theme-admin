import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/** The three lead buckets, matching the backend `LeadStatus` enum. */
export type LeadStatus = 'new' | 'handled' | 'spam';

/** Inbound channel a lead arrived on, matching the backend `LeadChannel` enum. */
export type LeadChannel = 'web_form' | 'dynamic_chat' | 'email' | 'phone';

/**
 * W8.c — one captured lead.
 *
 * Mirrors the backend `Lead` read serialization group (`lead:read`): the
 * `website` honeypot is write-only and never arrives here. `source` is the
 * page URL the form was submitted from; `handledAt` is set once a lead leaves
 * the `new` bucket.
 */
export interface LeadDto {
    readonly id:        string;
    readonly formId:    string;
    /** Inbound channel (derived server-side from `formId`); drives the grid's Channel badge + facet. */
    readonly channel:   LeadChannel;
    readonly name:      string;
    readonly email:     string;
    /** Captured contact phone in canonical E.164 (DynamicChat/Call pre-chat); null when none. */
    readonly phone?:        string | null;
    /** Human-readable international form of {@link phone} (server-resolved); null when unformattable. */
    readonly phoneDisplay?: string | null;
    readonly message:   string;
    readonly source:    string | null;
    readonly status:    LeadStatus;
    /** C.5: the Contact this lead's submitter was de-duplicated into (soft ref); null when unlinked. */
    readonly contactId?:    string | null;
    /** The lead's live DynamicChat conversation id (single-lead read only); null -> no live chat to open. */
    readonly conversationId?: string | null;
    readonly createdAt: string;
    readonly handledAt: string | null;
}

/**
 * W8.c — the lead-inbox admin API client.
 *
 * Talks to the W8.a endpoints (`GET /leads?status=`,
 * `POST /leads/{id}/handle|spam|reopen`) off the generic `manifest.apiBase`,
 * so no module-specific manifest entry is needed. Feature-local (not on the
 * shared ApiService) — the lead surface is small and self-contained. Mirrors
 * the W7.d ModerationService.
 */
@Injectable({ providedIn: 'root' })
export class LeadsService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        // The manifest is loaded before any admin route activates; the `?.`/fallback
        // keeps the build's strict null-check happy (the snapshot type is nullable).
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /**
     * One PAGE of a lead bucket — newest-first, server-filtered and sorted
     *.
     *
     * Replaces the old `list()`, which fetched a whole bucket in one request for
     * a client-mode grid. The endpoint capped that at 200 rows, so the browser
     * was filtering a truncated window and calling it the complete queue.
     *
     * `status` is the tab SCOPE and `filters` are the grid's column filters:
     * they compose, narrowing within the selected bucket. Filters go through
     * VERBATIM — the endpoint is RQL-native and its allowlist comes from the
     * same `lead:list` YAML that renders the filter row.
     */
    listPage(opts: {
        status:    LeadStatus;
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    }): Observable<{ items: LeadDto[]; totalItems: number }> {
        let params = new HttpParams()
            .set('status', opts.status)
            .set('page', String(opts.page ?? 1))
            .set('limit', String(opts.pageSize ?? 50));

        if (opts.sort) params = params.set('sort', opts.sort);
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') params = params.append('filter', f);
        }

        return this.http
            .get<HydraCollection<LeadDto>>(`${this.apiBase}/leads`, { params })
            .pipe(map(res => ({ items: res.member ?? [], totalItems: res.totalItems ?? 0 })));
    }

    /** One lead by id — the admin detail view (`GET /leads/{id}`; 404 if absent). */
    get(id: string): Observable<LeadDto> {
        return this.http.get<LeadDto>(`${this.apiBase}/leads/${encodeURIComponent(id)}`);
    }

    /** All of a Contact's leads across every channel, newest-first (the Contact hub). */
    byContact(contactId: string): Observable<LeadDto[]> {
        return this.http
            .get<HydraCollection<LeadDto>>(`${this.apiBase}/leads`, {
                params: new HttpParams().set('contactId', contactId),
            })
            .pipe(map(res => res.member ?? []));
    }

    /** New -> Handled (a lead you've actioned). */
    handle(id: string): Observable<LeadDto> {
        return this.http.post<LeadDto>(`${this.apiBase}/leads/${encodeURIComponent(id)}/handle`, {});
    }

    /** New -> Spam. */
    spam(id: string): Observable<LeadDto> {
        return this.http.post<LeadDto>(`${this.apiBase}/leads/${encodeURIComponent(id)}/spam`, {});
    }

    /** Handled / Spam -> New (back into the actionable queue). */
    reopen(id: string): Observable<LeadDto> {
        return this.http.post<LeadDto>(`${this.apiBase}/leads/${encodeURIComponent(id)}/reopen`, {});
    }
}
