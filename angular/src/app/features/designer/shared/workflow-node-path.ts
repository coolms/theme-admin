import { VfsNodeDto } from '@coolms/ui-angular';

/**
 * VFS virtual-MIME constants + node-path helpers for the Workflow
 * (BPMN-Lite) designer surface.
 *
 * Extracted from the (now-retired) bespoke `bpmn-editor-dialog` so the
 * generic {@link DesignerEditorDialogComponent} — which replaced it as
 * the File-Explorer editor for `.bpmn.json` files — can derive the
 * workflow key + version from the double-clicked VFS node without
 * depending on the old dialog. `app.config.ts` registers these MIMEs
 * against the generic dialog; the dialog calls the two helpers to map a
 * `{ node }` payload onto a `{ surface, key, version }` mount.
 */

/**
 * Mime stamped on the Workflow Package container node
 * (`/workflows/{key}/`) by the
 * `WorkflowVirtualMimeProvider`.
 */
export const WORKFLOW_PACKAGE_MIME = 'application/vnd.coolms.workflow';

/**
 * Mime stamped on the BPMN-Lite body files
 * (`draft.bpmn.json`, `v{N}.bpmn.json`) by the installer +
 * deployer.
 */
export const WORKFLOW_BPMN_LITE_BODY_MIME =
    'application/vnd.coolms.workflow.bpmn-lite+json';

/**
 * Derive the workflow definition key from a VFS node's path.
 *
 *  - Package container `/workflows/{key}/` -> returns `{key}`.
 *  - Body file `/workflows/{key}/draft.bpmn.json` or
 *    `/workflows/{key}/v{N}.bpmn.json` -> returns `{key}`.
 *  - Anything else (path doesn't start with `/workflows/`, or has no
 *    key segment) -> returns null. Callers surface this as a "cannot
 *    derive workflow key" error.
 */
export function workflowKeyFromNode(node: VfsNodeDto): string | null {
    const path = node.path;
    if (!path.startsWith('/workflows/')) return null;
    const rest = path.slice('/workflows/'.length);
    if (rest === '') return null;
    const slashIdx = rest.indexOf('/');
    const key = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    return key === '' ? null : key;
}

/**
 * Detect a deployed-version body file (`/workflows/{key}/v{N}.bpmn.json`)
 * and extract its monotonic version number `N`. Returns null for any
 * non-version path — Package containers, `draft.bpmn.json`, and any
 * other shape default to editor mode.
 *
 *  - `/workflows/identity.verify/v3.bpmn.json` -> `3`
 *  - `/workflows/identity.verify/draft.bpmn.json` -> null
 *  - `/workflows/identity.verify` (Package) -> null
 *  - `/workflows/identity.verify/v3.bpmn.json.bak` -> null
 *  - `/workflows/x/v0.bpmn.json` -> `0` (legal at the path level — the
 *    backend returns 404 if no v0 exists, which is the correct UX)
 */
export function workflowVersionFromNode(node: VfsNodeDto): number | null {
    const match = /^\/workflows\/[^/]+\/v(\d+)\.bpmn\.json$/.exec(node.path);
    if (match === null) return null;
    const n = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(n) ? n : null;
}
