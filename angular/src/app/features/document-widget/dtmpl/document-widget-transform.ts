/**
 * Bidirectional HTML ↔ dtmpl transform for the `documentWidget` Tiptap node.
 *
 * On save:  `htmlToDtmpl()` rewrites every `<div data-widget="document" …>…</div>`
 *           marker into `` {widget:document:`<slug>`} ``, carrying
 *           `output_format` / `label` when the author set them.
 * On load:  `dtmplToHtml()` does the inverse, rebuilding a minimal marker div
 *           that the node's `parseHTML` rehydrates into the chip.
 *
 * ⚠️ **Positional id, not a named param.** `DocumentWidgetRenderer` reads the
 * template slug from the tag's SECOND `:` segment (`$params['_id']`) — unlike
 * the form widget, which uses `formId=`. Emitting `{widget:document slug=…}`
 * would parse cleanly and render nothing, because `_id` would be empty.
 *
 * The slug is BACKTICK-quoted so a dotted or dashed slug tokenizes cleanly,
 * matching the convention the form transform uses for ids.
 *
 * Disjoint namespace: this only touches `<div data-widget="document">` and
 * `{widget:document…}`, so it composes order-independently with the media,
 * link, formField, embed and form transforms.
 */

const DOC_MARKER_RE = /<div\b[^>]*\bdata-widget=(["'])document\1[^>]*>[\s\S]*?<\/div>/gi;
const DOC_WIDGET_TAG_RE = /\{widget:document:([^\s}]+)(?:\s+([^}]*))?\}/g;

function matchAttr(html: string, name: string): string | null {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(html);

    return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/** Parse a dtmpl params string (backtick / double / single / bare values). */
function parseParams(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(\w[\w-]*)\s*=\s*(?:`((?:\\`|[^`])*)`|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s}]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        let val = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
        if (m[2] !== undefined)      val = val.replace(/\\`/g, '`');
        else if (m[3] !== undefined) val = val.replace(/\\"/g, '"');
        else if (m[4] !== undefined) val = val.replace(/\\'/g, "'");
        out[m[1]] = val;
    }

    return out;
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttr(s: string): string {
    return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Strip one layer of matching backtick / double / single quotes. */
function unwrapLiteral(s: string): string {
    const t = s.trim();
    if (t.length < 2) return t;
    const q = t[0];
    if ((q === '`' || q === '"' || q === "'") && t[t.length - 1] === q) {
        const inner = t.slice(1, -1);

        return q === '`' ? inner.replace(/\\`/g, '`')
            : q === '"' ? inner.replace(/\\"/g, '"')
                : inner.replace(/\\'/g, "'");
    }

    return t;
}

/** Editor HTML → stored dtmpl. */
export function htmlToDtmpl(html: string): string {
    return html.replace(DOC_MARKER_RE, marker => {
        const slug = matchAttr(marker, 'data-slug');
        // A marker with no slug is unrenderable; dropping it beats storing a
        // tag the SSR renderer will turn into an error box for every visitor.
        if (!slug) return '';

        const format = matchAttr(marker, 'data-output-format');
        const label  = matchAttr(marker, 'data-label');

        let tag = `{widget:document:\`${unescapeAttr(slug).replace(/`/g, '\\`')}\``;
        if (format) tag += ` output_format=${unescapeAttr(format)}`;
        if (label)  tag += ` label=\`${unescapeAttr(label).replace(/`/g, '\\`')}\``;

        return `${tag}}`;
    });
}

/** Stored dtmpl → editor HTML. */
export function dtmplToHtml(content: string): string {
    return content.replace(DOC_WIDGET_TAG_RE, (_full, rawSlug: string, rawParams?: string) => {
        const slug = unwrapLiteral(rawSlug);
        if (!slug) return '';

        const params = parseParams(rawParams ?? '');
        const format = params['output_format'] ?? '';
        const label  = params['label'] ?? '';

        const attrs = [
            'data-widget="document"',
            `data-slug="${escapeAttr(slug)}"`,
            `data-name="${escapeAttr(slug)}"`,
        ];
        if (format) attrs.push(`data-output-format="${escapeAttr(format)}"`);
        if (label)  attrs.push(`data-label="${escapeAttr(label)}"`);

        return `<div ${attrs.join(' ')}></div>`;
    });
}
