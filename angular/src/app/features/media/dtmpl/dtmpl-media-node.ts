import { type Injector } from '@angular/core';
import { Node, mergeAttributes, type RawCommands } from '@tiptap/core';
import { MediaNodeView } from './media-node-view';

/** Asset kind dispatched by the backend MediaWidgetRenderer based on MIME. */
export type MediaKind = 'image' | 'video' | 'audio' | 'file';

/**
 * Map a MIME type to its renderable kind. Mirrors the backend
 * MediaWidgetRenderer dispatch so the editor preview matches what gets
 * rendered server-side. Centralised here so every consumer (Tiptap node,
 * transform, host component) agrees.
 */
export function kindForMime(mime: string | null | undefined): MediaKind {
    if (!mime) return 'file';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'file';
}

/**
 * Inline-SVG data URIs used as the editor preview when no usable thumbnail
 * exists for non-image kinds (audio/file always; video when no poster). Kept
 * in the bundle (not external assets) so they survive offline mode and avoid
 * an extra request per inserted node.
 */
const KIND_PLACEHOLDER: Record<MediaKind, string> = {
    image: '',
    video: 'data:image/svg+xml;utf8,'
        + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<rect width="100" height="100" fill="%23e5e7eb"/>'
        + '<polygon points="40,30 40,70 72,50" fill="%23F5A623"/>'
        + '</svg>',
    audio: 'data:image/svg+xml;utf8,'
        + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<rect width="100" height="100" fill="%23e5e7eb"/>'
        + '<circle cx="44" cy="62" r="12" fill="%23F5A623"/>'
        + '<rect x="54" y="28" width="6" height="34" fill="%23F5A623"/>'
        + '</svg>',
    file: 'data:image/svg+xml;utf8,'
        + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<rect width="100" height="100" fill="%23e5e7eb"/>'
        + '<path d="M30 22 L60 22 L78 40 L78 78 L30 78 Z" fill="%239ca3af"/>'
        + '<path d="M60 22 L60 40 L78 40" fill="%23ffffff"/>'
        + '</svg>',
};

function parseIntOrNull(raw: string | null): number | null {
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

function isPositiveNumber(v: unknown): boolean {
    return typeof v === 'number' && v > 0;
}

/** Pluck a `cms-media-align-{left|center|right}` token out of a class attribute. */
function parseAlignFromClass(cls: string | null): MediaAlign | null {
    if (!cls) return null;
    const m = cls.match(/\bcms-media-align-(left|center|right)\b/);
    return m ? (m[1] as MediaAlign) : null;
}

/** Resolve a usable preview src for the editor inline preview. */
export function previewSrcForKind(kind: MediaKind, previewUrl: string | null | undefined): string {
    if (kind === 'image') return previewUrl ?? '';
    // Video may carry a poster (thumbnail); use it when present, else placeholder.
    if (kind === 'video' && previewUrl) return previewUrl;
    return KIND_PLACEHOLDER[kind];
}

/**
 * Attribute set for the {widget:media:UUID size=…} dtmpl tag, mirrored as a
 * Tiptap node so editor authors get an inline preview while the stored
 * content remains the original widget tag (round-tripped on save/load).
 *
 *   uuid       - asset id (the only mandatory attribute)
 *   size       - thumbnail preset name; matches the renderer's `size=` param
 *   kind       - 'image' | 'video' | 'audio' | 'file'; drives editor preview
 *                rendering. Re-derived from MIME on load via MediaService.
 *   alt        - per-instance alt text; falls back to the asset's default
 *                translation when null at render time
 *   class      - optional CSS class hoisted onto the rendered <img>
 *   previewUrl - editor-only convenience (resolved client-side); NEVER
 *                serialised to the stored dtmpl
 */
/** Float / centering choices the renderer maps to `cms-media-align-*` classes. */
export type MediaAlign = 'left' | 'center' | 'right';

export interface MediaWidgetAttrs {
    uuid:        string;
    size:        'small' | 'medium' | 'large' | 'print' | 'original';
    kind?:       MediaKind;
    alt?:        string | null;
    class?:      string | null;
    previewUrl?: string | null;
    /** Pixel width set by the inline drag-resize handles. Null = natural size. */
    width?:      number | null;
    /** Pixel height — typically auto-derived but exposed for explicit sizing. */
    height?:     number | null;
    /** Float / centering. Renders as a CSS utility class on the marker img. */
    align?:      MediaAlign | null;
    /** Optional caption text. When set, renderHTML wraps the marker img in
     *  a `<figure>` with a `<figcaption>`. */
    caption?:    string | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        mediaWidget: {
            insertMedia: (attrs: MediaWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Per-extension options. Carries the root Angular Injector so the NodeView
 * can open the alt-editor overlay (CDK Overlay + ComponentPortal) on
 * selectNode() without having to reach into a global. The
 * `provideCoolmsEditorMedia()` factory captures the Injector at boot and
 * passes it via `MediaWidget.configure({ injector })` when registering
 * the extension factory with EditorExtensionRegistry.
 */
export interface MediaWidgetOptions {
    injector: Injector | null;
}

/**
 * Custom Tiptap node that mirrors a `{widget:media:UUID …}` dtmpl tag.
 *
 * In-editor: renders as a regular inline `<img>` so authors see the asset
 *            in place. The `data-widget="media"` marker plus `data-uuid` /
 *            `data-size` / `data-kind` attributes carry the round-trip
 *            metadata. Non-image kinds use a static placeholder src so the
 *            editor still shows a recognisable thumbnail (play icon for
 *            video, sound icon for audio, file icon for documents).
 * On save:   the page editor's `htmlToDtmpl()` post-processor swaps each
 *            marker `<img>` back into the original `{widget:media:…}` form.
 *            The dtmpl tag carries no `kind`; the backend redetects from
 *            the asset's MIME at render time.
 * On load:   `dtmplToHtml()` re-derives `kind` from MIME via MediaService
 *            and stamps `data-kind` on the produced marker `<img>`.
 */
export const MediaWidget = Node.create<MediaWidgetOptions>({
    name:        'mediaWidget',
    group:       'inline',
    inline:      true,
    atom:        true,
    selectable:  true,
    draggable:   true,

    addOptions(): MediaWidgetOptions {
        return { injector: null };
    },

    addAttributes() {
        // Per-attribute renderHTML returns `{}` for attrs surfaced by the
        // node-level renderHTML below: it composes the canonical attribute
        // set (data-widget/data-uuid/data-size/data-kind, src, alt, class,
        // loading) from node.attrs directly, so letting Tiptap auto-emit
        // each attribute as a same-named HTML attribute would only produce
        // redundant camelCase markup like `uuid="..." previewurl="..."`.
        return {
            uuid:       { default: null,     parseHTML: (el: HTMLElement) => el.getAttribute('data-uuid'),               renderHTML: () => ({}) },
            size:       { default: 'medium', parseHTML: (el: HTMLElement) => el.getAttribute('data-size') ?? 'medium',   renderHTML: () => ({}) },
            kind:       { default: 'image',  parseHTML: (el: HTMLElement) => (el.getAttribute('data-kind') as MediaKind | null) ?? 'image', renderHTML: () => ({}) },
            alt:        { default: null,     parseHTML: (el: HTMLElement) => el.getAttribute('alt'),                     renderHTML: () => ({}) },
            class:      { default: null,     parseHTML: (el: HTMLElement) => el.getAttribute('class'),                   renderHTML: () => ({}) },
            previewUrl: { default: null,     parseHTML: (el: HTMLElement) => el.getAttribute('src'),                     renderHTML: () => ({}) },
            // Optional pixel width set by drag-resize. Stored as a number;
            // renderHTML only emits the `width=` HTML attribute when present
            // so legacy nodes (no width) round-trip without a phantom attr.
            width: {
                default: null,
                parseHTML: (el: HTMLElement) => parseIntOrNull(el.getAttribute('width')),
                renderHTML: (attrs: Record<string, unknown>) =>
                    isPositiveNumber(attrs['width']) ? { width: String(attrs['width']) } : {},
            },
            height: {
                default: null,
                parseHTML: (el: HTMLElement) => parseIntOrNull(el.getAttribute('height')),
                renderHTML: (attrs: Record<string, unknown>) =>
                    isPositiveNumber(attrs['height']) ? { height: String(attrs['height']) } : {},
            },
            // Align is stored as a separate attribute so we can drop just the
            // `cms-media-align-*` utility from the user-supplied class on save
            // (it composes with `class` per-render rather than mutating it).
            align: {
                default: null,
                parseHTML: (el: HTMLElement) => parseAlignFromClass(el.getAttribute('class')),
                renderHTML: () => ({}), // composed into the class attribute via the node's own renderHTML
            },
            // Caption is taken from a sibling <figcaption> when the marker
            // <img> lives inside a <figure data-caption-host>. parseHTML()
            // handles that lookup at the rule level.
            caption: {
                default: null,
                parseHTML: () => null,
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [
            // Figure-wrapped marker (caption present): higher priority so
            // ProseMirror picks the figure over its inner img.
            {
                tag: 'figure',
                priority: 110,
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement)) return false;
                    const inner = node.querySelector('img[data-widget="media"]');
                    if (!inner) return false;
                    const captionEl = node.querySelector('figcaption');
                    return {
                        uuid:       inner.getAttribute('data-uuid'),
                        size:       inner.getAttribute('data-size') ?? 'medium',
                        kind:       (inner.getAttribute('data-kind') as MediaKind | null) ?? 'image',
                        alt:        inner.getAttribute('alt'),
                        class:      inner.getAttribute('class'),
                        previewUrl: inner.getAttribute('src'),
                        width:      parseIntOrNull(inner.getAttribute('width')),
                        height:     parseIntOrNull(inner.getAttribute('height')),
                        align:      parseAlignFromClass(inner.getAttribute('class')),
                        caption:    captionEl?.textContent ?? null,
                    };
                },
            },
            // Higher priority than the stock Image extension (default 50) so a
            // marker <img data-widget="media"> is claimed by us, not by Image.
            { tag: 'img[data-widget="media"]', priority: 100 },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        // All visible attributes are read straight off node.attrs: the
        // per-attribute renderHTML overrides above suppress same-named
        // emissions (uuid/size/kind/alt/class/previewUrl), so we compose
        // the canonical data-* + standard-attr set here. width and height
        // keep their own renderHTML which conditionally emits `width=N` /
        // `height=N` as standard HTML attributes; mergeAttributes picks
        // those up from HTMLAttributes.
        const attrs   = node.attrs as Record<string, unknown>;
        const align   = attrs['align']   as MediaAlign | null | undefined;
        const caption = attrs['caption'] as string | null | undefined;

        const kind       = (attrs['kind'] as MediaKind | undefined) ?? 'image';
        const uuid       = attrs['uuid']       as string | null | undefined;
        const size       = attrs['size']       as string | undefined;
        const previewUrl = attrs['previewUrl'] as string | null | undefined;
        const userClass  = typeof attrs['class'] === 'string' ? (attrs['class']) : '';
        const altAttr    = (attrs['alt'] as string | null | undefined) ?? '';

        const src = previewSrcForKind(kind, previewUrl);
        const baseClass = userClass.replace(/\bcms-media-align-(left|center|right)\b/g, '').trim();
        const composed = align ? (baseClass ? `${baseClass} cms-media-align-${align}` : `cms-media-align-${align}`) : baseClass;

        const imgAttrs = mergeAttributes(HTMLAttributes, {
            'data-widget': 'media',
            'data-kind':   kind,
            ...(uuid ? { 'data-uuid': uuid } : {}),
            ...(size ? { 'data-size': size } : {}),
            src,
            alt:           altAttr,
            loading:       'lazy',
            ...(composed ? { class: composed } : {}),
        });
        if (typeof caption === 'string' && caption !== '') {
            return ['figure', {}, ['img', imgAttrs], ['figcaption', {}, caption]];
        }
        return ['img', imgAttrs];
    },

    addCommands() {
        return {
            insertMedia: (attrs: MediaWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },

    /**
     * Custom NodeView wraps the marker `<img>` so we can layer corner resize
     * handles + a CDK Overlay-mounted alt editor on top. renderHTML still
     * emits a flat `<img>`, so `getHTML()` (and the dtmpl transform that
     * runs over it) sees exactly the same shape as before this NodeView
     * was added. The Injector captured in `this.options.injector` lets the
     * NodeView open the alt-editor overlay without owning a component ref.
     */
    addNodeView() {
        const injector = this.options.injector;
        return ({ node, editor, getPos }) =>
            new MediaNodeView(node, editor, getPos, injector);
    },
});
