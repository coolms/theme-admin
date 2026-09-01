import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { BpmnEditorPage } from './bpmn-editor.page';
import { DmnEditorPage } from './dmn-editor.page';
import { VfsNodeDto } from '@coolms/ui-angular';
import { workflowKeyFromNode, workflowVersionFromNode } from './shared/workflow-node-path';

/**
 * The four designer surfaces, keyed the same way the shell's
 * `createEditor({ surface })` keys them.
 */
export type DesignerSurface =
    | 'bpmn-lite'
    | 'dmn-table'
    | 'dmn-drd'
    | 'state-machine';

/**
 * Explicit data — opened from the Definitions list (decision / workflow
 * rows) which already know the surface + key.
 */
export interface DesignerEditorDialogExplicitData {
    readonly surface: DesignerSurface;
    readonly key: string;
    /** Optional title shown in the modal header; defaults to the key. */
    readonly title?: string;
    /**
     * Read-only viewer version for `bpmn-lite` (`v{N}`); null / undefined
     * = editor mode (the editable draft). Ignored by other surfaces.
     */
    readonly version?: number | null;
}

/**
 * File-Explorer entry — the {@link FileEditorRegistry} hands the dialog the
 * VFS node the user double-clicked. The surface + key (+ viewer version) are
 * derived from the node's path. Today only the Workflow (BPMN-Lite) MIMEs are
 * registered against this dialog.
 */
export interface DesignerEditorDialogNodeData {
    readonly node: VfsNodeDto;
}

/** Data passed in by the opener via CDK `Dialog.open(..., { data })`. */
export type DesignerEditorDialogData =
    | DesignerEditorDialogExplicitData
    | DesignerEditorDialogNodeData;

/**
 * Generic, surface-parameterized modal host for the designer editors.
 *
 * The four designers (BPMN-Lite / DMN-table / DMN-DRD / state-machine)
 * are each already a self-contained routed page that mounts its own
 * editor stack + Save/Deploy toolbar + load/serialize/deploy lifecycle.
 * Rather than clone each page into a bespoke dialog (the drift that the
 * old single-purpose `bpmn-editor-dialog` started), this ONE dialog hosts
 * the matching page component embedded — `[key]` overrides the route param,
 * `[version]` (bpmn-lite) selects read-only viewer mode, and `[embedded]`
 * hides the page's `<cms-page-header>` (the modal supplies its own header
 * chrome). The "surface map" is the `@switch` below.
 *
 * **Two opener shapes** (see the data union):
 *  - **Definitions list** passes `{ surface, key, title }` (always editor
 *    mode for the catalog's workflow + decision rows).
 *  - **File Explorer** passes `{ node }`; this dialog derives the surface +
 *    key from the path and, for a `v{N}.bpmn.json` body file, the
 *    read-only viewer `version`. This replaced the bespoke
 *    `bpmn-editor-dialog` as the registered editor for the Workflow MIMEs.
 *
 * Routed pages (`/admin/designer/...`) stay as deep-linkable surfaces; this
 * is the in-place modal so all designers feel consistent with the image /
 * DTMPL file editors that already open as modals.
 *
 * **Phased rollout:** `bpmn-lite` (editor + viewer) + `dmn-table` are wired;
 * `dmn-drd` / `state-machine` cases land once those surfaces gain a trigger
 * (they aren't in the Definitions catalog or a VFS virtual-MIME today).
 */
@Component({
    selector: 'app-designer-editor-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BpmnEditorPage, DmnEditorPage],
    template: `
        <div
            class="designer-editor-dialog"
            [class.designer-editor-dialog--fullscreen]="fullscreen()"
        >
            <div class="designer-editor-dialog__header">
                <span class="designer-editor-dialog__title">
                    <i class="bi bi-diagram-3"></i>
                    {{ title }}
                </span>
                <div class="designer-editor-dialog__actions">
                    <button
                        type="button"
                        class="cms-btn cms-btn-sm"
                        title="Toggle fullscreen"
                        (click)="fullscreen.set(!fullscreen())"
                    >
                        <i
                            class="bi"
                            [class.bi-fullscreen]="!fullscreen()"
                            [class.bi-fullscreen-exit]="fullscreen()"
                        ></i>
                    </button>
                    <button
                        type="button"
                        class="cms-btn cms-btn-sm"
                        title="Close"
                        (click)="close()"
                    >
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>

            <div class="designer-editor-dialog__body">
                @if (resolveError) {
                    <div class="alert alert-danger m-3" role="alert">
                        {{ resolveError }}
                    </div>
                } @else {
                    @switch (surface) {
                        @case ('bpmn-lite') {
                            <!--
                              TWO branches on purpose. The editor decides
                              editor-vs-viewer once, in ngAfterViewInit;
                              rebinding [version] on a live component
                              would change the input without re-running
                              that decision. Separate branches make
                              Angular destroy and recreate the page, so
                              "View vN (read-only)" switches mode inside
                              the modal instead of reloading the SPA.
                            -->
                            @if (viewerVersion() === null) {
                                <app-bpmn-editor-page
                                    [key]="key"
                                    [version]="version"
                                    [embedded]="true"
                                    (viewReadOnly)="viewerVersion.set($event)"
                                    (cancel)="close()"
                                />
                            } @else {
                                <app-bpmn-editor-page
                                    [key]="key"
                                    [version]="viewerVersion()"
                                    [embedded]="true"
                                    (cancel)="close()"
                                />
                            }
                        }
                        @case ('dmn-table') {
                            <app-dmn-editor-page
                                [key]="key"
                                [embedded]="true"
                                (cancel)="close()"
                            />
                        }
                        @default {
                            <div class="alert alert-danger m-3" role="alert">
                                No designer wired for surface "{{ surface }}".
                            </div>
                        }
                    }
                }
            </div>
        </div>
    `,
    styles: [`
        /* Match the DTMPL / BPMN editor modals (90vw × 90vh) so the
           family of CMS file editors feels consistent. */
        .designer-editor-dialog {
            display: flex;
            flex-direction: column;
            width: 90vw;
            height: 90vh;
            max-width: 1600px;
            background: var(--cms-bg, #f8f9fa);
            border-radius: var(--cms-radius, 6px);
            overflow: hidden;
        }
        .designer-editor-dialog--fullscreen {
            width: 100vw;
            height: 100vh;
            max-width: none;
            border-radius: 0;
        }
        .designer-editor-dialog__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            flex-shrink: 0;
        }
        .designer-editor-dialog__title {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: var(--cms-text, #111827);
        }
        .designer-editor-dialog__actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        /* The hosted page is :host{flex column; flex:1}; give it a flex
           parent so it fills the modal body. */
        .designer-editor-dialog__body {
            flex: 1;
            display: flex;
            min-height: 0;
        }
        .designer-editor-dialog__body > * {
            flex: 1;
            min-width: 0;
        }
    `],
})
export class DesignerEditorDialogComponent {
    private readonly raw = inject<DesignerEditorDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<void>>(DialogRef);

    readonly fullscreen = signal<boolean>(false);

    /**
     * Set when the embedded page asks to switch into read-only viewing
     * (the "shipped by module" banner's View action). Drives the
     * template's two-branch recreate; null = the mode the dialog opened
     * with.
     */
    readonly viewerVersion = signal<number | null>(null);

    /**
     * Normalized mount params, resolved once from either opener shape
     * ({@link DesignerEditorDialogExplicitData} or a File-Explorer
     * {@link DesignerEditorDialogNodeData} node).
     */
    readonly surface: DesignerSurface | null;
    readonly key: string;
    /** Read-only viewer version for bpmn-lite; null = editor mode. */
    readonly version: number | null;
    readonly title: string;
    /** Set when a `{ node }` payload could not be mapped onto a surface. */
    readonly resolveError: string | null;

    constructor() {
        const raw = this.raw;
        if ('node' in raw) {
            // File-Explorer entry — only Workflow (bpmn-lite) MIMEs route
            // here today, so derive that surface from the node's path; a
            // `v{N}.bpmn.json` body file opens read-only (version set).
            const key = workflowKeyFromNode(raw.node);
            if (key === null) {
                this.surface = null;
                this.key = '';
                this.version = null;
                this.title = raw.node.path;
                this.resolveError =
                    `Cannot derive a workflow key from "${raw.node.path}". `
                    + 'The path must start with /workflows/.';
            } else {
                const version = workflowVersionFromNode(raw.node);
                this.surface = 'bpmn-lite';
                this.key = key;
                this.version = version;
                this.title =
                    version !== null
                        ? `Workflow: ${key} · v${version}`
                        : `Workflow: ${key}`;
                this.resolveError = null;
            }
        } else {
            this.surface = raw.surface;
            this.key = raw.key;
            this.version = raw.version ?? null;
            this.title = raw.title ?? raw.key;
            this.resolveError = null;
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}
