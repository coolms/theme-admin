/**
 * Bidirectional HTML ↔ dtmpl transform for the `imageMapWidget` Tiptap node.
 *
 * On save:  `htmlToDtmpl()` rewrites every `<div data-widget="imagemap" …>…</div>`
 *           marker into `` {widget:imagemap:`<slug>`} ``, carrying `date` /
 *           `now` / `class` when they are present.
 * On load:  `dtmplToHtml()` does the inverse, rebuilding a minimal marker div
 *           that the node's `parseHTML` rehydrates into the chip.
 *
 * ⚠️ **Positional id, not a named param.** `ImageMapWidgetRenderer` reads the
 * slug from the tag's SECOND `:` segment (`$params['_id']`). It does also
 * accept `slug=`, and prefers it when both are given — but emitting the named
 * form would diverge from the document widget for no gain, so this follows the
 * positional convention. The slug is BACKTICK-quoted so a dashed or dotted slug
 * tokenizes cleanly.
 *
 * ⚠️ **`date` / `now` / `class` round-trip even though the picker never sets
 * them.** They are the renderer's documented parameters, so a hand-written tag
 * can carry them; a transform that knew only the slug would quietly delete an
 * author's `now=true` the first time they opened the page and pressed Save.
 * That is data loss disguised as a no-op, which is exactly the shape that hides.
 *
 * Disjoint namespace: this only touches `<div data-widget="imagemap">` and
 * `{widget:imagemap…}`, so it composes order-independently with the media,
 * link, formField, embed, form and document transforms.
 */

const MAP_MARKER_RE = /<div\b[^>]*\bdata-widget=(["'])imagemap\1[^>]*>[\s\S]*?<\/div>/gi;
const MAP_WIDGET_TAG_RE = /\{widget:imagemap:([^\s}]+)(?:\s+([^}]*))?\}/g;

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
    return html.replace(MAP_MARKER_RE, marker => {
        const slug = matchAttr(marker, 'data-slug');
        // A marker with no slug is unrenderable; dropping it beats storing a
        // tag that resolves to nothing on every public request.
        if (!slug) return '';

        const date  = matchAttr(marker, 'data-date');
        const now   = matchAttr(marker, 'data-now');
        const klass = matchAttr(marker, 'data-class');

        let tag = `{widget:imagemap:\`${unescapeAttr(slug).replace(/`/g, '\\`')}\``;
        if (date)  tag += ` date=\`${unescapeAttr(date).replace(/`/g, '\\`')}\``;
        if (now)   tag += ` now=\`${unescapeAttr(now).replace(/`/g, '\\`')}\``;
        if (klass) tag += ` class=\`${unescapeAttr(klass).replace(/`/g, '\\`')}\``;

        return `${tag}}`;
    });
}

/** Stored dtmpl → editor HTML. */
export function dtmplToHtml(content: string): string {
    return content.replace(MAP_WIDGET_TAG_RE, (_full, rawSlug: string, rawParams?: string) => {
        const slug = unwrapLiteral(rawSlug);
        if (!slug) return '';

        const params = parseParams(rawParams ?? '');
        const date  = params['date'] ?? '';
        const now   = params['now'] ?? '';
        const klass = params['class'] ?? '';

        const attrs = [
            'data-widget="imagemap"',
            `data-slug="${escapeAttr(slug)}"`,
            `data-name="${escapeAttr(slug)}"`,
        ];
        if (date)  attrs.push(`data-date="${escapeAttr(date)}"`);
        if (now)   attrs.push(`data-now="${escapeAttr(now)}"`);
        if (klass) attrs.push(`data-class="${escapeAttr(klass)}"`);

        return `<div ${attrs.join(' ')}></div>`;
    });
}
