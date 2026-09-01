/**
 * Process Cockpit FE types.
 *
 * Mirrors the backend `CockpitInstanceResource` wire shape
 * (`/api/v1/cockpit/instances`). Read-only for this slice; steering
 * actions (cancel / suspend / resume / retry) land in a later M4 slice.
 */

/** Values of the backend `ProcessInstanceState` enum. */
export type ProcessInstanceState =
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'suspended';

/** One process-instance row. */
export interface CockpitInstanceDto {
    id: string;
    definitionId: string;
    definitionKey: string | null;
    definitionName: string | null;
    definitionVersionId: string;
    state: ProcessInstanceState | string;
    businessKey: string | null;
    startedById: string | null;
    startedAt: string | null;
    completedAt: string | null;
}

export interface ListCockpitInstancesOptions {
    /** Comma-separated state filter; omitted = all states. */
    state?: string;
    /** Exact definition (the report's drill-in link). */
    definitionId?: string;
    /** Substring over the definition's key + display name (the grid's column filter). */
    definition?: string;
    /** Substring over the instance business key. */
    businessKey?: string;
    /** ISO-8601 bounds on `startedAt`. */
    startedFrom?: string;
    startedTo?: string;
    /** `state|businessKey|startedAt|completedAt`, `-` prefix for descending. */
    sort?: string;
    page?: number;
    perPage?: number;
}

/**
 * One external-task row — a Camunda-style external worker task the engine
 * has parked for an external worker to lock + complete. Mirrors the backend
 * `CockpitExternalTaskResource` wire shape (`/api/v1/cockpit/external-tasks`).
 */
export interface CockpitExternalTaskDto {
    id: string;
    processInstanceId: string;
    definitionId: string;
    activityId: string;
    topic: string;
    state: string;
    workerId: string | null;
    lockExpiresAt: string | null;
    retries: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ListCockpitExternalTasksOptions {
    /** Comma-separated state filter; omitted = all states. */
    state?: string;
    /** SUBSTRING over the worker topic (matches the grid's `cn` column filter). */
    topic?: string;
    /** Exact instance (the detail page's drill-in). */
    processInstanceId?: string;
    /** Substring over the BPMN activity id. */
    activityId?: string;
    /** Substring over the locking worker id. */
    worker?: string;
    /** ISO-8601 bounds on `createdAt`. */
    createdFrom?: string;
    createdTo?: string;
    /** `topic|state|activityId|worker|retries|createdAt`, `-` prefix for descending. */
    sort?: string;
    page?: number;
    perPage?: number;
}

/** Values of the backend `ExecutionTokenState` enum. */
export type ExecutionTokenState =
    | 'active'
    | 'waiting'
    | 'completed'
    | 'dead';

/**
 * One execution token — a live (or finished) marker sitting on a flow
 * element. Newest-entered first in the detail payload.
 */
export interface CockpitTokenDto {
    id: string;
    currentElementId: string;
    state: ExecutionTokenState | string;
    waitingFor: string | null;
    parentTokenId: string | null;
    enteredAt: string;
    leftAt: string | null;
}

/** Values of the backend `TaskState` enum. */
export type TaskState =
    | 'pending'
    | 'assigned'
    | 'completed'
    | 'cancelled';

/**
 * One user task (M4 detail) — the operator-relevant facts behind a parked
 * `userTask:<id>` token: state, current assignee, candidate pool, timers.
 * Read-only; task ACTIONS (claim / delegate / complete) live in the Inbox.
 * `assigneeId` / candidate ids are raw ids (no name resolution).
 */
export interface CockpitTaskDto {
    id: string;
    activityId: string;
    state: TaskState | string;
    assigneeId: string | null;
    candidateUserIds: string[];
    candidateGroupIds: string[];
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    delegatedFromId: string | null;
}

/**
 * One engine history event (token entered/left, task created, message
 * correlated, …). Chronological (oldest first) in the detail payload.
 */
export interface CockpitHistoryEventDto {
    id: string;
    type: string;
    /**
     * — server-derived human one-liner for the timeline ("Compensated 2
     * activities", "Error caught at svc.pay (code PAYMENT_DECLINED)"). The
     * backend `HistoryEventDescriber` produces it from the stable code + payload
     * so every client renders identically; empty/absent -> fall back to `type`.
     */
    summary?: string;
    /**
     * / — grouping bucket for colour-coding the timeline marker +
     * badge: `process` | `token` | `compensation` | `task` | `timer` |
     * `message` | `external-task` (and any future bucket -> muted fallback).
     */
    category?: string;
    tokenId: string | null;
    payload: Record<string, unknown>;
    actorId: string | null;
    occurredAt: string;
}

/**
 * One deployed version of the instance's definition, offered as an
 * in-flight migration target. The migrate dialog renders these (excluding
 * `isCurrent`) as the target dropdown.
 */
export interface CockpitVersionOptionDto {
    versionId: string;
    version: number;
    deployedAt: string;
    isCurrent: boolean;
}

/**
 * Enriched single-instance detail. Returned by the item GET
 * (`GET /api/v1/cockpit/instances/{id}`); extends the list row with the
 * engine's per-instance token positions, history timeline, and variables.
 */
export interface CockpitInstanceDetailDto extends CockpitInstanceDto {
    tokens: CockpitTokenDto[];
    history: CockpitHistoryEventDto[];
    /**
     * M4 — user tasks on the instance (each parked `userTask:<id>` token
     * resolved to assignee/candidates/state/timers), creation order. Absent on
     * the list view; the service normalizes to `[]`.
     */
    tasks: CockpitTaskDto[];
    variables: Record<string, unknown>;
    /**
     * Raw pinned BPMN-Lite JSON body for the diagram overlay; absent
     * (API Platform omits nulls) when the body can't be loaded. Guard with
     * truthiness before rendering the diagram card.
     */
    definitionBody?: string | null;
    /** The version number the instance currently pins; absent if unresolved. */
    definitionVersion?: number | null;
    /**
     * Every deployed version of the instance's definition (migration
     * targets), oldest-first. Absent on the list view; default to `[]`.
     */
    availableVersions?: CockpitVersionOptionDto[];
}

/**
 * Rolling-window throughput counters from the aggregate report.
 * `started*` = instances started in the window (any state); `completed*` =
 * instances that reached `completed` in the window.
 */
export interface CockpitThroughputDto {
    started24h: number;
    started7d: number;
    started30d: number;
    completed24h: number;
    completed7d: number;
    completed30d: number;
}

/** Per-definition state breakdown row from the aggregate report. */
export interface CockpitDefinitionStatDto {
    definitionId: string;
    definitionKey: string | null;
    definitionName: string | null;
    total: number;
    running: number;
    suspended: number;
    completed: number;
    failed: number;
    cancelled: number;
    /** Mean completion seconds for this definition; null if none completed. */
    avgDurationSeconds: number | null;
}

/**
 * Aggregate operator report. Returned by the singleton GET
 * (`GET /api/v1/cockpit/report`, ROLE_ADMIN): platform-wide state counts +
 * rolling throughput + per-definition breakdown.
 */
export interface CockpitReportDto {
    total: number;
    /** State value -> count, zero-filled for every state. */
    stateCounts: Record<string, number>;
    throughput: CockpitThroughputDto;
    definitions: CockpitDefinitionStatDto[];
    /** Mean completion seconds across all completed instances; null if none. */
    avgDurationSeconds: number | null;
}

/**
 * Aggregate user-task metrics. Returned by the singleton GET
 * (`GET /api/v1/cockpit/task-metrics`, ROLE_ADMIN): the task-level complement
 * to `CockpitReportDto` — count by task state, the open subtotal, overdue
 * (SLA-breach) count, mean queue-/cycle-time, and completion throughput.
 * Note: API Platform omits null props, so `avgQueueSeconds`/`avgCycleSeconds`
 * arrive as `undefined` when there is no completed-task sample.
 */
export interface CockpitTaskMetricsDto {
    total: number;
    /** Task state value -> count, zero-filled for every state. */
    stateCounts: Record<string, number>;
    /** `pending` + `assigned`: the live work queue. */
    openTotal: number;
    /** Open tasks whose `dueAt` has passed. */
    overdueCount: number;
    /** Mean seconds a completed task waited before it was claimed; null if no sample. */
    avgQueueSeconds: number | null;
    /** Mean seconds a completed task took once claimed; null if no sample. */
    avgCycleSeconds: number | null;
    completed24h: number;
    completed7d: number;
    completed30d: number;
}

/**
 * One element's dwell timing row from the per-definition bottleneck
 * report. `elementLabel`/`elementKind` are best-effort AST enrichment (null
 * when the id isn't resolvable). Note: API Platform omits null properties, so
 * a missing field arrives as `undefined` — guard with `== null`.
 */
export interface CockpitElementTimingDto {
    elementId: string;
    elementLabel: string | null;
    elementKind: string | null;
    avgDwellSeconds: number;
    maxDwellSeconds: number;
    sampleCount: number;
}

/**
 * Per-definition bottleneck / timing report. Returned by
 * `GET /api/v1/cockpit/definitions/{definitionId}/timing` (ROLE_ADMIN):
 * each AST element's mean + max dwell across the definition's instances,
 * slowest-average first.
 */
export interface CockpitTimingReportDto {
    definitionId: string;
    definitionKey: string | null;
    definitionName: string | null;
    instanceCount: number;
    elements: CockpitElementTimingDto[];
}

/**
 *+ — the CSV-export envelope returned by
 * `GET /api/v1/cockpit/reports/export?kind=…` (ROLE_ADMIN). The CSV body rides
 * in `csv` (with a suggested `filename`) so the Bearer-authed admin SPA can
 * fetch it (auth header attached by the interceptor) and trigger the download
 * client-side — a raw `Content-Disposition` attachment would 401, since a plain
 * `<a download>` can't carry the bearer token.
 */
export interface CockpitReportExportDto {
    kind: string;
    filename: string;
    csv: string;
    generatedAt: string;
}
