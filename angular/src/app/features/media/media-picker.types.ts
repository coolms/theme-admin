/**
 * MediaPickerComponent contract types.
 *
 * The widget is selected via the YAML form config:
 *   widget: media-picker
 *   options:
 *       bindValue:  'uuid' | 'path'                       # what the form POSTs
 *       display:    'thumb' | 'original'                   # chip / grid rendering
 *       accept:     string                                  # MIME glob, e.g. 'image/*'
 *       bindTarget: 'asset' | 'collection' | 'either'      # what the user can select
 */

/** Which scalar identifier the picker emits as the field value. */
export type MediaPickerBindValue = 'uuid' | 'path';

/**
 * Variant rendered in the trigger chip and grid thumbnails.
 *   - 'thumb' / 'original': use the canonical thumbnailUrl / originalUrl.
 *   - 'preset:<name>': pick the URL from MediaAssetDto.presetUrls[<name>].
 *     The picker validates <name> against /api/v1/media/presets and falls
 *     back to 'thumb' on misspellings (with a console warning).
 */
export type MediaPickerDisplay = 'thumb' | 'original' | `preset:${string}`;

/** Library zone tab — shared library vs the current user's private folder. */
export type MediaPickerZone = 'shared' | 'private';

/**
 * How the picker mounts inside its host.
 *
 *   - 'inline'   (default): renders a trigger button that opens a CDK Overlay
 *                dropdown anchored to itself, with optional escalation to a
 *                'Open browser' modal. Used by form fields.
 *   - 'embedded': renders the panel content directly inside the host's layout
 *                (no trigger, no overlay, no escalation). The host owns the
 *                outer chrome and sizing; the picker just fills available
 *                space. Used by MediaPickerHostComponent so the Tiptap
 *                'Insert media' dialog doesn't clip the panel footer.
 */
export type MediaPickerMode = 'inline' | 'embedded';

/**
 * What the user is allowed to pick.
 *   - 'asset' (default): only files. Folders are nav-only.
 *   - 'collection': only folders. Files are visible for context but not selectable.
 *   - 'either': both. Selection emit shape becomes a discriminator object.
 */
export type MediaPickerBindTarget = 'asset' | 'collection' | 'either';

export interface MediaPickerOptions {
    readonly bindValue?:    MediaPickerBindValue;
    readonly display?:      MediaPickerDisplay;
    readonly accept?:       string;
    readonly bindTarget?:   MediaPickerBindTarget;
    /** Show a 'Recent' row at the top of the grid backed by localStorage LRU. */
    readonly recentlyUsed?: boolean;
    /** Show a larger preview popup on prolonged thumbnail hover. */
    readonly hoverPreview?: boolean;
}

/** Internal selection record carried between dropdown and modal modes. */
export interface MediaPickerSelection {
    readonly kind:        'asset' | 'collection';
    readonly uuid:        string;     // empty string for 'collection' kind
    readonly path:        string | null;
    readonly filename:    string;     // collection name for 'collection' kind
    readonly thumbUrl:    string | null;
    readonly origUrl:     string | null;
    /** Natural pixel dimensions of the original asset (image/video). null
     *  for non-visual assets, collections, and assets where the backend has
     *  not extracted dimensions yet. Used by host config rows to pre-fill
     *  width/height inputs. */
    readonly dimensions?: { readonly width: number; readonly height: number } | null;
    /** Resolved per-preset URLs (only for 'asset' kind). Keys are preset names. */
    readonly presetUrls?: Readonly<Record<string, string>>;
}

/**
 * Public emit shape from `valueChange` on the picker.
 *
 *   - bindTarget: 'asset' | 'collection' -> string (uuid or path) | null (cleared)
 *   - bindTarget: 'either'                -> { kind, value } | null (cleared)
 *
 * When the picker is consumed through `RelationFieldComponent` and the bound
 * field uses `bindTarget: 'either'`, the discriminator object is JSON-encoded
 * into the underlying FormControl as a string before form submission. The
 * receiving backend resource MUST JSON-decode the field on save and dispatch
 * on `payload.kind` to resolve either an asset (uuid|path) or a collection
 * path. Plain-string emits (the 'asset' / 'collection' modes) need no
 * decoding — they survive standard form serialisation as-is.
 */
export type MediaPickerEmit =
    | string
    | string[]
    | null
    | { readonly kind: 'asset' | 'collection'; readonly value: string }
    | ReadonlyArray<{ readonly kind: 'asset' | 'collection'; readonly value: string }>;
