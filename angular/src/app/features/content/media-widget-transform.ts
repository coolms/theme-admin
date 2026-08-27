import { type MediaKind } from '../media/dtmpl/dtmpl-media-node';

/**
 * Bidirectional HTML <-> dtmpl transform for the MediaWidget Tiptap node.
 *
 * On save:  htmlToDtmpl() rewrites every `<img data-widget="media" …>` back
 *           into its `{widget:media:UUID …}` source form before the content
 *           is sent to the backend. The `data-kind` attribute is dropped —
 *           the backend re-derives it from the asset's MIME type, so the
 *           dtmpl tag stays kind-agnostic and lossless across re-renders.
 * On load:  dtmplToHtml() does the inverse, resolving each uuid to a preview
 *           URL + kind (via the caller-supplied resolver, which typically
 *           batches MediaService.get calls) so Tiptap can show a recognisable
 *           inline preview without one round-trip per node.
 *
 * The pair is required to be lossless: dtmpl -> HTML -> dtmpl produces an
 * identical string (modulo whitespace and attribute ordering inside the
 * widget tag), so a save/reload cycle never mutates user content.
 */

const MEDIA_IMG_RE = /<img\b[^>]*\bdata-widget=(["'])media\1[^>]*>/gi;
/**
 * Figure-wrapped marker: emitted when the node has a caption attr. The lazy
 * inner-content match keeps figure boundaries tight — figcaption text can
 * include any character except the closing `</figcaption>` sequence.
 */
const MEDIA_FIGURE_RE = /<figure\b[^>]*>\s*<img\b[^>]*\bdata-widget=(["'])media\1[^>]*>\s*<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi;
const WIDGET_TAG_RE = /\{widget:media:([0-9a-f-]+)\s+([^}]+)\}/gi;
/** Inline-block placeholder div emitted by MediaGalleryWidget node's renderHTML. */
const MEDIA_GALLERY_DIV_RE = /<div\b[^>]*\bdata-widget=(["'])media-gallery\1[^>]*>[\s\S]*?<\/div>/gi;
const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

function matchAttr(html: string, name: string): string | null {
    const m = ATTR_RE(name).exec(html);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
}

/**
 * Escape a string for use inside a BACKTICK-delimited dtmpl param value.
 *
 * The DTMPL tag lexer's only string delimiter is the backtick (Lexer::scanTag);
 * a double-quoted param value falls through to the else-branch and throws
 * "Unexpected character" → HTTP 500 at SSR render. So string params are
 * backtick-delimited, and the lexer's only in-string escape is `\``
 * (Lexer::scanString). We therefore escape only literal backticks; every other
 * character — including double quotes, `&`, `<`, `}` — is safe verbatim. The
 * stored value is RAW text: the theme partial HTML-escapes it on output via the
 * `escape` filter, so we must NOT pre-encode here.
 *
 * Caveat (matches the lexer's escape grammar): a value ending in a lone `\`
 * immediately before the closing delimiter is not representable, since the
 * lexer would read `\`` as an escaped backtick. Captions never end in a
 * backslash in practice; doubling backslashes is not an option because the
 * lexer doesn't collapse `\\`.
 */
function escapeBacktick(s: string): string {
    return s.replace(/`/g, '\\`');
}

/** HTML-attribute escape for the inverse path. */
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Parse a dtmpl widget params string ("size=medium alt=\"hi\" class=hero")
 * into a plain key/value map. Handles quoted values with escaped quotes,
 * single-quoted values, and bare tokens; later occurrences win.
 */
function parseParams(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    // Backtick is the canonical (and only lex-safe) delimiter we emit; the
    // double/single-quote branches remain only to read any pre-fix editor draft
    // that still carries quoted params (such content 500s at SSR but may still
    // sit in an unsaved draft we want to load without data loss).
    const re = /(\w[\w-]*)\s*=\s*(?:`((?:\\`|[^`])*)`|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s}]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const key = m[1];
        let val = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
        if (m[2] !== undefined) val = val.replace(/\\`/g, '`');
        else if (m[3] !== undefined) val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        else if (m[4] !== undefined) val = val.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        out[key] = val;
    }
    return out;
}

/**
 * Strip a `cms-media-align-{left|center|right}` token out of a class string.
 * Used so the dtmpl `class=` param doesn't double up with the `align=` param
 * after a renderHTML/parseHTML round-trip.
 */
function stripAlignClass(cls: string): { class: string; align: string | null } {
    const m = cls.match(/\bcms-media-align-(left|center|right)\b/);
    const align = m ? m[1] : null;
    const stripped = cls.replace(/\bcms-media-align-(left|center|right)\b/g, '').replace(/\s+/g, ' ').trim();
    return { class: stripped, align };
}

/** Decode HTML entities (&amp; &quot; &lt; &gt;) back to their literal form. */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Build the `{widget:media:UUID …}` source for a single marker img element.
 * Returns null when the img doesn't carry a usable data-uuid (caller should
 * pass the original match through unchanged in that case).
 */
function buildSingleAssetTag(imgHtml: string): string | null {
    const uuid = matchAttr(imgHtml, 'data-uuid');
    if (!uuid) return null;

    const size   = matchAttr(imgHtml, 'data-size') ?? 'medium';
    const alt    = matchAttr(imgHtml, 'alt');
    const rawCls = matchAttr(imgHtml, 'class');
    const width  = matchAttr(imgHtml, 'width');
    const height = matchAttr(imgHtml, 'height');

    // Pull the align class out of the user class so the two params are
    // orthogonal in the dtmpl tag (cleaner save/inspection).
    const split = rawCls ? stripAlignClass(rawCls) : { class: '', align: null as string | null };

    const params: string[] = [`size=${size}`];
    if (split.align)              params.push(`align=${split.align}`);
    // alt/class are backtick-delimited (the lexer's only string form; a
    // double-quoted value 500s at SSR). Decode the HTML-attribute entities the
    // editor serialized so the stored value is RAW text — the theme partial
    // re-escapes it once on output, so storing the encoded form double-encodes.
    if (alt    && alt    !== '')  params.push(`alt=\`${escapeBacktick(decodeHtmlEntities(alt))}\``);
    if (split.class !== '')       params.push(`class=\`${escapeBacktick(decodeHtmlEntities(split.class))}\``);
    if (width  && width  !== '')  params.push(`width=${width}`);
    if (height && height !== '')  params.push(`height=${height}`);
    return `{widget:media:${uuid} ${params.join(' ')}}`;
}

/**
 * Convert editor HTML into stored dtmpl. Three replacements run, in order:
 *   1. Figure-wrapped markers `<figure><img data-widget="media">…<figcaption>` →
 *      ``{widget:media:UUID … caption=`…`}``. Runs first so its inner img isn't
 *      separately consumed by the bare-img pass.
 *   2. Bare markers `<img data-widget="media">` → `{widget:media:UUID …}`.
 *   3. Gallery placeholder divs `<div data-widget="media-gallery">` →
 *      `{widget:media:<collection-uuid> type=… [cols=… limit=… depth=…]}`. Only
 *      unquoted, lex-safe params are emitted; the display name is dropped.
 *
 * String-valued single-asset params (alt/class/caption) are BACKTICK-delimited
 * — the tag lexer's only string delimiter; a double-quoted value throws
 * "Unexpected character" → HTTP 500 at SSR. The gallery branch carries no
 * string params, so it stays fully unquoted. Unmarked elements (raw paste from
 * source mode) pass through.
 */
export function htmlToDtmpl(html: string): string {
    let out = html.replace(MEDIA_FIGURE_RE, (_match, _q, captionRaw) => {
        // Re-extract the inner img to share the same param logic as the bare
        // path. The figure wrapper only adds the caption param.
        const imgMatch = _match.match(MEDIA_IMG_RE);
        const innerImg = imgMatch ? imgMatch[0] : '';
        const inner = buildSingleAssetTag(innerImg);
        if (!inner) return _match; // malformed: keep figure as-is

        const captionDecoded = decodeHtmlEntities(String(captionRaw)).trim();
        if (captionDecoded === '') return inner;
        // Splice caption param in before the closing `}`. Backtick-delimited
        // (lex-safe; a double-quoted value 500s at SSR); captionDecoded is
        // already RAW text, which the theme partial escapes once on output.
        return inner.replace(/\}$/, ` caption=\`${escapeBacktick(captionDecoded)}\`}`);
    });

    out = out.replace(MEDIA_IMG_RE, (match) => buildSingleAssetTag(match) ?? match);

    out = out.replace(MEDIA_GALLERY_DIV_RE, (match) => {
        const collectionId = matchAttr(match, 'data-collection');
        if (!collectionId) return match; // malformed: keep as-is rather than dropping content
        const type  = matchAttr(match, 'data-type') ?? 'grid';
        const cols  = matchAttr(match, 'data-cols');
        const limit = matchAttr(match, 'data-limit');
        const depth = matchAttr(match, 'data-depth');

        // Emit ONLY unquoted, lex-safe params. The DTMPL tag lexer's only string
        // delimiter is the backtick; a double-quoted value (e.g. name="…") throws
        // "Unexpected character" at SSR render time. So the collection display
        // name is NOT stored in the tag — it lives only on the in-editor node,
        // and the card falls back to a generic label after reload. (A future
        // uuid→name resolve-on-load can restore the label without a stored param.)
        const params: string[] = [`type=${type}`];
        if (cols  && cols  !== '') params.push(`cols=${cols}`);
        if (limit && limit !== '') params.push(`limit=${limit}`);
        if (depth && depth !== '') params.push(`depth=${depth}`);
        return `{widget:media:${collectionId} ${params.join(' ')}}`;
    });

    return out;
}

/** Per-asset hints returned by the resolver passed to {@link dtmplToHtml}. */
export interface MediaResolveResult {
    /** Preview URL the editor should show inline, or null when unresolved. */
    readonly url:  string | null;
    /** Asset kind, derived from MIME — drives video/audio/file placeholders. */
    readonly kind: MediaKind;
}

/**
 * Convert stored dtmpl into editor HTML. Each `{widget:media:UUID …}` tag is
 * replaced with either a marker `<img>` (single asset) that the MediaWidget node
 * picks up via `parseHTML`, or a `<div data-widget="media-gallery">` placeholder
 * (collection gallery) for the MediaGalleryWidget node. The caller-supplied
 * `resolve(uuid, size)` is consulted for single assets; returning `null` falls
 * back to an empty src and `kind: 'image'`. The returned kind is stamped as
 * `data-kind` on the img so the node renders the right placeholder for
 * video/audio/file assets.
 */
export function dtmplToHtml(
    content: string,
    resolve: (uuid: string, size: string) => MediaResolveResult | null,
): string {
    return content.replace(WIDGET_TAG_RE, (_match, uuid: string, paramsStr: string) => {
        const params = parseParams(paramsStr);

        // Galleries (collection-mode) always carry `type=`; single assets never
        // do. Both now share the `{widget:media:<uuid> …}` prefix, so branch on
        // `type=` to keep them from cross-claiming.
        if (params['type'] !== undefined) {
            return buildGalleryDiv(uuid, params);
        }

        const size = params['size'] ?? 'medium';
        const resolved = resolve(uuid, size);
        const previewUrl = resolved?.url ?? '';
        const kind: MediaKind = resolved?.kind ?? 'image';

        // Compose the class attribute from the user-supplied class plus the
        // align utility class (if present). Mirrors the renderer's behaviour
        // so editor preview and frontend page render line up.
        const userCls   = params['class'] ?? '';
        const align     = params['align'];
        const composed  = align ? (userCls ? `${userCls} cms-media-align-${align}` : `cms-media-align-${align}`) : userCls;

        const altAttr    = params['alt']    ? ` alt="${escapeAttr(params['alt'])}"`         : '';
        const clsAttr    = composed         ? ` class="${escapeAttr(composed)}"`             : '';
        const widthAttr  = params['width']  ? ` width="${escapeAttr(params['width'])}"`     : '';
        const heightAttr = params['height'] ? ` height="${escapeAttr(params['height'])}"`   : '';

        const img = `<img data-widget="media" data-kind="${kind}" data-uuid="${escapeAttr(uuid)}" data-size="${escapeAttr(size)}" src="${escapeAttr(previewUrl)}" loading="lazy"${altAttr}${clsAttr}${widthAttr}${heightAttr}>`;

        // Caption present → wrap in <figure>+<figcaption> so parseHTML's figure
        // rule re-hydrates the node with the caption attribute on load.
        const caption = params['caption'];
        if (caption && caption !== '') {
            return `<figure>${img}<figcaption>${escapeAttr(caption)}</figcaption></figure>`;
        }
        return img;
    });
}

/**
 * Build the editor placeholder `<div data-widget="media-gallery">` for a
 * collection-mode tag. Mirrors the MediaGalleryWidget node's renderHTML so the
 * source→visual round-trip is stable before Tiptap re-runs the node renderer.
 * `name` (if present) is the display label; the backend ignores it.
 */
function buildGalleryDiv(collectionId: string, params: Record<string, string>): string {
    const type  = params['type']  ?? 'grid';
    const name  = params['name']  ?? '';
    const cols  = params['cols']  ?? '';
    const limit = params['limit'] ?? '';
    const depth = params['depth'] ?? '';

    // Build the human-readable summary the placeholder div shows. Mirrors the
    // renderHTML logic on the node so source→visual round-trip is visually
    // stable even before Tiptap re-runs the node's renderer.
    const summaryParts: string[] = [type];
    if (cols)  summaryParts.push(`${cols} cols`);
    if (limit) summaryParts.push(`${limit} items`);
    if (depth) summaryParts.push(`depth ${depth}`);
    const summary = summaryParts.join(', ');
    const label = name !== '' ? name : 'Gallery';

    return [
        `<div data-widget="media-gallery"`,
        ` data-collection="${escapeAttr(collectionId)}"`,
        ` data-name="${escapeAttr(name)}"`,
        ` data-type="${escapeAttr(type)}"`,
        ` data-cols="${escapeAttr(cols)}"`,
        ` data-limit="${escapeAttr(limit)}"`,
        ` data-depth="${escapeAttr(depth)}"`,
        ` class="cms-media-gallery-placeholder">`,
        `<span class="cms-media-gallery-placeholder__icon">`,
        `<i class="bi bi-grid-3x3-gap-fill"></i>`,
        `</span>`,
        `<span class="cms-media-gallery-placeholder__path">${escapeAttr(label)}</span>`,
        `<span class="cms-media-gallery-placeholder__summary"> (${escapeAttr(summary)})</span>`,
        `</div>`,
    ].join('');
}

/**
 * Walk the dtmpl content and return the set of distinct media uuids it
 * references. The page editor uses this on load to batch-resolve preview
 * URLs in a single pass before invoking `dtmplToHtml` (avoids N round-trips
 * per asset).
 */
export function extractMediaUuids(content: string): string[] {
    const set = new Set<string>();
    // Skip gallery (collection-mode) tags — they carry `type=`, and their UUID
    // points at a directory, not a resolvable asset, so a MediaService.get on it
    // would 404. Only single-asset UUIDs need preview resolution.
    const re = /\{widget:media:([0-9a-f-]+)\s+([^}]+)\}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        if (/\btype\s*=/.test(m[2])) continue;
        set.add(m[1]);
    }
    return Array.from(set);
}
