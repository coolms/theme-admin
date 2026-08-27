import { Node, mergeAttributes, type RawCommands } from '@tiptap/core';
import type { LinkTargetType, LinkWidgetAttrs } from '../types/link-widget.types';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        linkWidget: {
            insertLink: (attrs: LinkWidgetAttrs) => ReturnType;
        };
    }
}

/**
 * Custom Tiptap node that mirrors a `{widget:link:TYPE[:HEX] ...}` dtmpl
 * tag. Editor authors see a regular inline `<a>` while the stored content
 * round-trips through the LinkWidget transform pair.
 *
 * In-editor: renders as `<a data-widget="link" data-target-type="..."
 *            data-target-id="..." href="#">label</a>`. The `href="#"`
 *            is editor-only; the authoritative URL is produced by the
 *            backend resolver at render time.
 * On save:   `htmlToDtmpl()` swaps each marker `<a>` into
 *            `{widget:link:TYPE[:HEX] params}`.
 * On load:   `dtmplToHtml()` produces marker `<a>` from the dtmpl tag.
 *
 * Atom node (no editable content). Authors edit attributes through the
 * picker (B2) rather than typing into the anchor.
 */
export const LinkWidget = Node.create({
    name:       'linkWidget',
    group:      'inline',
    inline:     true,
    atom:       true,
    selectable: true,
    draggable:  true,

    addAttributes() {
        // All per-attribute renderHTML overrides return {} so Tiptap does not
        // emit each attribute as a same-named HTML attribute. The node-level
        // renderHTML below composes the canonical attribute set (data-widget,
        // data-target-type, data-target-id, target, rel, class, etc.) from
        // node.attrs directly. The parseHTML rules read those data-* and
        // standard attributes back, keeping the round-trip lossless.
        return {
            targetType: {
                default: 'url' as LinkTargetType,
                parseHTML: (el: HTMLElement) =>
                    (el.getAttribute('data-target-type') as LinkTargetType | null) ?? 'url',
                renderHTML: () => ({}),
            },
            targetId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-target-id') ?? '',
                renderHTML: () => ({}),
            },
            label: {
                default: '',
                parseHTML: (el: HTMLElement) => el.textContent ?? '',
                renderHTML: () => ({}),
            },
            target: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('target'),
                renderHTML: () => ({}),
            },
            rel: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('rel'),
                renderHTML: () => ({}),
            },
            className: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('class'),
                renderHTML: () => ({}),
            },
            routeParams: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-route-params'),
                renderHTML: () => ({}),
            },
            useLatestLabel: {
                default: false,
                parseHTML: (el: HTMLElement) =>
                    el.getAttribute('data-use-latest-label') === 'true',
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        // Higher priority than the stock Link mark (default 50) so a
        // marker `<a data-widget="link">` is claimed by us rather than
        // turned into a link mark on a text node.
        return [
            { tag: 'a[data-widget="link"]', priority: 100 },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as LinkWidgetAttrs;

        const dataAttrs: Record<string, string> = {
            'data-widget':      'link',
            'data-target-type': attrs.targetType,
            'data-target-id':   attrs.targetId,
        };
        if (attrs.routeParams) {
            dataAttrs['data-route-params'] = attrs.routeParams;
        }

        const htmlAttrs: Record<string, string> = {
            ...dataAttrs,
            // Editor-only placeholder. The backend resolver builds the
            // real URL at render time; using `#` keeps clicks inside the
            // editor inert without wiring up a custom NodeView.
            href: '#',
        };
        if (attrs.target)    htmlAttrs['target'] = attrs.target;
        if (attrs.rel)       htmlAttrs['rel']    = attrs.rel;
        if (attrs.className) htmlAttrs['class']  = attrs.className;

        return ['a', mergeAttributes(HTMLAttributes, htmlAttrs), attrs.label];
    },

    addCommands() {
        return {
            insertLink: (attrs: LinkWidgetAttrs) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs }),
        };
    },
});
