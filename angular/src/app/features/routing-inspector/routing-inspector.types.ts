// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Web (/web/routing/inspect) endpoints, verbatim.

// --- Routing Inspector DTOs ( Layer 3b/3d.2) --------------------------
//
// Mirrors `RoutingTrace` (and its child VOs
// `RoutingStep` + `RoutingTarget`). Endpoint:
// `GET /api/v1/web/routing/inspect?host=&path=` (admin-only).
//
// `outcome` and `kind` keep ALL the values the backend can emit so the
// FE doesn't silently fall back to "unknown" when a new case is added
// (e.g. `served_raw_file`, `misconfigured`, `raw_file`).

export type RoutingOutcome =
    | 'rendered_template'
    | 'rendered_package'
    | 'rendered_directory'
    | 'served_raw_file'
    | 'not_found'
    | 'forbidden'
    | 'misconfigured';

export type RoutingStepKind =
    | 'section_resolution'
    | 'vfs_path_mapping'
    | 'vfs_node_lookup'
    | 'navi_tree_resolution'
    | 'navi_node_lookup'
    | 'render_target';

export type RoutingStepStatus = 'matched' | 'not_matched' | 'skipped' | 'error';

export type RoutingTargetKind = 'template' | 'package' | 'directory' | 'raw_file';

export interface RoutingStepDto {
    readonly step:    RoutingStepKind;
    readonly status:  RoutingStepStatus;
    /**
     * Step-specific structured payload -- shape varies per step type.
     * Rendered as a definition list when keys are scalars, else as
     * formatted JSON.
     */
    readonly details: Record<string, unknown>;
    readonly note:    string | null;
}

export interface RoutingTargetDto {
    readonly kind:          RoutingTargetKind;
    readonly templatePath:  string | null;
    readonly vfsNodeId:     string | null;
    readonly vfsNodePath:   string | null;
    readonly naviNodeId:    string | null;
    readonly naviNodePath:  string | null;
    readonly resolverName:  string | null;
}

export interface RoutingTraceDto {
    readonly inputHost: string;
    readonly inputPath: string;
    readonly outcome:   RoutingOutcome;
    readonly steps:     ReadonlyArray<RoutingStepDto>;
    /** Null on 404 / misconfigured outcomes; populated when a render target was identified. */
    readonly target:    RoutingTargetDto | null;
}
