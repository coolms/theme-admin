/**
 * F.14c-1 — wire-shape types shared across the Document Explorer
 * (cross-format) and per-format modules (Word today, future
 * Spreadsheet/Presentation/Markdown). Migrated from the F.13b
 * `document-library.types.ts` and extended with the F.14a/b
 * polymorphic fields (`format`) and the F.14d-3 naming-model fields
 * (`instanceNameSuffix`).
 *
 * The shape mirrors the backend `AbstractTemplate` / `AbstractInstance`
 * resources just narrowly enough to drive the UI; any field not yet
 * rendered stays unmodelled rather than carrying a speculative
 * `unknown`.
 */

/**
 * The per-space templates directory. Mirrors
 * `TemplateRootResolver::TEMPLATES_DIR` on the backend.
 *
 * Not cosmetic and not renameable from here: the backend answers "is
 * this Node a template?" by requiring `.templates` as a whole path
 * segment under a space root the caller can see, and template
 * discovery lists exactly those roots. The UI shows it as `Templates`
 * (see the Documents breadcrumb's `labelOverrides`) but always
 * navigates by the real name.
 */
export const TEMPLATES_DIR = '.templates';

export interface ContextSchemaVariable {
    readonly path: string;
    readonly filters: string[];
    readonly loopAlias: string | null;
    /**
     * Phase 2 (ADR-094) entity reference marker. When set, the
     * Generate dialog renders `<cms-entity-picker>` instead of a
     * plain text input; the persisted value is the entity id, and
     * the backend's render-time `EntityHydratingContributor` swaps
     * it for a flattened projection at render. `null` / absent
     * keeps the legacy scalar behaviour.
     */
    readonly entityType?: string | null;
    /**
     * Phase 2 — when `true` the picker accepts multiple entities
     * and the persisted value is a list of ids.
     */
    readonly collection?: boolean;
    /**
     * Phase 2 — optional allow-list passed to the backend resolver
     * to constrain which fields the hydrated projection exposes.
     * `null` / absent uses the resolver's default field set.
     */
    readonly fields?: string[] | null;
}

export interface ContextSchemaConstant {
    readonly name: string;
}

export interface ContextSchemaLoop {
    readonly path: string;
    readonly alias: string;
}

export interface ContextSchemaConditional {
    readonly path: string;
    readonly negate: boolean;
}

export interface ContextSchema {
    readonly variables: ContextSchemaVariable[];
    readonly constants: ContextSchemaConstant[];
    readonly loops: ContextSchemaLoop[];
    readonly conditionals: ContextSchemaConditional[];
}

/**
 * Every concrete format module's template (WordTemplate today,
 * future SpreadsheetTemplate, etc.) projects to this shape via the
 * F.14a/b polymorphic provider read. The `format` field
 * discriminates so the explorer can dispatch to the right
 * format-specific detail component (Word, Spreadsheet, …) without a
 * hardcoded switch.
 */
export interface DocumentTemplate {
    /**
     * Template id == backing VFS Node UUID. The DocumentTemplateResource
     * is a thin projection over a Node under `/docs/.templates/` (mime
     * `text/x-dtmpl` for native, DOCX mime for imported); the Node id
     * IS the template id, the file id, and the download id. Native
     * bytes are read via the VFS file-content endpoint keyed by `id`.
     */
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    readonly native: boolean;
    readonly sourceMimeType: string | null;
    readonly contextSchema: ContextSchema | null;
    readonly defaultOutputFormat: string;
    /**
     * F.14a/b: format discriminator key. Matches a registered
     * `DocumentFormatProviderInterface::getFormat()` on the backend
     * (`'word'` today; future `'spreadsheet'`, `'presentation'`,
     * `'markdown'`). Drives the UI's per-format dispatch.
     */
    readonly format: string;
    /**
     * F.14d-3: optional DTMPL suffix appended to `name` when minting
     * an instance display name. `null` / empty leaves the display
     * equal to `name`. Editable in F.14c-3's template-edit form.
     */
    readonly instanceNameSuffix: string | null;
    /**
     * Phase 1b-3 widget track -- admin opt-in for anonymous renders.
     * When true, the public `{widget:document:...}` SSR widget emits
     * a working trigger to logged-out visitors; otherwise the widget
     * renders a "login required" placeholder. Edit-Template dialog
     * exposes a checkbox bound to this field.
     */
    readonly publiclyAccessible: boolean;
    /**
     * VFS path of the backing Node. Needed to open the template through the
     * shared `FileEditorRegistry`, which takes a `VfsNodeDto` — and there is
     * no by-id node endpoint, `GET /vfs/files` is keyed by path (#1676).
     */
    readonly path: string | null;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    /**
     * What an uploaded workbook lost becoming an editable CoolMS document.
     *
     * Present only on a template created by converting an upload, and absent
     * — not empty — otherwise, so "was never converted" and "converted and
     * lost nothing" read the same, which they are. The list is the POINT of
     * that choice: the operator traded fidelity for editability and needs to
     * know what it cost.
     */
    readonly conversionNotes?: readonly string[] | null;
}

export interface DocumentFolder {
    readonly path: string;
    readonly name: string;
    readonly parentPath: string | null;
    readonly templateCount: number;
    readonly space: 'shared' | 'personal';
}

/**
 * F.14c-2 — minimal variable shape the input form consumes. Today
 * derived 1-to-1 from `ContextSchemaVariable.path`; `label` is left
 * `null` because the F.13a schema extractor doesn't carry one yet.
 * When F.9's Form Builder lands the input form keeps the same
 * `(variables, initialValue) → submit(nested JSON)` contract — only
 * the source of `FormVariableInput[]` swaps.
 */
export interface FormVariableInput {
    readonly path: string;
    readonly label: string | null;
    /**
     * Phase 2 (ADR-094) — propagated from
     * `ContextSchemaVariable.entityType`. When non-null, the form
     * renders `<cms-entity-picker>` for this variable. The picker
     * emits an entity id (string) for single refs or a list of ids
     * for collections.
     */
    readonly entityType?: string | null;
    readonly collection?: boolean;
    readonly fields?: string[] | null;
}

/**
 * F.14c-2 — recursive group tree the form template walks. A node with
 * `path === ''` is the synthetic root that holds top-level scalars
 * (rendered without a fieldset); every other node renders as a
 * fieldset with `label` as its legend.
 */
export interface ContextVariableGroup {
    readonly path: string;
    readonly label: string;
    readonly variables: readonly FormVariableInput[];
    readonly subgroups: readonly ContextVariableGroup[];
}

/**
 * F.14c-2 — option in the dialog's output-format `<select>`. Sourced
 * from a small per-format mapping today (`word → docx | pdf`); a
 * future backend `format-info` field can supersede it without
 * touching the dialog.
 */
export interface OutputFormatOption {
    readonly value: string;
    readonly label: string;
}
