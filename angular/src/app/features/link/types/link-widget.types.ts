/**
 * Wire-shape types for the LinkWidget Tiptap node and its bidirectional
 * transform. Mirrors the backend LinkWidgetRenderer contract from
 * `src/Link/Infrastructure/DTMPL/LinkWidgetRenderer.php`.
 */

/** Five backend resolvers correspond to five target types. */
export type LinkTargetType = 'page' | 'section' | 'vfs' | 'url' | 'route';

/**
 * Types whose identifier travels in the colon path of the dtmpl tag
 * (`{widget:link:TYPE:HEX_UUID ...}`). The DTMPL lexer accepts only
 * `[A-Za-z_][A-Za-z0-9_]*` inside identifier tokens, so UUIDs in this
 * position must be the 32-character hex form (no hyphens).
 */
export const COLON_PATH_TYPES: readonly LinkTargetType[] = ['page', 'section', 'vfs'];

export interface LinkWidgetAttrs {
    /** Which backend resolver claims this target. */
    targetType: LinkTargetType;

    /**
     * Resolver-specific identifier:
     *   page / section / vfs - canonical UUID (`8-4-4-4-12`); converted to
     *                          hex form when written to dtmpl.
     *   url                  - literal URL.
     *   route                - Symfony route name.
     */
    targetId: string;

    /** Cached anchor text. The renderer prefers this over the resolver's label. */
    label: string;

    /** Anchor `target` attribute (`_self`, `_blank`, etc.). */
    target: string | null;

    /** Anchor `rel` attribute. The backend appends `noopener` for external. */
    rel: string | null;

    /** Anchor `class` attribute. */
    className: string | null;

    /**
     * JSON-encoded string of route params (only relevant when
     * targetType==='route'). Round-trip from dtmpl to editor works for
     * routes WITHOUT this field; the encoding for route params with
     * embedded `{` / `}` is deferred until the picker (B2) settles on
     * a stable scheme.
     */
    routeParams: string | null;

    /**
     * When true, the renderer ignores the cached label and re-reads the
     * resolver-provided label on every render. Used when authors want
     * page renames to flow through to existing links automatically.
     */
    useLatestLabel: boolean;
}
