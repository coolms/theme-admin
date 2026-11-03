// Cut from the shell's api/api.service.ts on 2026-09-21: the Section (manifest.sections.*) and Web's sites (/web/sites), managed on the same page endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, resolvePattern, type HydraCollection } from '@coolms/core-angular';
import {
    type SiteSectionDto,
    type CreateSectionDto,
    type UpdateSectionDto,
    type SectionApplyResultDto,
    type SiteDto,
    type SiteMemberDto,
    type SiteScriptSourceDto,
    type AddSiteScriptSourceDto,
} from './sections.types';

@Injectable({ providedIn: 'root' })
export class SectionsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Sections ------------------------------------------------------------

    getSections(): Observable<SiteSectionDto[]> {
        return this.http
            .get<HydraCollection<SiteSectionDto>>(this.manifest.sections!.list, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    createSection(dto: CreateSectionDto): Observable<SiteSectionDto> {
        return this.http.post<SiteSectionDto>(this.manifest.sections!.create, dto);
    }

    /** One section, whole: its other hosts and its redirect included, which the site record does not carry. */
    getSection(id: string): Observable<SiteSectionDto> {
        return this.http.get<SiteSectionDto>(resolvePattern(this.manifest.sections!.update, { id }), this.collectionHeaders);
    }

    updateSection(id: string, dto: UpdateSectionDto): Observable<SiteSectionDto> {
        const url = resolvePattern(this.manifest.sections!.update, { id });
        return this.http.patch<SiteSectionDto>(url, dto, this.patchHeaders);
    }

    deleteSection(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.sections!.delete, { id });
        return this.http.delete<void>(url);
    }

    // -- A site's allow-list of external scripts and style sheets --------------
    //
    // A sub-collection of the section, named by the section module's own block
    // of the manifest (`modules.section.siteScriptSources`, the site's id as
    // `{id}`). A server from before that block names none: its address is then
    // the section's own plus `/script-sources`. Read by every member of admin;
    // adding and removing are elevated acts, prompted for by the elevation
    // interceptor, which re-sends the request.

    private scriptSourcesUrl(sectionId: string): string {
        const named = this.manifest.modules?.['section']?.['siteScriptSources'];
        return typeof named === 'string' && named !== ''
            ? resolvePattern(named, { id: sectionId })
            : resolvePattern(this.manifest.sections!.item, { id: sectionId }) + '/script-sources';
    }

    listScriptSources(sectionId: string): Observable<SiteScriptSourceDto[]> {
        return this.http
            .get<HydraCollection<SiteScriptSourceDto>>(this.scriptSourcesUrl(sectionId), this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    addScriptSource(sectionId: string, dto: AddSiteScriptSourceDto): Observable<SiteScriptSourceDto> {
        return this.http.post<SiteScriptSourceDto>(this.scriptSourcesUrl(sectionId), dto);
    }

    removeScriptSource(sectionId: string, sourceId: string): Observable<void> {
        return this.http.delete<void>(this.scriptSourcesUrl(sectionId) + '/' + encodeURIComponent(sourceId));
    }

    /**
     * POST /api/v1/sections/_apply -- regenerate per-section nginx vhost configs.
     * Returns a summary; the FE still has to surface `reloadCommand` to the
     * operator (nginx is NOT auto-reloaded). Admin-only on the backend.
     */
    applySections(): Observable<SectionApplyResultDto> {
        const url = this.manifest.sections?.apply;
        if (!url) {
            throw new Error('sections.apply URL not present in manifest');
        }
        return this.http.post<SectionApplyResultDto>(url, {}, {
            headers: { 'Content-Type': 'application/ld+json', Accept: 'application/ld+json' },
        });
    }

    // -- Web / Sites composition ( Layer 3a/3b/3c) --------------------
    //
    // The Web module endpoints live under `/api/v1/web/sites`. There is no
    // dedicated manifest section for them (the URL prefix is stable and
    // the FE consumer surface is small) so we build URLs from `apiBase`,
    // as the other feature services do.

    /**
     * GET /api/v1/web/sites -- list of composed Site views (admin-gated).
     * Each row carries `currentUserMembership` inline for per-section
     * gating without a second round-trip.
     */
    listSites(): Observable<SiteDto[]> {
        const url = `${this.manifest.apiBase}/web/sites`;
        return this.http
            .get<HydraCollection<SiteDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * GET /api/v1/web/sites/{slug} -- single composed Site view with
     * `currentUserMembership` embedded. Used by the Site Detail page
     * (Layer 3d.1). 404 when the slug doesn't match a SiteSection.
     */
    getSite(slug: string): Observable<SiteDto> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}`;
        return this.http.get<SiteDto>(url);
    }

    /**
     * GET /api/v1/web/sites/{slug}/members -- owner + editor-group members.
     * Used by the Site Detail page (Members card + "View all" modal).
     * Backend is admin-only today; FE callers should still surface 403
     * gracefully.
     */
    listSiteMembers(slug: string): Observable<SiteMemberDto[]> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}/members`;
        return this.http
            .get<HydraCollection<SiteMemberDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * DELETE /api/v1/web/sites/{slug} -- Web-composition delete (not the
     * Section module's `/sections/{id}` delete). Backend forbids deletion
     * when NaviTree FKs still reference the SiteSection. Reserved for
     * future Site Detail wiring; not consumed in Layer 3d.1.
     */
    deleteSite(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }
}
