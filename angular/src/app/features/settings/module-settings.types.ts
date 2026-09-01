/**
 * Typed contract for `/api/v1/module-settings` — mirrors ModuleSettingsResource.
 *
 * Every operation on that surface is `is_granted('ROLE_ADMIN')`: settings are
 * operational configuration, not content. Who may publish an article and who may
 * change how the platform behaves are different questions.
 */

/** One module's admin-editable settings block. */
export interface ModuleSettingsBlockDto {
    /** The config-store id, e.g. `dynamic_chat.prechat`. Also the IRI identifier. */
    readonly key: string;
    /** The owning module SLUG — the grouping key on the hub page, not a heading. */
    readonly module: string;
    /**
     * How the module wants to be named in a heading, e.g. `Dynamic Chat`.
     * Null when it did not say; the hub de-slugifies rather than shout the key.
     */
    readonly moduleLabel: string | null;
    /** Bootstrap Icons name (no `bi-` prefix) for the group heading, or null. */
    readonly moduleIcon: string | null;
    /**
     * Admin-relative route to the module's own page (`dynamic-chat`), making the
     * group heading a link back to the thing being configured. Null for a module
     * with no page of its own.
     */
    readonly moduleRoute: string | null;
    /** Human label for the block. */
    readonly label: string;
    /**
     * The Form definition describing the block's fields, or null when the module
     * declared none.
     *
     * Null means "no UI yet", NOT "no settings" — the block is still editable
     * over the API, so the page shows what is stored rather than an empty form
     * that would claim there is nothing to set.
     */
    readonly formId: string | null;
    /**
     * The saved values, keyed by field. Empty when the block has never been
     * edited: the module's shipped defaults apply and the caller cannot tell the
     * difference, which is intended.
     *
     * This is a MAP, which is why the service pins `Accept: application/json` —
     * see the note there.
     */
    readonly data: Record<string, unknown>;
    /**
     * What applies where `data` is silent: the module's shipped values, stated
     * by its settings contributor. Read-only -- they come from the module.
     */
    readonly defaults: Record<string, unknown>;
    /**
     * `data` over `defaults` -- the configuration actually IN FORCE, and what a
     * form should render.
     *
     * Composed by the SERVER, by the same reader every module reads its own
     * settings through, and passed straight through here. It used to be
     * recomposed in this file with a spread while each PHP consumer recomposed
     * it with a type guard, and the two disagreed for a key saved as `null`:
     * cleared on screen, still-the-default on the server. One merge, one answer
     * (ADR-165).
     */
    readonly effective: Record<string, unknown>;
    /**
     * Keys this deployment PINS in its environment, as
     * `settings key -> env var name`. Empty for most blocks.
     *
     * Rendered read-only, naming the variable. That pairing is the whole point:
     * `effective` already ignores a saved value for a pinned key, so an editable
     * control would take an edit, report a save, and change nothing. The server
     * refuses a write carrying one, so these must also be kept OUT of the
     * payload (ADR-165).
     */
    readonly locked: Record<string, string>;
    /**
     * Whether one site may override this block.
     *
     * The site selector renders only where this is true. Most blocks are
     * platform-wide, and offering the choice anyway would invite a save the
     * server then refuses with a 422.
     */
    readonly siteScopable: boolean;
    /**
     * Which site these values are for, or null for the platform-wide view.
     *
     * ⚠️ At a site scope `data` is what THAT SITE overrode and `effective` is
     * what it runs on. The screen needs both: without the difference an operator
     * cannot tell a value they set here from one they are inheriting, and would
     * reset a site expecting the platform value to change.
     */
    readonly scope: string | null;
    /**
     * Where the last write landed: an absolute path, or `db://settings/{key}`.
     * Surfaced after a save because "it went to the database because config/ is
     * read-only" answers a question an operator would otherwise ask twice.
     */
    readonly storedAt: string | null;
}

/**
 * The same block as it actually arrives on the wire.
 *
 * `data` is `unknown` rather than a map because PHP has one array type: an
 * EMPTY settings map JSON-encodes as `[]`, so a block nobody has edited comes
 * back typed as a list. ModuleSettingsService normalises it once on the way in
 * and hands the rest of the app the honest {@link ModuleSettingsBlockDto}.
 */
export interface ModuleSettingsWireDto
    extends Omit<ModuleSettingsBlockDto, 'data' | 'defaults' | 'effective' | 'locked' | 'siteScopable' | 'scope'> {
    readonly data: unknown;
    readonly defaults?: unknown;
    readonly effective?: unknown;
    readonly locked?: unknown;
    readonly siteScopable?: unknown;
    readonly scope?: unknown;
}
