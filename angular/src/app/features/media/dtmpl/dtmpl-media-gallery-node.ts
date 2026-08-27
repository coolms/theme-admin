import { Node, mergeAttributes, type RawCommands } from '@tiptap/core';

/** Layout strategies the backend MediaWidgetRenderer dispatches on. */
export type GalleryType = 'grid' | 'slider' | 'list';

/**
 * Attribute set for `{widget:media:<collection-uuid> type=…}` dtmpl tags.
 * Mirrors the collection-mode dispatch in the backend renderer, which resolves
 * the UUID to a directory Node and renders its images.
 *
 *   collectionId - VFS directory Node UUID of the collection. Required.
 *   name         - human-readable collection name; display-only (the editor
 *                  placeholder card label). Editor-only — NOT serialized into the
 *                  dtmpl tag (the tag lexer rejects double-quoted values), so the
 *                  card shows it in-session but falls back to a generic label
 *                  after reload.
 *   galleryType  - 'grid' | 'slider' | 'list'. Defaults to 'grid'.
 *   cols         - column count for the grid layout (1-6); ignored otherwise.
 *   limit        - max number of items to pull from the collection.
 *   depth        - recursive folder traversal depth (1 = direct children).
 */
export interface MediaGalleryWidgetAttrs {
    collectionId: string;
    name?:        string;
    galleryType?: GalleryType;
    cols?:        number | null;
    limit?:       number | null;
    depth?:       number | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        mediaGalleryWidget: {
            insertGallery: (attrs: MediaGalleryWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Inline-block placeholder Tiptap node that mirrors a
 * `{widget:media:<collection-uuid> …}` collection-mode dtmpl tag. The editor
 * preview is informational only (icon + collection name + summary) — the actual
 * gallery markup is produced server-side by MediaWidgetRenderer when the page is
 * rendered. Authors edit attributes by deleting + re-inserting until a future
 * inline editor lands.
 */
export const MediaGalleryWidget = Node.create({
    name:       'mediaGalleryWidget',
    group:      'block',
    inline:     false,
    atom:       true,
    selectable: true,
    draggable:  true,

    addAttributes() {
        return {
            collectionId: { default: '',     parseHTML: (el: HTMLElement) => el.getAttribute('data-collection') ?? '' },
            name:         { default: '',     parseHTML: (el: HTMLElement) => el.getAttribute('data-name') ?? '' },
            galleryType:  { default: 'grid', parseHTML: (el: HTMLElement) => (el.getAttribute('data-type') as GalleryType | null) ?? 'grid' },
            cols:         { default: null,   parseHTML: (el: HTMLElement) => parseNumOrNull(el.getAttribute('data-cols')) },
            limit:        { default: null,   parseHTML: (el: HTMLElement) => parseNumOrNull(el.getAttribute('data-limit')) },
            depth:        { default: null,   parseHTML: (el: HTMLElement) => parseNumOrNull(el.getAttribute('data-depth')) },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-widget="media-gallery"]', priority: 100 }];
    },

    renderHTML({ HTMLAttributes }) {
        const collectionId = String(HTMLAttributes['collectionId'] ?? '');
        const name  = String(HTMLAttributes['name'] ?? '');
        const type  = String(HTMLAttributes['galleryType'] ?? 'grid');
        const cols  = HTMLAttributes['cols'];
        const limit = HTMLAttributes['limit'];
        const depth = HTMLAttributes['depth'];

        const summaryParts: string[] = [type];
        if (typeof cols  === 'number' && cols  > 0) summaryParts.push(`${cols} cols`);
        if (typeof limit === 'number' && limit > 0) summaryParts.push(`${limit} items`);
        if (typeof depth === 'number' && depth > 0) summaryParts.push(`depth ${depth}`);
        const summary = summaryParts.join(', ');
        // Card label: the collection name, falling back to a generic word when
        // none was carried (e.g. older content, or a hand-pasted tag).
        const label = name !== '' ? name : 'Gallery';

        return ['div', mergeAttributes(HTMLAttributes, {
            'data-widget':     'media-gallery',
            'data-collection': collectionId,
            'data-name':       name,
            'data-type':       type,
            'data-cols':       cols  ?? '',
            'data-limit':      limit ?? '',
            'data-depth':      depth ?? '',
            class:             'cms-media-gallery-placeholder',
        }),
            ['span', { class: 'cms-media-gallery-placeholder__icon' },
                ['i', { class: 'bi bi-grid-3x3-gap-fill' }],
            ],
            ['span', { class: 'cms-media-gallery-placeholder__path' }, label],
            ['span', { class: 'cms-media-gallery-placeholder__summary' }, ` (${summary})`],
        ];
    },

    addCommands() {
        return {
            insertGallery: (attrs: MediaGalleryWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },
});

/** Parse `data-cols=""` (or any optional numeric attr) safely; null if absent. */
function parseNumOrNull(raw: string | null): number | null {
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
