/**
 * Bidirectional HTML <-> dtmpl transform for the `formWidget` Tiptap node.
 *
 * On save:  htmlToDtmpl() rewrites every `<div data-widget="form" …>…</div>`
 *           marker into `{widget:form formId=`<id>`}`. The id is BACKTICK-quoted
 *           so dotted / colon-bearing ids (e.g. `dynamic_entity:field_definition`)
 *           tokenize cleanly — matching the FormRenderWidgetRenderer convention.
 * On load:  dtmplToHtml() does the inverse, rebuilding a minimal marker div the
 *           FormWidget node's parseHTML rehydrates (the node re-renders the chip).
 *
 * Accepts BOTH the named-param form `{widget:form formId=<id>}` and the legacy
 * positional form `{widget:form:<id>}` on load, so older content keeps working;
 * on save it always emits the named-param form (the unambiguous, renderer-safe
 * syntax).
 *
 * Disjoint namespace: this transform only touches `<div data-widget="form">` /
 * `{widget:form …}`, so it composes order-independently with the media, link,
 * formField and embed transforms.
 */

const FORM_MARKER_RE = /<div\b[^>]*\bdata-widget=(["'])form\1[^>]*>[\s\S]*?<\/div>/gi;
const FORM_WIDGET_TAG_RE = /\{widget:form(?::([^\s}]+))?(?:\s+([^}]*))?\}/g;

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

/**
 * Strip a single layer of matching surrounding backtick / double / single
 * quotes from a positional id, unescaping the same quote inside.
 *
 * DTMPL now supports backtick LITERALS in the id slot so an id with a dot
 * (`a.b.c`) or a UUID's dashes tokenizes cleanly — so a hand-authored
 * positional tag may arrive as `` {widget:form:`a.b.c`} ``. The positional
 * capture grabs the whole `` `a.b.c` `` (quotes included); without unwrapping,
 * the chip would carry literal backticks in its id. Named-param values are
 * already unwrapped by parseParams; this covers the positional slot.
 */
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

/**
 * Encode a form id for the positional id slot of `{widget:form:<id>}`.
 *
 * Colon-bearing ids (`calendar:list`, `dynamic_entity:field_definition`) need
 * NO quoting — the whole tail after `form:` is the id. A bare dot, though,
 * lexes as a DOT token and breaks the tag, so an id containing a dot (or
 * whitespace / a backtick / a brace) is wrapped in a backtick LITERAL, the
 * unambiguous form the DTMPL lexer accepts for any id.
 */
function encodeFormId(id: string): string {
    return /[.\s`{}]/.test(id) ? '`' + id.replace(/`/g, '\\`') + '`' : id;
}

/** Convert editor HTML into stored dtmpl. */
export function htmlToDtmpl(html: string): string {
    return html.replace(FORM_MARKER_RE, (match) => {
        const formId = matchAttr(match, 'data-form-id');
        if (!formId) return match; // malformed marker — leave for source-mode fixing
        // Short, uniform notation: every widget is `{widget:<type>:<id>}`. The
        // backend routes a non-exact id to the generic FormRenderWidgetRenderer
        // (positional id → `_id` → formId), so a form is addressed purely by id.
        return '{widget:form:' + encodeFormId(formId) + '}';
    });
}

/** Convert stored dtmpl into editor HTML (a minimal marker the node rehydrates). */
export function dtmplToHtml(content: string): string {
    return content.replace(FORM_WIDGET_TAG_RE, (full, positional: string | undefined, paramsStr: string | undefined) => {
        const params = parseParams(paramsStr ?? '');
        const formId = params['formId'] ?? (positional !== undefined ? unwrapLiteral(positional) : '');
        if (formId === '') return full; // no id — leave the raw tag visible in source mode
        const safe = escapeAttr(formId);
        return `<div data-widget="form" data-form-id="${safe}" data-form-name="${safe}"></div>`;
    });
}
