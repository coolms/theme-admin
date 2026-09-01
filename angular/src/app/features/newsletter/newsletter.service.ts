import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/** The three subscription buckets, matching the backend `SubscriptionStatus` enum. */
export type SubscriptionStatus = 'pending' | 'confirmed' | 'unsubscribed';

/**
 * W8 — one newsletter subscriber.
 *
 * Mirrors the backend `Subscriber` read group (`subscriber:read`): the
 * capability `token` and the `website` honeypot are never serialized here.
 * `source` is the page the signup happened on; `confirmedAt` is set once the
 * double-opt-in link is clicked.
 */
export interface SubscriberDto {
    readonly id:          string;
    readonly email:       string;
    readonly status:      SubscriptionStatus;
    readonly source:      string | null;
    readonly createdAt:   string;
    readonly confirmedAt: string | null;
}

/** W8 — the recorded result of a campaign broadcast (`campaign:read`). */
export interface CampaignDto {
    readonly id:             string;
    readonly subject:        string;
    /** The site this campaign was sent to; `''` is the default list. */
    readonly sectionSlug:    string;
    /** VFS paths of the files that rode along. */
    readonly attachments:    readonly string[];
    readonly recipientCount: number;
    readonly sentAt:         string | null;
    readonly createdAt:      string;
}

/**
 * One targetable list: a site slug, its label, and how many confirmed
 * subscribers it has right now.
 *
 * The count is what makes the compose picker honest — an admin can see they are
 * about to mail 4 people rather than 4000 before clicking Send.
 */
export interface NewsletterSiteDto {
    /** `''` is the install-wide default list, where every pre-split subscriber lives. */
    readonly slug:           string;
    readonly label:          string;
    readonly confirmedCount: number;
}

/**
 * W8 — the newsletter admin API client.
 *
 * Talks to the W8 endpoints (`GET /newsletter/subscribers?status=`,
 * `POST /newsletter/campaigns`) off the generic `manifest.apiBase`, so no
 * module-specific manifest entry is needed. Feature-local (not on the shared
 * ApiService) — the newsletter surface is small and self-contained. Mirrors the
 * W8.c LeadsService.
 */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        // The manifest is loaded before any admin route activates; the `?.`/fallback
        // keeps the build's strict null-check happy (the snapshot type is nullable).
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Subscribers in a bucket — newest-first (server-ordered). */
    /**
     * One PAGE of a subscriber bucket — newest-first, server-filtered and sorted
     *.
     *
     * Replaces the old `list()`, which fetched a whole bucket for a client-mode
     * grid. The endpoint capped that at 200 rows, so the browser was filtering a
     * truncated window and calling it the complete list.
     *
     * `filters` go through VERBATIM — the endpoint is RQL-native and its
     * allowlist comes from the same `newsletter:list` YAML that renders the
     * filter row.
     */
    listPage(opts: {
        status:    SubscriptionStatus;
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    }): Observable<{ items: SubscriberDto[]; totalItems: number }> {
        let params = new HttpParams()
            .set('status', opts.status)
            .set('page', String(opts.page ?? 1))
            .set('limit', String(opts.pageSize ?? 50));

        if (opts.sort) params = params.set('sort', opts.sort);
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') params = params.append('filter', f);
        }

        return this.http
            .get<HydraCollection<SubscriberDto>>(`${this.apiBase}/newsletter/subscribers`, { params })
            .pipe(map(res => ({ items: res.member ?? [], totalItems: res.totalItems ?? 0 })));
    }

    /**
     * Broadcast a campaign to ONE site's confirmed subscribers. Resolves
     * with the recorded campaign, whose `recipientCount` is how many emails were
     * queued.
     *
     * `sectionSlug` is required rather than optional: there is no all-sites send,
     * because mailing someone who subscribed to a different site is exactly the
     * complaint the per-site split exists to prevent. `''` is the install-wide
     * default list.
     */
    /**
     * @param contents      per-locale `{subject, body}` — one entry is a
     *                      single-language campaign, several make each recipient
     *                      receive the one resolved for them
     * @param defaultLocale which entry a recipient falls back to; must be present
     *                      in `contents`, or the server answers 422
     * @param attachments   VFS PATHS. The worker reads each under the composing
     *                      admin's own permissions (resolved server-side from the
     *                      token), so this cannot attach a file the sender could
     *                      not open.
     */
    sendCampaign(
        contents: Record<string, { subject: string; body: string }>,
        defaultLocale: string,
        sectionSlug: string,
        attachments: string[] = [],
    ): Observable<CampaignDto> {
        return this.http.post<CampaignDto>(`${this.apiBase}/newsletter/campaigns`, {
            contents, defaultLocale, sectionSlug, attachments,
        });
    }

    /** The lists an admin can target, each with its confirmed-recipient count. */
    listSites(): Observable<NewsletterSiteDto[]> {
        return this.http
            .get<{ member?: NewsletterSiteDto[] }>(`${this.apiBase}/newsletter/sites`)
            .pipe(map(res => res.member ?? []));
    }
}
