import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
/**
 * Shape of the `POST /decisions/{key}/deploy` response.
 *
 * Mirrors the `DecisionDraftController::deploy()` JSON body. The
 * `version` field is the just-minted version number (1-based); the
 * Angular wrapper surfaces it in a toast so the editor confirms the
 * deploy landed without needing to re-fetch the definition.
 */
export interface DecisionDeployResult {
    readonly version: number;
    readonly versionId: string;
    readonly definitionId: string;
    /** ISO-8601 / RFC-3339 timestamp from the backend. */
    readonly deployedAt: string;
}

/**
 * — shape of `GET / PUT /api/v1/state-machines/{key}/draft`
 * ({@see \App\StateMachine\Infrastructure\ApiPlatform\Resource\StateMachineDraftResource}).
 * `body` is the editor's model JSON string; the page seeds the editor via
 * `JSON.parse(body)` -> `StateMachineEditor.load()`. A fresh key returns a
 * blank starter model, so opening a new key mounts an empty machine.
 */
export interface StateMachineDraftPayload {
    readonly key: string;
    readonly body: string;
    readonly latestVersion: number;
}

/** — shape of `POST /api/v1/state-machines/{key}/deploy`. */
export interface StateMachineDeployResult {
    readonly key: string;
    readonly version: number;
    /** ISO-8601 timestamp from the backend. */
    readonly deployedAt: string;
}

/**
 * FE -- thin HTTP client for the
 * `@coolms/designer`-backed DMN admin page.
 *
 * **Three operations, all keyed by definition key:**
 *  - `getDraft(key)` -> XML body string. The page seeds the editor
 *    via `editor.fromXml(body)`.
 *  - `saveDraft(key, xml)` -> 204 No Content. The page issues this
 *    on the "Save" toolbar action with `editor.toXml()`.
 *  - `deploy(key)` -> `DecisionDeployResult`. Issued on the
 *    "Deploy" toolbar action; the backend reads the just-saved
 *    draft body, parses + validates it, and mints `v{N+1}.dmn`.
 *    Save MUST precede deploy -- the deployer reads VFS bytes, not
 *    request body.
 *
 * **XML wire-format.** HttpClient's `responseType: 'text'`
 * branches are typed via overloads, so the call sites get
 * `Observable<string>` directly. The Content-Type header keeps the
 * intent visible on the wire and matches the controller's
 * `Accept`-agnostic body read.
 *
 * Mirrors the precedent set by the M2.m `InboxService` -- per-feature
 * thin client, not bolted onto the platform `ApiService`.
 */
@Injectable({ providedIn: 'root' })
export class DesignerService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    /** GET the current draft XML for a decision keyed by `key`. */
    getDraft(key: string): Observable<string> {
        return this.http.get(this.draftUrl(key), {
            headers: new HttpHeaders({ Accept: 'application/xml' }),
            responseType: 'text',
        });
    }

    /** PUT the editor's current XML as the new draft body. */
    saveDraft(key: string, xml: string): Observable<void> {
        return this.http.put<void>(this.draftUrl(key), xml, {
            headers: new HttpHeaders({ 'Content-Type': 'application/xml' }),
        });
    }

    /** POST the deploy trigger; backend reads the just-saved draft from VFS. */
    deploy(key: string): Observable<DecisionDeployResult> {
        return this.http.post<DecisionDeployResult>(
            `${this.apiBase}/decisions/${encodeURIComponent(key)}/deploy`,
            null,
        );
    }

    private draftUrl(key: string): string {
        return `${this.apiBase}/decisions/${encodeURIComponent(key)}/draft`;
    }

    /* -------------------- BPMN-Lite endpoints -------------------- */

    /**
     * GET the current BPMN-Lite draft body for a workflow definition
     * keyed by `key`. The page seeds the editor via
     * `bpmnLiteJsonToModel(result.body)` -> `editor.load(model)`.
     *
     * Backend returns the `WorkflowDraftResource` shape:
     * `{definitionKey, body, lastModifiedAt}`. The page uses
     * `body` to seed; `lastModifiedAt` for the "saved at" indicator.
     */
    getWorkflowDraft(key: string): Observable<WorkflowDraftPayload> {
        return this.http.get<WorkflowDraftPayload>(this.workflowDraftUrl(key));
    }

    /**
     * PUT the editor's current BPMN-Lite JSON as the new draft body.
     * Backend echoes the updated `lastModifiedAt` so the page can
     * refresh the "saved at" indicator without a follow-up GET.
     */
    saveWorkflowDraft(
        key: string,
        body: string,
    ): Observable<WorkflowDraftPayload> {
        return this.http.put<WorkflowDraftPayload>(
            this.workflowDraftUrl(key),
            { body },
        );
    }

    /**
     * GET an immutable deployed version's BPMN-Lite body for a workflow
     * definition. polish-bundle (F-1) read-only viewer seam.
     *
     * Distinct from {@link getWorkflowDraft}: this endpoint returns the
     * BYTES PINNED AT DEPLOY TIME, not the latest draft body. The
     * versioned VFS Node is chmod-clamped to 0o440 at deploy time so
     * the bytes are immutable; the editor mounts them in viewer mode
     * with no save / deploy / mutation surface.
     *
     * Backend returns the `WorkflowVersionResource` shape:
     * `{definitionKey, version, body, deployedAt}`. The viewer page
     * surfaces `deployedAt` in the header as "Deployed {ts}".
     */
    getWorkflowVersion(
        key: string,
        version: number,
    ): Observable<WorkflowVersionPayload> {
        return this.http.get<WorkflowVersionPayload>(
            `${this.apiBase}/workflows/${encodeURIComponent(key)}/versions/${version}`,
        );
    }

    /**
     * POST the workflow deploy trigger. Backend reads the just-saved
     * draft body from VFS, parses + validates via M2.c, mints
     * `v{N+1}.bpmn.json` via M2.d's `WorkflowDeployer`. Save MUST
     * precede deploy -- the deployer reads VFS bytes, not request
     * body.
     *
     * Returns the `WorkflowDeployResource` shape with the
     * just-minted version row's id + monotonic version + deployedAt
     * timestamp.
     */
    deployWorkflow(key: string): Observable<WorkflowDeployResult> {
        return this.http.post<WorkflowDeployResult>(
            `${this.apiBase}/workflows/${encodeURIComponent(key)}/deploy`,
            null,
        );
    }

    /* -------------------- State Machine endpoints -------------------- */

    /**
     * GET the current State Machine draft for a definition keyed by `key`.
     * The page seeds the editor via `JSON.parse(result.body)` ->
     * `StateMachineEditor.load(model)`. A new key returns a blank model.
     */
    getStateMachineDraft(key: string): Observable<StateMachineDraftPayload> {
        return this.http.get<StateMachineDraftPayload>(this.stateMachineDraftUrl(key));
    }

    /** PUT the editor's current model JSON as the new draft body. */
    saveStateMachineDraft(
        key: string,
        body: string,
    ): Observable<StateMachineDraftPayload> {
        return this.http.put<StateMachineDraftPayload>(
            this.stateMachineDraftUrl(key),
            { body },
        );
    }

    /**
     * POST the State Machine deploy trigger. Backend validates the draft +
     * mints `/state-machines/{key}/v{N}.json`. Save MUST precede deploy.
     */
    deployStateMachine(key: string): Observable<StateMachineDeployResult> {
        return this.http.post<StateMachineDeployResult>(
            `${this.apiBase}/state-machines/${encodeURIComponent(key)}/deploy`,
            null,
        );
    }

    private stateMachineDraftUrl(key: string): string {
        return `${this.apiBase}/state-machines/${encodeURIComponent(key)}/draft`;
    }

    /**
     * Ship A Phase 5+ (FE polish) -- POST the Fork-to-VFS lifecycle
     * action for a contributor-source workflow definition. Backend
     * mints a `/workflows/{key}/draft.bpmn.json` Node from the
     * contributor's current body + stamps `moduleLock=true` on the
     * contributor row.
     *
     * Returns the just-minted editable draft (same `WorkflowDraftPayload`
     * shape the GET endpoint returns) so the editor can mount on the
     * same HTTP round-trip the fork POST completes.
     *
     * Surfaces:
     *  - 409 (`NotForkableException`) -- the definition isn't in a
     *    forkable state (no deployed version, not contributor-
     *    source, or already forked).
     *  - 404 -- unknown definitionKey.
     *
     * The Designer 409 banner CTA wires this; the editor reloads
     * automatically into normal edit mode on success.
     */
    forkWorkflowToVfs(key: string): Observable<WorkflowDraftPayload> {
        return this.http.post<WorkflowDraftPayload>(
            `${this.apiBase}/workflows/${encodeURIComponent(key)}/fork-to-vfs`,
            null,
        );
    }

    /**
     * Ship A Phase 5+ (FE polish) -- POST the Revert-to-module
     * lifecycle action. Symmetric undo of `forkWorkflowToVfs`. Clears
     * `moduleLock` on the latest contributor row + re-points
     * `latestVersionId` back at it.
     *
     * Returns the restored contributor baseline as a
     * `WorkflowVersionPayload` so the Designer can mount the read-only
     * viewer on the same round-trip. The local draft + any deployed
     * VFS-source versions stay in history but are no longer the
     * active body.
     *
     * Surfaces:
     *  - 409 (`NotRevertibleException`) -- the definition isn't in a
     *    forked state, or has no contributor baseline to revert to.
     *  - 404 -- unknown definitionKey.
     */
    revertWorkflowToModule(key: string): Observable<WorkflowVersionPayload> {
        return this.http.post<WorkflowVersionPayload>(
            `${this.apiBase}/workflows/${encodeURIComponent(key)}/revert-to-module`,
            null,
        );
    }

    private workflowDraftUrl(key: string): string {
        return `${this.apiBase}/workflows/${encodeURIComponent(key)}/draft`;
    }

    /* -------------------- XRefs catalogs -------------------- */

    /**
     * GET the workflow service-task handler catalog. Feeds the
     * BPMN-Lite property panel's `serviceTask.implementation`
     * autocomplete via the XRefs scope `'workflow.handlers'`.
     *
     * Hits the `/api/v1/workflow/handlers` endpoint. Returns a
     * JSON-LD Hydra collection -- the page slices `member` (the
     * canonical Hydra key for the row array). Empty catalog returns
     * `{ member: [] }` rather than 404.
     */
    listWorkflowHandlers(): Observable<HydraCollection<WorkflowHandlerEntry>> {
        return this.http.get<HydraCollection<WorkflowHandlerEntry>>(
            `${this.apiBase}/workflow/handlers`,
        );
    }

    /**
     * GET the FormModule definition catalog. Feeds the BPMN-Lite
     * property panel's `userTask.formKey` autocomplete via the
     * XRefs scope `'workflow.forms'`.
     *
     * Hits the existing `/api/v1/forms` endpoint
     * (FormDefinitionResource). The wrapper just lifts the entries
     * into XRefItem shape; no per-form metadata is consulted at
     * (the form id IS the picker value).
     */
    listForms(): Observable<HydraCollection<FormDefinitionEntry>> {
        return this.http.get<HydraCollection<FormDefinitionEntry>>(
            `${this.apiBase}/forms`,
        );
    }
}

/**
 * Minimal JSON-LD Hydra collection envelope. The page only
 * reads `member`; the rest of the Hydra metadata
 * (`@context`, `totalItems`, `view`) is irrelevant to the picker
 * population path.
 */
export interface HydraCollection<T> {
    readonly member: ReadonlyArray<T>;
}

/**
 * Shape of one row in `GET /api/v1/workflow/handlers`. Mirrors the
 * backend `WorkflowHandlerResource`. Optional `description` + `fqcn`
 * are reserved for a richer label affordance the schema
 * doesn't yet surface.
 */
export interface WorkflowHandlerEntry {
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly fqcn?: string;
}

/**
 * Shape of one row in `GET /api/v1/forms`. `id` is the canonical XRef
 * value; `name` is the friendly display label (author `formOptions.title`
 * else a humanized id) the picker shows, with the raw id as a sub-line.
 */
export interface FormDefinitionEntry {
    readonly id: string;
    readonly name?: string;
}

/**
 * Shape of the `GET / PUT /api/v1/workflows/{key}/draft`
 * responses. Mirrors the backend `WorkflowDraftResource`.
 */
export interface WorkflowDraftPayload {
    readonly definitionKey: string;
    /**
     * BPMN-Lite JSON body as a string. Round-trips verbatim through
     * GET / PUT -- not parsed into a typed object on the wire.
     */
    readonly body: string;
    /** ISO 8601 timestamp; surface as "saved at". */
    readonly lastModifiedAt: string;
    /**
     * Ship A Phase 5+ (FE polish) -- lifecycle source of the active
     * version row at the moment this draft was loaded. `'vfs'` or
     * `null` means standard Designer flow (no badge). `'contributor'`
     * combined with `moduleLock=true` means this draft was minted by
     * a Fork-to-VFS action; the FE renders the "Forked from module"
     * chip + the "Revert to module" header button.
     */
    readonly latestVersionSource?: 'vfs' | 'contributor' | null;
    /**
     * Ship A Phase 5+ (FE polish) -- the `moduleLock` flag on the
     * latest version row. Only meaningful when
     * `latestVersionSource === 'contributor'`.
     */
    readonly moduleLock?: boolean | null;
}

/**
 * Shape of the `POST /api/v1/workflows/{key}/deploy`
 * response. Mirrors the backend `WorkflowDeployResource`. The
 * `version` field is the just-minted version number (1-based); the
 * wrapper surfaces it in a toast so the editor confirms the deploy
 * landed without needing to re-fetch the definition.
 */
export interface WorkflowDeployResult {
    readonly definitionKey: string;
    readonly version: number;
    readonly versionId: string;
    /** ISO 8601 / RFC 3339 timestamp. */
    readonly deployedAt: string;
}

/**
 * Shape of the polish-bundle (F-1)
 * `GET /api/v1/workflows/{key}/versions/{version}` response. Mirrors
 * the backend `WorkflowVersionResource`. The viewer surfaces
 * `deployedAt` in the header chrome and mounts `body` via the same
 * `bpmnLiteJsonToModel` path the draft editor uses.
 */
export interface WorkflowVersionPayload {
    readonly definitionKey: string;
    readonly version: number;
    /** BPMN-Lite JSON body string, pinned at deploy time. */
    readonly body: string;
    /** ISO 8601 timestamp the version row was deployed at. */
    readonly deployedAt: string;
    /**
     * Ship A Phase 5+ (FE polish) -- the source discriminator on
     * this specific version row. `'contributor'` triggers the
     * "shipped by module" badge in the viewer; `'vfs'` (or null on
     * older API responses) renders no badge.
     */
    readonly source?: 'vfs' | 'contributor' | null;
    /**
     * Ship A Phase 5+ (FE polish) -- the `moduleLock` flag on this
     * specific version row. Used by the viewer to decide whether to
     * show the "Fork to VFS" CTA (locked rows have already been
     * forked; the fork would 409).
     */
    readonly moduleLock?: boolean | null;
}
