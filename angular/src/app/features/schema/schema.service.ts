import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, resolvePattern } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import {
    type ConstraintMetadata,
    type ConstraintParameter,
    type DomainEntityItem,
    type DomainModuleGroup,
    type DynamicEntityTypeDto,
    type EntityFieldMetadata,
    type EntityTypeSchema,
    type FieldOverrideKind,
    type FieldSchemaItem,
    type FieldSecurity,
    type FieldTypeOptions,
} from '@coolms/ui-angular';

// Re-exported so existing importers of this module keep working; the
// declarations themselves now live in shared/schema/schema.types.
export type {
    ConstraintMetadata,
    ConstraintParameter,
    DomainEntityItem,
    DomainModuleGroup,
    DynamicEntityTypeDto,
    EntityFieldMetadata,
    EntityTypeSchema,
    FieldOverrideKind,
    FieldSchemaItem,
    FieldSecurity,
    FieldTypeOptions,
};

@Injectable({ providedIn: 'root' })
export class SchemaService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest() {
        return this.store.selectSnapshot(AppConfigState.manifest)?.dynamicEntity;
    }

    private get domainExplorerManifest() {
        return this.store.selectSnapshot(AppConfigState.manifest)?.domainExplorer;
    }

    get fieldDefinitionsReorderUrl(): string {
        return this.manifest?.fieldDefinitionsReorderUrl ?? '';
    }

    get toolbarNaviGraphUrl(): string {
        return this.manifest?.toolbarNaviGraphUrl ?? '';
    }

    get domainExplorerToolbarUrl(): string {
        return this.domainExplorerManifest?.domainExplorerToolbarUrl ?? '';
    }

    get entityUrl(): string {
        return this.domainExplorerManifest?.entityUrl ?? '';
    }

    get typeByAliasUrl(): string {
        return this.manifest?.typeByAliasUrl ?? '';
    }

    listTypes(): Observable<EntityTypeSchema[]> {
        return this.http
            .get<HydraCollection<EntityTypeSchema>>(this.manifest!.typesUrl)
            .pipe(map(r => r.member));
    }

    /**
     * Fetches a single domain entity by its entityAlias (dynamic alias or FQCN).
     * Returns the full detail response including the `fields` array.
     */
    getEntity(alias: string): Observable<DomainEntityItem> {
        const url = resolvePattern(this.domainExplorerManifest!.entityUrl, { entityAlias: alias });
        return this.http.get<DomainEntityItem>(url);
    }

    /**
     * Fetches the full entity domain catalog and groups items by module.
     * The API returns a flat Hydra collection where each item carries a `module` field.
     */
    listDomain(): Observable<DomainModuleGroup[]> {
        type ApiItem = DomainEntityItem & { module: string };
        return this.http
            .get<HydraCollection<ApiItem>>(this.domainExplorerManifest!.entitiesUrl)
            .pipe(map(r => {
                const groups = new Map<string, DomainEntityItem[]>();
                for (const { module, ...entity } of r.member) {
                    if (!groups.has(module)) groups.set(module, []);
                    groups.get(module)!.push(entity);
                }
                return [...groups.entries()].map(([module, entities]) => ({ module, entities }));
            }));
    }

    listConstraints(): Observable<ConstraintMetadata[]> {
        return this.http
            .get<HydraCollection<ConstraintMetadata>>(this.manifest!.constraintsUrl)
            .pipe(map(r => r.member));
    }

    createField(data: Record<string, unknown>): Observable<FieldSchemaItem> {
        return this.http.post<FieldSchemaItem>(this.manifest!.fieldDefinitionsUrl, data);
    }

    updateField(id: string, data: Record<string, unknown>): Observable<FieldSchemaItem> {
        const url = resolvePattern(this.manifest!.fieldDefinitionUrl, { id });
        return this.http.put<FieldSchemaItem>(url, data);
    }

    /**
     * Fetches the per-locale label overrides authored for a field, for the
     * editor pre-fill panels. The single-item GET on a field definition carries
     * BOTH the field's own label translations (`labelTranslations`: `locale => text`,
     * #706) and its per-option label translations (`optionLabels`:
     * `optionValue => (locale => text)`, F5.b Phase 5); the collection list omits
     * both. Only the locales an operator actually translated appear. One GET seeds
     * both panels. Returns empty maps on any error or when the field has no
     * overrides, so the editor panels simply open blank.
     */
    getFieldTranslations(id: string): Observable<{
        labelTranslations: Record<string, string>;
        optionLabels:      Record<string, Record<string, string>>;
    }> {
        const url = resolvePattern(this.manifest!.fieldDefinitionUrl, { id });
        return this.http.get<{
            labelTranslations?: Record<string, string>;
            optionLabels?:      Record<string, Record<string, string>>;
        }>(url).pipe(
            map(r => ({
                labelTranslations: r.labelTranslations ?? {},
                optionLabels:      r.optionLabels ?? {},
            })),
            catchError(() => of({ labelTranslations: {}, optionLabels: {} })),
        );
    }

    deleteField(id: string): Observable<void> {
        const url = resolvePattern(this.manifest!.fieldDefinitionUrl, { id });
        return this.http.delete<void>(url);
    }

    deleteFieldOverride(entityAlias: string, fieldName: string): Observable<void> {
        const url = `${this.manifest!.fieldDefinitionsUrl}?entityAlias=${encodeURIComponent(entityAlias)}&name=${encodeURIComponent(fieldName)}`;
        return this.http.delete<void>(url);
    }

    listRuntimeTypes(): Observable<DynamicEntityTypeDto[]> {
        return this.http
            .get<HydraCollection<DynamicEntityTypeDto>>(this.manifest!.typesUrl)
            .pipe(map(r => r.member));
    }

    /**
     * Fetches direct children for a given parentId, or root types when parentId='root'.
     */
    listRuntimeTypesForParent(parentId: string = 'root'): Observable<DynamicEntityTypeDto[]> {
        const url = `${this.manifest!.typesUrl}?parentId=${encodeURIComponent(parentId)}`;
        return this.http
            .get<HydraCollection<DynamicEntityTypeDto>>(url)
            .pipe(map(r => r.member));
    }

    /**
     * Server-side search across all dynamic types using RQL `cn` (contains) on label.
     * Omits parentId so the API searches all types regardless of tree position.
     */
    searchRuntimeTypes(text: string): Observable<DynamicEntityTypeDto[]> {
        // RQL format: filter=label cn "text" (contains, case-insensitive via LIKE)
        const safeText = text.replace(/"/g, '');
        const filter   = `label cn "${safeText}"`;
        return this.http
            .get<HydraCollection<DynamicEntityTypeDto>>(this.manifest!.typesUrl, { params: { filter } })
            .pipe(map(r => r.member));
    }

    /**
     * Fetches a single DynamicEntityType by its UUID.
     * Uses the same URL pattern as PATCH/DELETE (typeUrl).
     */
    getType(id: string): Observable<DynamicEntityTypeDto> {
        const url = resolvePattern(this.manifest!.typeUrl, { id });
        return this.http.get<DynamicEntityTypeDto>(url);
    }

    /**
     * Fetches a single DynamicEntityType by slug (alias), including PHP-backed types.
     * Used by the Domain Explorer to load schema for isDynamic entities whose
     * slug is registered in DynamicEntityAliasRegistry (e.g. page_variant).
     *
     * Uses the dedicated GET /dynamic-entity/types/{alias} endpoint; returns null on 404.
     */
    getTypeBySlug(slug: string): Observable<DynamicEntityTypeDto | null> {
        const url = resolvePattern(this.manifest!.typeByAliasUrl ?? '', { alias: slug });
        return this.http.get<DynamicEntityTypeDto>(url).pipe(
            catchError(() => of(null)),
        );
    }

    createType(data: {
        slug:         string;
        label:        string;
        name?:        string;
        parentId?:    string;
        categoryTree?: string;
    }): Observable<DynamicEntityTypeDto> {
        return this.http.post<DynamicEntityTypeDto>(this.manifest!.typesCreateUrl, data);
    }

    updateType(id: string, data: {
        label?:        string;
        name?:         string;
        categoryTree?: string;
    }): Observable<DynamicEntityTypeDto> {
        const url = resolvePattern(this.manifest!.typeUrl, { id });
        return this.http.patch<DynamicEntityTypeDto>(url, data, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    deleteType(id: string): Observable<void> {
        const url = resolvePattern(this.manifest!.typeUrl, { id });
        return this.http.delete<void>(url);
    }

    reorderFields(items: Array<{ id: string; sortOrder: number }>): Observable<void> {
        return this.http.patch<void>(this.manifest!.fieldDefinitionsReorderUrl, { items }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }

    /**
     * Returns the list of available Symfony form types for the Schema Editor dropdown.
     * Falls back to an empty array when the endpoint is not available.
     */
    /**
     * Returns the list of available Symfony form types for the Schema Editor dropdown.
     * Falls back to an empty array when the endpoint is not available.
     */
    getFormTypes(): Observable<Array<{ value: string; label: string }>> {
        const url = this.manifest?.formTypesUrl;
        if (!url) return of([]);
        return this.http
            .get<HydraCollection<{ value: string; label: string }>>(url)
            .pipe(map(r => r.member));
    }
}
