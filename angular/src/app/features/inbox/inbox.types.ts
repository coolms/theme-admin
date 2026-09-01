/**
 * Wire-shapes for the Inbox FE. Mirrors `InboxTaskResource`
 * on the backend.
 *
 * The DTO is intentionally flat: every field on the backend resource is
 * a string / nullable string / nullable ISO datetime, no nested object
 * graph. The form-bound complete dialog drives off `formKey` (resolved
 * server-side from the per-instance pinned AST, Phase 1).
 */

export type InboxTab = 'assigned' | 'claimable' | 'recent';

/**
 * State enum mirroring `TaskState`.
 * The backend serialises these as snake_case strings.
 */
export type TaskState = 'pending' | 'assigned' | 'completed' | 'cancelled';

export interface InboxTaskDto {
    readonly id:                   string;
    readonly processInstanceId:    string;
    readonly activityId:           string;
    readonly state:                TaskState;
    /** Frozen Form snapshot pointer (reserved; null today). */
    readonly formConfigVersionId:  string | null;
    readonly assigneeId:           string | null;
    readonly delegatedFromId:      string | null;
    readonly candidateUserIds:     ReadonlyArray<string>;
    readonly candidateGroupIds:    ReadonlyArray<string>;
    readonly dueAt:                string | null;
    readonly followUpAt:           string | null;
    readonly createdAt:            string;
    readonly claimedAt:            string | null;
    readonly completedAt:          string | null;
    /**
     * AST-resolved BPMN-Lite form binding (Phase 1). Drives the
     * form-bound complete dialog through `<app-dynamic-form
     * [formId]="task.formKey">`. Null when the AST is unavailable -- the
     * dialog falls back to a raw-JSON formData editor.
     */
    readonly formKey:              string | null;
    /**
     * Omnichannel convergence: a compact "context card" projected server-side
     * from the owning process's variables (allow-listed `{label, value}` pairs —
     * name / email / phone / source / form …). Lets the agent see WHO a
     * lead-triage task is about + WHICH channel it came from, right in the inbox.
     * Empty when the process carries none of the allow-listed variables.
     */
    readonly context?:             ReadonlyArray<{ readonly label: string; readonly value: string }>;
    /** One-line join of the leading {@link context} values (shown in the grid "Context" column). */
    readonly contextSummary?:      string | null;
}

/** Options for the paged list call. */
export interface ListInboxTasksOptions {
    tab?:      InboxTab;
    page?:     number;
    pageSize?: number;
    sort?:     string | null;
    filters?:  ReadonlyArray<string>;
}

/** Envelope returned by `listTasks()`. */
export interface InboxTasksPage {
    readonly items:      ReadonlyArray<InboxTaskDto>;
    readonly totalItems: number;
    readonly page:       number;
    readonly pageSize:   number;
}

/** Request body for POST /inbox/tasks/{id}/delegate. */
export interface DelegateRequest {
    readonly delegateeUserId: string;
}

/** Request body for POST /inbox/tasks/{id}/complete. */
export interface CompleteRequest {
    readonly formData: Record<string, unknown>;
}

/**
 * Realtime payload shapes mirror `InboxLivePublisher`
 *. Backend publishes one of three discriminated types on the
 * per-user channel `inbox.{userIdRfc4122}`.
 */
export type InboxLiveEvent =
    | { readonly type: 'task.assigned';  readonly taskId: string; readonly activityId: string; readonly processInstanceId: string }
    | { readonly type: 'task.removed';   readonly taskId: string }
    | { readonly type: 'task.claimable'; readonly taskId: string; readonly activityId: string; readonly processInstanceId: string };
