import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/** Payload for `POST /api/v1/content/collections` (, W5.g). */
export interface CreateCollectionRequest {
    readonly slug: string;
    readonly label?: string;
    /** Defaults to `slug` on the backend. */
    readonly collectionType?: string;
    /** Defaults to `{collectionType}_post` on the backend. */
    readonly postContentType?: string;
    readonly listTemplate?: string;
    /** Module field-set group ids the collection opts into (e.g. ['seo','blog']). */
    readonly fieldSets?: readonly string[];
    readonly requiresReview?: boolean;
    /** Opt-in to the persistent-sidebar docs reading layout (W4.a). */
    readonly sidebarNav?: boolean;
}

/** Response of the collection-create endpoint. */
export interface CollectionDto {
    readonly id: string;
    readonly slug: string;
    readonly label: string;
    readonly vfsPath: string | null;
    readonly collectionType: string;
    readonly postContentType: string;
    readonly sidebarNav: boolean;
}

/**
 * The M6.a distribution config on a collection: which outbound
 * channels a published post fans out to + per-channel settings. `isCollection`
 * is false when the target dir isn't actually a content collection, so the UI
 * can degrade gracefully.
 */
export interface CollectionDistribution {
    readonly enabledChannels: readonly string[];
    readonly channelConfig: Record<string, Record<string, unknown>>;
    readonly isCollection: boolean;
}

/** Payload for `PATCH /api/v1/content/collections/distribution`. */
export interface SetCollectionDistributionRequest {
    readonly path: string;
    readonly enabledChannels: readonly string[];
    readonly channelConfig: Record<string, unknown>;
}

/**
 * A section's own settings — what the posts inside it ARE, as opposed
 * to {@link CollectionDistribution}, which is where a published one goes.
 *
 * `isCollection` false means the directory was never declared: it lists and
 * renders fine, but it has no post type and **no syndication feed**, because
 * `PublicFeedController` only serves paths the backend recognises as a
 * collection.
 */
export interface CollectionSettings {
    readonly collectionType: string;
    readonly postContentType: string;
    readonly requiresReview: boolean;
    readonly sidebarNav: boolean;
    readonly isCollection: boolean;
}

/**
 * One setting a channel declares it needs, mirroring
 * `App\Core\Domain\Channel\ChannelConfigField`.
 *
 * `type: 'secretRef'` means the value is the NAME of a stored secret, not the
 * secret itself — so it displays and round-trips like any other text.
 * There is deliberately no "raw credential" field kind: per-section config is
 * persisted in the collection Node's `extras`, so a live token could never sit
 * here safely no matter how the input was rendered.
 */
export interface ChannelConfigField {
    readonly key: string;
    readonly label: string;
    readonly type: string;
    readonly required: boolean;
    readonly help: string;
    readonly placeholder: string;
}

/** An enabled channel and what it needs configured — `GET /outbound-channels`. */
export interface OutboundChannelDto {
    readonly id: string;
    readonly label: string;
    readonly fields: readonly ChannelConfigField[];
}

/**
 * Payload for `PATCH /api/v1/content/collections/settings`.
 *
 * Every field but `path` is optional and omitted-means-unchanged, so the dialog
 * can send only what the user touched.
 */
export interface SetCollectionSettingsRequest {
    readonly path: string;
    readonly collectionType?: string;
    readonly postContentType?: string;
    readonly requiresReview?: boolean;
    readonly sidebarNav?: boolean;
}

/**
 * Data layer for content collections (, W5.g). A collection is a
 * declared directory Node under the site's content root whose `extras` tell
 * the platform how its child posts behave (post content-type, templates,
 * field sets, sidebar). Mints one via the Content-owned create endpoint; the
 * directory then appears as a row in the Pages tree, and posts created inside
 * it inherit the collection's `postContentType`.
 */
@Injectable({ providedIn: 'root' })
export class CollectionService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    create(data: CreateCollectionRequest): Observable<CollectionDto> {
        const url = `${this.apiBase}/content/collections`;
        return this.http.post<CollectionDto>(url, data, {
            headers: { 'Content-Type': 'application/ld+json' },
        });
    }

    /**
     * Read a collection's current distribution config. There is no dedicated
     * read endpoint — the generic node-meta endpoint already returns the full
     * `extras` bag, so we project the two distribution keys out of it (and use
     * `collectionType`'s presence to confirm the dir IS a content collection).
     */
    getDistribution(vfsPath: string): Observable<CollectionDistribution> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(vfsPath)}`;
        return this.http.get<{ extras?: Record<string, unknown> }>(url).pipe(
            map(node => {
                const extras = node.extras ?? {};
                const rawChannels = extras['enabledChannels'];
                const rawConfig = extras['channelConfig'];
                const rawType = extras['collectionType'];

                return {
                    enabledChannels: Array.isArray(rawChannels)
                        ? rawChannels.filter((v): v is string => typeof v === 'string')
                        : [],
                    channelConfig: (rawConfig && typeof rawConfig === 'object')
                        ? rawConfig as Record<string, Record<string, unknown>>
                        : {},
                    isCollection: typeof rawType === 'string' && rawType !== '',
                };
            }),
        );
    }

    /**
     * The enabled outbound channels and what each one needs configured.
     *
     * Distinct from the `core.outbound_channels` option source the picker reads:
     * that answers "what may I pick", this answers "and what must I then fill
     * in". Both are served off the same gated registry, so they never disagree
     * about which channels exist.
     */
    listChannels(): Observable<readonly OutboundChannelDto[]> {
        const url = `${this.apiBase}/outbound-channels`;

        return this.http.get<{ member?: OutboundChannelDto[] } | OutboundChannelDto[]>(url).pipe(
            map(res => (Array.isArray(res) ? res : res.member ?? [])),
        );
    }

    /** Write the distribution config (API-Platform PATCH -> merge-patch, else 415). */
    setDistribution(req: SetCollectionDistributionRequest): Observable<unknown> {
        const url = `${this.apiBase}/content/collections/distribution`;
        return this.http.patch(url, req, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    /**
     * Read a section's settings — same trick as `getDistribution`: the
     * node-meta endpoint returns the whole `extras` bag, so both reads are one
     * projection each and neither needs an endpoint of its own.
     *
     * `isCollection` is `collectionType`'s presence, which is also what decides
     * whether the section has a syndication feed at all.
     */
    getSettings(vfsPath: string): Observable<CollectionSettings> {
        const url = `${this.apiBase}/vfs/files?path=${encodeURIComponent(vfsPath)}`;

        return this.http.get<{ extras?: Record<string, unknown> }>(url).pipe(
            map(node => {
                const extras = node.extras ?? {};
                const str = (key: string): string => {
                    const v = extras[key];

                    return 'string' === typeof v ? v : '';
                };

                return {
                    collectionType: str('collectionType'),
                    postContentType: str('postContentType'),
                    requiresReview: true === extras['requiresReview'],
                    sidebarNav: true === extras['sidebarNav'],
                    isCollection: '' !== str('collectionType'),
                };
            }),
        );
    }

    /**
     * Write the section settings. Passing `collectionType` for a plain
     * directory PROMOTES it into a content collection — which is what gives the
     * section a feed.
     */
    setSettings(req: SetCollectionSettingsRequest): Observable<unknown> {
        const url = `${this.apiBase}/content/collections/settings`;

        return this.http.patch(url, req, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
