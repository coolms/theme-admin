import { Node, mergeAttributes } from '@tiptap/core';

/** Attributes carried by a `documentWidget` node. */
export interface DocumentWidgetAttrs {
    /** Template slug — the `_id` segment of `{widget:document:<slug>}`. */
    readonly slug: string;
    /** Human template name, for the editor chip only; never stored. */
    readonly name?: string | null;
    /** `docx` | `pdf`; omitted stores nothing and the template's default wins. */
    readonly outputFormat?: string | null;
    /** Button text override; omitted stores nothing. */
    readonly label?: string | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        documentWidget: {
            insertDocumentWidget: (attrs: DocumentWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Block-level atom mirroring a `{widget:document:<template-slug>}` dtmpl tag.
 *
 * ⚠️ **This embeds a GENERATE button, not a file.** The published page renders a
 * "Generate {template}" control; the reader clicks it and a document is produced
 * for them on demand. That is why the picker behind it lists TEMPLATES rather
 * than browsing the VFS — attaching an existing PDF is a different feature
 * (`<cms-file-picker>`), and conflating them is the mistake this node's
 * existence is meant to prevent.
 *
 * In-editor: `<div data-widget="document" data-slug="…">` styled as a chip.
 *            Atom, because the slug is picked rather than typed.
 * On save:   `htmlToDtmpl()` swaps the marker div for `{widget:document:<slug>}`.
 * On load:   `dtmplToHtml()` rebuilds the marker div, which `parseHTML` rehydrates.
 */
export const DocumentWidget = Node.create({
    name:       'documentWidget',
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
            outputFormat: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-output-format') || null,
                renderHTML: () => ({}),
            },
            label: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-label') || null,
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-widget="document"]', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as DocumentWidgetAttrs;
        const label = attrs.name || attrs.slug || 'document';
        const format = attrs.outputFormat ? ` (${attrs.outputFormat.toUpperCase()})` : '';
        const dataAttrs: Record<string, string> = {
            'data-widget': 'document',
            'data-slug':   attrs.slug,
            'data-name':   String(label),
            'class':       'cms-document-widget',
            // Editor-only chip styling; storage drops the div entirely for the
            // `{widget:document:…}` tag, so none of this reaches saved content.
            'style': 'display:flex;align-items:center;gap:8px;padding:10px 14px;margin:6px 0;'
                + 'border:1px dashed #94a3b8;border-radius:8px;background:#f1f5f9;'
                + 'color:#334155;font-size:13px;font-weight:600;user-select:none;',
            'contenteditable': 'false',
        };
        if (attrs.outputFormat) dataAttrs['data-output-format'] = attrs.outputFormat;
        if (attrs.label)        dataAttrs['data-label']         = attrs.label;

        return ['div', mergeAttributes(HTMLAttributes, dataAttrs), `📄 Document: ${label}${format}`];
    },

    addCommands() {
        return {
            insertDocumentWidget: (attrs: DocumentWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },
});
