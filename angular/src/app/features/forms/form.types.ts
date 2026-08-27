// Typed contract for the Form Builder admin (Track D.3).
// Mirrors the backend FormDefinitionResource / FormFieldTypeResource VOs.
// No `any` anywhere.

/**
 * Where a form's authoritative definition lives (read-only discriminator set by
 * the backend FormDefinitionProvider):
 *   - 'shipped' — module-bundled source only; editing it mints a DB override.
 *   - 'db'      — a `coolms_form_config_overrides` row (DB wins on read).
 *   - 'file'    — a user-owned YAML in the configured write directory.
 */
export type FormSource = 'shipped' | 'db' | 'file';

/**
 * Storage backend selector accepted on write (Track D.2 chained writer).
 * 'auto' = file-when-writable else DB, with a shipped form's edit always landing
 * as a DB override. Explicit 'yaml' / 'php' / 'db' force a backend.
 */
export type FormStorage = 'auto' | 'yaml' | 'php' | 'db';

/**
 * A single field entry inside a form's `fields` map. Matches
 * {@link FormFieldConfig::toArray()} exactly — `options` are Symfony
 * FormBuilder::add() options (label/required/help/attr/placeholder/choices…),
 * `constraints` is the raw Symfony validator map (e.g. `{ NotBlank: null }`),
 * and `mapping.property_path` is the optional explicit binding.
 */
export interface FormFieldEntry {
    readonly type: string;
    readonly options?: Record<string, unknown>;
    readonly constraints?: Record<string, unknown>;
    readonly mapping?: { readonly property_path?: string };
}

/** Form fields keyed by field id. */
export type FormFieldsMap = Record<string, FormFieldEntry>;

/** A form definition as returned by `GET /forms` / `GET /forms/{id}`. */
export interface FormDefinitionDto {
    readonly id: string;
    /**
     * Read-only friendly label resolved by the backend provider
     * (`formOptions.title`/`.label` else a humanized id). Ignored on write —
     * `id` stays canonical. Used by the form list + BPMN formKey picker.
     */
    readonly name?: string;
    readonly dataClass?: string | null;
    readonly formOptions?: Record<string, unknown>;
    readonly fields: FormFieldsMap;
    readonly storage?: FormStorage;
    readonly directory?: string | null;
    /** Read-only; set by the provider, ignored on write. */
    readonly source?: FormSource;
}

/** Write payload for `POST /forms`. `id` + `fields` required; rest optional. */
export interface CreateFormRequest {
    readonly id: string;
    readonly fields: FormFieldsMap;
    readonly dataClass?: string | null;
    readonly formOptions?: Record<string, unknown>;
    readonly storage?: FormStorage;
    readonly directory?: string | null;
}

/** Merge-patch payload for `PATCH /forms/{id}` (id comes from the URI). */
export interface UpdateFormRequest {
    readonly fields?: FormFieldsMap;
    readonly dataClass?: string | null;
    readonly formOptions?: Record<string, unknown>;
    readonly storage?: FormStorage;
    readonly directory?: string | null;
    /**
     * FB-0: when true, the submitted `fields` + `formOptions` + `dataClass`
     * REPLACE the stored definition wholesale (no deep-merge) — required to
     * delete a field, reorder fields, or shorten `formOptions.layout`. The Form
     * Builder always sends this since it holds the complete form.
     */
    readonly replace?: boolean;
}

/** A palette entry from `GET /form-field-types`. */
export interface FormFieldTypeDto {
    readonly type: string;
    readonly label: string;
    /** True for choice/select types — the inspector shows a choices editor. */
    readonly hasOptions: boolean;
    /** Default Symfony options to seed a fresh field of this type with. */
    readonly defaults: Record<string, unknown>;
}
