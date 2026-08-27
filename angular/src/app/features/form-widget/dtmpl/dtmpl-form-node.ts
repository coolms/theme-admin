import { Node, mergeAttributes } from '@tiptap/core';
import type { FormWidgetAttrs } from '../types/form-widget.types';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        formWidget: {
            insertFormWidget: (attrs: FormWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Block-level atom Tiptap node mirroring a `{widget:form formId=<id>}` dtmpl
 * tag. Editor authors see a non-editable "form" chip; the stored content
 * round-trips through the form widget transform pair, and the backend
 * FormRenderWidgetRenderer renders the real (multi-step) form at SSR time.
 *
 * In-editor: `<div data-widget="form" data-form-id="…" data-form-name="…">`
 *            styled as a chip ("📋 Form: name"). Atom — authors pick the form
 *            through the picker rather than typing into the node.
 * On save:   `htmlToDtmpl()` swaps the marker div into `{widget:form formId=…}`.
 * On load:   `dtmplToHtml()` rebuilds the marker div from the dtmpl tag.
 */
export const FormWidget = Node.create({
    name:       'formWidget',
    group:      'block',
    atom:       true,
    selectable: true,
    draggable:  true,

    addAttributes() {
        return {
            formId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-form-id') ?? '',
                renderHTML: () => ({}),
            },
            formName: {
                default: null,
                parseHTML: (el: HTMLElement) =>
                    el.getAttribute('data-form-name') ?? el.getAttribute('data-form-id') ?? null,
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-widget="form"]', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as FormWidgetAttrs;
        const label = attrs.formName || attrs.formId || 'form';
        const dataAttrs: Record<string, string> = {
            'data-widget':    'form',
            'data-form-id':   attrs.formId,
            'data-form-name': String(label),
            'class':          'cms-form-widget',
            // Editor-only chip styling; storage drops the whole div for the
            // `{widget:form …}` tag, so these never reach the saved content.
            'style': 'display:flex;align-items:center;gap:8px;padding:10px 14px;margin:6px 0;'
                + 'border:1px dashed #94a3b8;border-radius:8px;background:#f1f5f9;'
                + 'color:#334155;font-size:13px;font-weight:600;user-select:none;',
            'contenteditable': 'false',
        };
        return ['div', mergeAttributes(HTMLAttributes, dataAttrs), `📋 Form: ${label}`];
    },

    addCommands() {
        return {
            insertFormWidget: (attrs: FormWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },
});
