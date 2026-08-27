import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import type {
    CreateImageMapRequest, CreateRegionRequest, ImageMapDto, ImageMapRegionDto,
    UpdateImageMapRequest, UpdateRegionRequest,
} from './image-map.types';

/**
 * CRUD client for the ImageMap API (`/api/v1/image-maps`, #1523–#1525).
 * Collection reads unwrap the Hydra `member` envelope; writes use the
 * platform content-types (POST `application/ld+json`, PATCH
 * `application/merge-patch+json` — the #1039 415 footgun).
 */
@Injectable({ providedIn: 'root' })
export class ImageMapService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    listImageMaps(): Observable<ImageMapDto[]> {
        return this.http
            .get<HydraCollection<ImageMapDto>>(`${this.apiBase}/image-maps`)
            .pipe(map(r => r.member));
    }

    getImageMap(slug: string): Observable<ImageMapDto> {
        return this.http.get<ImageMapDto>(`${this.apiBase}/image-maps/${encodeURIComponent(slug)}`);
    }

    /**
     * The per-region status class map (`{ "<code>": "<css class>" }`) from any
     * registered RegionStatusProvider — used by the authoring page for a live
     * busy/free tint preview. `now` scopes to the current instant (else "today").
     */
    getRegionStatus(slug: string, now = true): Observable<Record<string, string>> {
        return this.http.get<Record<string, string>>(
            `${this.apiBase}/image-maps/${encodeURIComponent(slug)}/status`,
            { params: now ? { now: '1' } : {} },
        );
    }

    createImageMap(data: CreateImageMapRequest): Observable<ImageMapDto> {
        return this.http.post<ImageMapDto>(`${this.apiBase}/image-maps`, data, {
            headers: { 'Content-Type': 'application/ld+json' },
        });
    }

    updateImageMap(slug: string, patch: UpdateImageMapRequest): Observable<ImageMapDto> {
        return this.http.patch<ImageMapDto>(
            `${this.apiBase}/image-maps/${encodeURIComponent(slug)}`,
            patch,
            { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
    }

    deleteImageMap(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/image-maps/${encodeURIComponent(slug)}`);
    }

    // --- Regions (write-only sub-resource; reads stay on the map's ---
    // --- embedded `regions[]` — refresh via getImageMap after saves) ---

    addRegion(slug: string, region: CreateRegionRequest): Observable<ImageMapRegionDto> {
        return this.http.post<ImageMapRegionDto>(
            `${this.apiBase}/image-maps/${encodeURIComponent(slug)}/regions`,
            region,
            { headers: { 'Content-Type': 'application/ld+json' } },
        );
    }

    updateRegion(slug: string, code: string, patch: UpdateRegionRequest): Observable<ImageMapRegionDto> {
        return this.http.patch<ImageMapRegionDto>(
            `${this.apiBase}/image-maps/${encodeURIComponent(slug)}/regions/${encodeURIComponent(code)}`,
            patch,
            { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
    }

    deleteRegion(slug: string, code: string): Observable<void> {
        return this.http.delete<void>(
            `${this.apiBase}/image-maps/${encodeURIComponent(slug)}/regions/${encodeURIComponent(code)}`,
        );
    }
}
