// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Definition (/definitions) endpoints, verbatim.

/**
 * Unified Definitions catalog DTO -- mirrors the backend
 * {@link DefinitionCatalogResource} shape returned by
 * `GET /api/v1/definitions`. Cross-module read surface fed by
 * Workflow + Decision (today; future Form) providers via the
 * tagged catalog registry.
 *
 * `id` is the synthetic composite `'{module}:{definitionId}'`
 * minted server-side for Hydra IRI uniqueness; the FE list page
 * does NOT use it for drill-down -- instead, the `module` + the raw
 * `definitionKey` route to the per-module Designer
 * (`/admin/designer/bpmn/{key}` for Workflow,
 * `/admin/designer/dmn/{key}` for Decision).
 */
export interface DefinitionCatalogDto {
    readonly id?:                   string;
    readonly module?:               string;
    readonly definitionId?:         string;
    readonly definitionKey?:        string;
    readonly displayName?:          string;
    readonly latestVersion?:        number | null;
    readonly latestVersionSource?:  'vfs' | 'contributor' | null;
    readonly moduleLock?:           boolean | null;
    readonly hasDraft?:             boolean;
    readonly deployedAt?:           string | null;
    readonly deployedById?:         string | null;
    /** Set once the definition is retired (archived); `null` = active. */
    readonly retiredAt?:            string | null;
}
