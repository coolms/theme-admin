import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import { PersonalizationRuleDto, PersonalizationRuleWriteDto } from './personalization-rules.types';

/**
 *Phase 4 (CDP personalization, P4.admin.c) — admin API client for the
 * content-personalization rule store.
 *
 * Feature-local (not on the shared ApiService), mirroring {@link ./cdp.service}:
 * a small self-contained surface off the generic `manifest.apiBase`. Talks to the
 * Web-owned `/web/personalization-rules` CRUD (ROLE_ADMIN). Unlike the JSON-LD
 * Segment collection, the list endpoint returns a PLAIN JSON array (no `member`
 * unwrap); the identifier is the rule's v7 uuid.
 */
@Injectable({ providedIn: 'root' })
export class PersonalizationRulesService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    // API-Platform PATCH ops require merge-patch (else 415) — see ApiService.patchHeaders.
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    private get base(): string {
        return `${this.apiBase}/web/personalization-rules`;
    }

    /**
     * Every rule (enabled and disabled) in `sortOrder` order. The admin HTTP layer
     * content-negotiates to JSON-LD, so API Platform returns a Hydra collection
     * ({@link HydraCollection} with `member`), not a bare array — normalise both
     * shapes (mirrors {@link ./cdp.service}'s `.member` unwrap).
     */
    listRules(): Observable<PersonalizationRuleDto[]> {
        return this.http
            .get<PersonalizationRuleDto[] | HydraCollection<PersonalizationRuleDto>>(this.base)
            .pipe(map(res => Array.isArray(res) ? res : (res.member ?? [])));
    }

    createRule(dto: PersonalizationRuleWriteDto): Observable<PersonalizationRuleDto> {
        return this.http.post<PersonalizationRuleDto>(this.base, dto);
    }

    updateRule(id: string, dto: PersonalizationRuleWriteDto): Observable<PersonalizationRuleDto> {
        return this.http.patch<PersonalizationRuleDto>(
            `${this.base}/${encodeURIComponent(id)}`,
            dto,
            this.patchHeaders,
        );
    }

    deleteRule(id: string): Observable<void> {
        return this.http.delete<void>(`${this.base}/${encodeURIComponent(id)}`);
    }
}
