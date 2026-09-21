// Cut from the shell's api/api.service.ts on 2026-09-21: the Identity (manifest.identity.*; getSettings/getRoles through core-angular's IdentityApiClient and the identity manifest) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, resolvePattern, IdentityApiClient, type HydraCollection } from '@coolms/core-angular';
import {
    type ProfileSection,
    type IdentityGroupDto,
    type AccountDeletionDto,
    type LegalHoldDto,
    type FootprintDto,
    type IdentityUserDto,
    type UpdateUserDto,
    type CreateUserDto,
    type CreateGroupDto,
    type UpdateGroupDto,
} from './identity.types';

@Injectable({ providedIn: 'root' })
export class IdentityApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly identity = inject(IdentityApiClient);
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    /** Full current-user object -- same endpoint as me() but typed as IdentityUserDto. */
    getMe(): Observable<IdentityUserDto> {
        return this.http.get<IdentityUserDto>(this.manifest.identity!.meUrl);
    }

    updateMe(dto: { firstName?: string | null; lastName?: string | null }): Observable<IdentityUserDto> {
        return this.http.patch<IdentityUserDto>(this.manifest.identity!.meUrl, dto, this.patchHeaders);
    }

    uploadAvatar(file: File): Observable<IdentityUserDto> {
        const fd = new FormData();
        fd.append('file', file);
        return this.http.post<IdentityUserDto>(this.manifest.identity!.avatarUploadUrl, fd);
    }

    deleteAvatar(): Observable<void> {
        return this.http.delete<void>(this.manifest.identity!.avatarUploadUrl);
    }

    updateAvatarColor(color: string): Observable<IdentityUserDto> {
        return this.http.patch<IdentityUserDto>(this.manifest.identity!.colorUrl, { color }, this.patchHeaders);
    }

    getSettings(): Observable<Record<string, Record<string, unknown>>> {
        return this.identity.getSettings();
    }

    getSettingsSections(): Observable<ProfileSection[]> {
        return this.http.get<HydraCollection<ProfileSection>>(this.manifest.identity!.settingsSectionsUrl)
            .pipe(map(r => r['member']));
    }

    updateSettings(section: string, data: Record<string, unknown>): Observable<Record<string, unknown>> {
        const url = resolvePattern(this.manifest.identity!.settingsSectionUrl, { section });

        // Accept: application/json for the same reason getSettings() forces it --
        // and this response needs it just as badly. A settings section is a MAP,
        // and API Platform's ld+json turns a map into a Hydra Collection whose
        // `member` array carries the values with the KEYS STRIPPED:
        // `{"member":["system","en",20,false,"#3366ff"]}`. Callers then read
        // `updated['theme']` off an object that has no such property.
        //
        // It failed silently because every caller merges the result into a
        // cache -- the calendar and call preference services included -- so the
        // save persisted correctly on the server and only the in-memory echo was
        // wrong, which looks like nothing until something READS it.
        return this.http.patch<Record<string, unknown>>(url, data, {
            headers: { ...this.patchHeaders.headers, Accept: 'application/json' },
        });
    }

    // -- Identity Users ------------------------------------------------------

    /**
     * List users using RQL query params.
     *
     * filters -- RQL filter expressions, e.g. ['isActive eq true', 'groupId eq "uuid"']
     *           Each entry is sent as a separate `filter=...` query param; the PHP
     *           RqlParser collects them all as AND conditions.
     * sort    -- RQL sort string, e.g. '-identifier' (desc) or 'displayName' (asc).
     * page    -- 1-based page number (omit or 1 = first page).
     * limit   -- items per page.
     */
    listUsers(params: {
        filters?: string[];
        sort?:    string;
        page?:    number;
        limit?:   number;
    } = {}): Observable<{ members: IdentityUserDto[]; total: number }> {
        let httpParams = new HttpParams();
        if (params.limit)              httpParams = httpParams.set('limit', String(params.limit));
        if (params.page && params.page > 1) httpParams = httpParams.set('page', String(params.page));
        if (params.sort)               httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            // Repeated `filter=...` keys -- RqlParser collects all of them as AND conditions.
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<IdentityUserDto>>(this.manifest.identity!.usersUrl, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => ({ members: r['member'], total: r['totalItems'] })));
    }

    createUser(dto: CreateUserDto): Observable<IdentityUserDto> {
        return this.http.post<IdentityUserDto>(this.manifest.identity!.usersUrl, dto);
    }

    getUser(id: string): Observable<IdentityUserDto> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.get<IdentityUserDto>(url);
    }

    updateUser(id: string, dto: UpdateUserDto): Observable<IdentityUserDto> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.patch<IdentityUserDto>(url, dto, this.patchHeaders);
    }

    deleteUser(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.delete<void>(url);
    }

    assignUserGroups(id: string, groupIds: string[]): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.assignGroupsUrl, { id });
        return this.http.post<void>(url, { groups: groupIds });
    }

    // -- Account deletions and legal holds ----------------------------------
    //
    // Every URL comes from the manifest; an older server sends none of them
    // and the surfaces stay away. Cancel, place and release are elevated
    // acts: the 403 is handled by the elevation interceptor, which prompts
    // and re-sends, so a caller only reloads on success.

    /** Whether the server exposes the deletion screens at all. */
    get hasDeletionScreens(): boolean {
        const m = this.manifest.identity;
        return !!(m?.deletionsUrl && m?.footprintsUrl && m?.userDeletionUrl && m?.userLegalHoldsUrl);
    }

    /** The settings block the holds register lives in, for the link from the screen. */
    get holdsSettingsBlock(): string | null {
        return this.manifest.identity?.holdsSettingsBlock || null;
    }

    /** The server-declared form for placing a hold (its one field: the reason). */
    get legalHoldFormId(): string | null {
        return this.manifest.identity?.legalHoldFormId || null;
    }

    listDeletions(params: {
        filters?: string[];
        sort?:    string;
        page?:    number;
        limit?:   number;
    } = {}): Observable<{ members: AccountDeletionDto[]; total: number }> {
        let httpParams = new HttpParams();
        if (params.limit)                   httpParams = httpParams.set('limit', String(params.limit));
        if (params.page && params.page > 1) httpParams = httpParams.set('page', String(params.page));
        if (params.sort)                    httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<AccountDeletionDto>>(this.manifest.identity!.deletionsUrl!, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => ({ members: r['member'], total: r['totalItems'] })));
    }

    listFootprints(): Observable<FootprintDto[]> {
        return this.http
            .get<HydraCollection<FootprintDto>>(this.manifest.identity!.footprintsUrl!, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /** The pending deletion of an account; a 404 means none is pending and is mapped to null. */
    getPendingDeletion(userId: string): Observable<AccountDeletionDto | null> {
        const url = resolvePattern(this.manifest.identity!.userDeletionUrl!, { id: userId });
        return this.http.get<AccountDeletionDto>(url).pipe(
            catchError((e: { status?: number }) => e?.status === 404 ? of(null) : throwError(() => e)),
        );
    }

    cancelDeletion(userId: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.userDeletionUrl!, { id: userId });
        return this.http.delete<void>(url);
    }

    listLegalHolds(userId: string): Observable<LegalHoldDto[]> {
        const url = resolvePattern(this.manifest.identity!.userLegalHoldsUrl!, { id: userId });
        return this.http
            .get<HydraCollection<LegalHoldDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    placeLegalHold(userId: string, reason: string): Observable<LegalHoldDto> {
        const url = resolvePattern(this.manifest.identity!.userLegalHoldsUrl!, { id: userId });
        return this.http.post<LegalHoldDto>(url, { reason });
    }

    releaseLegalHold(userId: string, holdId: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.userLegalHoldsUrl!, { id: userId }) + '/' + encodeURIComponent(holdId);
        return this.http.delete<void>(url);
    }

    // -- Identity Groups -----------------------------------------------------

    listGroups(params: { search?: string; limit?: number; filters?: string[]; sort?: string } = {}): Observable<IdentityGroupDto[]> {
        let httpParams = new HttpParams();
        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.limit)  httpParams = httpParams.set('limit', String(params.limit));
        if (params.sort)   httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<IdentityGroupDto>>(this.manifest.identity!.groupsUrl, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    getGroup(id: string): Observable<IdentityGroupDto> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.get<IdentityGroupDto>(url);
    }

    createGroup(dto: CreateGroupDto): Observable<IdentityGroupDto> {
        return this.http.post<IdentityGroupDto>(this.manifest.identity!.groupsUrl, dto);
    }

    updateGroup(id: string, dto: UpdateGroupDto): Observable<IdentityGroupDto> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.patch<IdentityGroupDto>(url, dto, this.patchHeaders);
    }

    deleteGroup(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.delete<void>(url);
    }

    /**
     * Replace the groups whose roles are granted by holding THIS group's role
     * -- the role-inheritance edges behind `DynamicRoleHierarchy`.
     *
     * An edge means "holding the parent's role also grants the child's", so this
     * is the most privilege-bearing write in the admin. The server refuses a
     * change that would let a group grant its own role (422) -- directly or
     * through another group -- and returns the edges AS PERSISTED, which differ
     * from what was sent whenever the request contained a duplicate.
     */
    setGroupRoleGrants(id: string, grantsGroupIds: readonly string[]): Observable<{ grantsGroupIds: string[] }> {
        const url = `${resolvePattern(this.manifest.identity!.groupUrl, { id })}/role-grants`;
        return this.http.patch<{ grantsGroupIds: string[] }>(url, { grantsGroupIds }, this.patchHeaders);
    }

    /**
     * Returns all available Symfony security roles (derived from registered groups).
     * Used to populate role selectors in the Schema Editor.
     */
    getRoles(): Observable<Array<{ value: string; label: string }>> {
        const url = this.manifest.identity?.rolesUrl;
        if (!url) return of([]);
        return this.http
            .get<HydraCollection<{ value: string; label: string }>>(url)
            .pipe(map(r => r['member']));
    }
}
