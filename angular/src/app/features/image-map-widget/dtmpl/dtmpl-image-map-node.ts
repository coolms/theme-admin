import { Node, mergeAttributes } from '@tiptap/core';

/** Attributes carried by an `imageMapWidget` node. */
export interface ImageMapWidgetAttrs {
    /** Map slug — the `_id` segment of `{widget:imagemap:<slug>}`. */
    readonly slug: string;
    /** Human map title, for the editor chip only; never stored. */
    readonly name?: string | null;
    /**
     * `date=` / `now=` / `class=` are NOT set by the picker — they are carried
     * so that a tag someone wrote by hand survives a trip through the editor.
     * Without them, opening such a page and pressing Save would silently drop
     * the author's live-status flag.
     */
    readonly date?: string | null;
    readonly now?: string | null;
    readonly cssClass?: string | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        imageMapWidget: {
            insertImageMapWidget: (attrs: ImageMapWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Block-level atom mirroring a `{widget:imagemap:<slug>}` dtmpl tag.
 *
 * The published page renders the map's base image with the region overlay SVG
 * on top, status-classed through the provider registry. None of that happens
 * here: the editor shows a chip, because the map is picked rather than typed
 * and because rendering it in-editor would need the same auth-gated overlay
 * endpoint a public page deliberately cannot reach.
 *
 * In-editor: `<div data-widget="imagemap" data-slug="…">` styled as a chip.
 * On save:   `htmlToDtmpl()` swaps the marker div for the dtmpl tag.
 * On load:   `dtmplToHtml()` rebuilds the marker, which `parseHTML` rehydrates.
 */
export const ImageMapWidget = Node.create({
    name:       'imageMapWidget',
    group:      'block',
    atom:       true,
    selectable: true,
    draggable:  true,

    addAttributes() {
        return {
            slug: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-slug') ?? '',
                renderHTML: () => ({}),
            },
            name: {
                default: null,
                parseHTML: (el: HTMLElement) =>
                    el.getAttribute('data-name') ?? el.getAttribute('data-slug') ?? null,
                renderHTML: () => ({}),
            },
            date: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-date') || null,
                renderHTML: () => ({}),
            },
            now: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-now') || null,
                renderHTML: () => ({}),
            },
            cssClass: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-class') || null,
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-widget="imagemap"]', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as ImageMapWidgetAttrs;
        const label = attrs.name || attrs.slug || 'image map';
        // Surfaced on the chip because a live-status map is uncacheable on the
        // public page — worth seeing at a glance while authoring.
        const status = attrs.now ? ' · live status' : attrs.date ? ` · ${attrs.date}` : '';
        const dataAttrs: Record<string, string> = {
            'data-widget': 'imagemap',
            'data-slug':   attrs.slug,
            'data-name':   String(label),
            'class':       'cms-imagemap-widget',
            // Editor-only chip styling; storage drops the div entirely for the
            // dtmpl tag, so none of this reaches saved content.
            //
            // Tokenised even so, and NOT copied from the document node's
            // literals: "never saved" is not the same as "never seen". The chip
            // is rendered in the admin, an inline style outranks every rule
            // that could correct it, and a #f1f5f9 box is a light block on a
            // dark editor. The colour ratchet caught this before it shipped.
            'style': 'display:flex;align-items:center;gap:8px;padding:10px 14px;margin:6px 0;'
                + 'border:1px dashed var(--cms-border-strong);border-radius:8px;'
                + 'background:var(--cms-surface-muted);'
                + 'color:var(--cms-text);font-size:13px;font-weight:600;user-select:none;',
            'contenteditable': 'false',
        };
        if (attrs.date)     dataAttrs['data-date']  = attrs.date;
        if (attrs.now)      dataAttrs['data-now']   = attrs.now;
        if (attrs.cssClass) dataAttrs['data-class'] = attrs.cssClass;

        return ['div', mergeAttributes(HTMLAttributes, dataAttrs), `🗺 Image map: ${label}${status}`];
    },

    addCommands() {
        return {
            insertImageMapWidget: (attrs: ImageMapWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },
});
