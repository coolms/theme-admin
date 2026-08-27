import { COLON_PATH_TYPES, type LinkTargetType, type LinkWidgetAttrs } from '../types/link-widget.types';

/**
 * Bidirectional HTML <-> dtmpl transform for the LinkWidget Tiptap node.
 *
 * On save:  htmlToDtmpl() rewrites every `<a data-widget="link" ...>label</a>`
 *           into its `{widget:link:TYPE[:HEX] ...}` source form. UUIDs in
 *           the colon path are converted from canonical 8-4-4-4-12 form
 *           into the 32-char hex form the DTMPL lexer can tokenize.
 * On load:  dtmplToHtml() does the inverse, rebuilding marker anchors so
 *           Tiptap's parseHTML can rehydrate LinkWidget nodes.
 *
 * Pair is required to be lossless for the supported attribute set (modulo
 * attribute ordering inside the widget tag) so a save/reload cycle never
 * mutates user content.
 *
 * Storage limitations (matching the existing media-widget-transform
 * conventions and the backend `[^}]+` widget-body regex):
 *   - `}` characters inside string param values break the body regex.
 *     The picker (B2) is responsible for not producing such values.
 *   - Route widgets with `params={...}` (JSON-shaped route params) are
 *     intentionally NOT round-tripped here. The JSON braces collide
 *     with the widget-body regex; the picker will pick a stable
 *     encoding when route widgets become reachable through the UI.
 */

const LINK_ANCHOR_RE = /<a\b[^>]*\bdata-widget=(["'])link\1[^>]*>([\s\S]*?)<\/a>/gi;
const LINK_WIDGET_TAG_RE = /\{widget:link:([^}\s]+)(?:\s+([^}]*))?\}/g;
const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

function matchAttr(html: string, name: string): string | null {
    const m = ATTR_RE(name).exec(html);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
}

/** Quote-escape for use inside a double-quoted dtmpl param value. */
function escapeQuote(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** HTML-attribute escape for the inverse path. */
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Decode HTML entities back to their literal form. */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Parse a dtmpl widget params string into a plain key/value map. Mirrors
 * the parser in media-widget-transform.ts so storage conventions stay
 * consistent across widget kinds.
 */
function parseParams(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(\w[\w-]*)\s*=\s*(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s}]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const key = m[1];
        let val = m[2] ?? m[3] ?? m[4] ?? '';
        if (m[2] !== undefined)      val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        else if (m[3] !== undefined) val = val.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        out[key] = val;
    }
    return out;
}

/** True iff `value` is a 32-char lowercase hex string. */
function isHexUuid(value: string): boolean {
    return /^[0-9a-f]{32}$/i.test(value);
}

/** True iff `value` is a canonical 8-4-4-4-12 UUID. */
function isCanonicalUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * `01959e1a-fb20-7000-8000-00000000000a` -> `01959e1afb207000800000000000000a`.
 * Returns the input verbatim when it is not a canonical UUID; callers that
 * require strict validation should check {@link isCanonicalUuid} first.
 */
export function canonicalUuidToHex(uuid: string): string {
    return isCanonicalUuid(uuid) ? uuid.replace(/-/g, '').toLowerCase() : uuid;
}

/**
 * `01959e1afb207000800000000000000a` -> `01959e1a-fb20-7000-8000-00000000000a`.
 * Returns the input verbatim when it is not a 32-char hex string.
 */
export function hexToCanonicalUuid(hex: string): string {
    if (!isHexUuid(hex)) return hex;
    const lower = hex.toLowerCase();
    return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

function isColonPathType(type: string): boolean {
    return (COLON_PATH_TYPES as readonly string[]).includes(type);
}

/**
 * Build the `{widget:link:...}` source for a single marker anchor's HTML.
 * Returns null when the anchor lacks a target type or identifier; callers
 * pass the original match through unchanged in that case.
 */
function buildLinkTag(anchorHtml: string, label: string): string | null {
    const targetType = (matchAttr(anchorHtml, 'data-target-type') ?? '') as LinkTargetType | '';
    const targetId   = matchAttr(anchorHtml, 'data-target-id') ?? '';
    if (targetType === '' || targetId === '') return null;

    const colonPath: string[] = ['link', targetType];
    const namedParams: string[] = [];

    if (isColonPathType(targetType)) {
        colonPath.push(canonicalUuidToHex(targetId));
    } else if (targetType === 'url') {
        namedParams.push(`href="${escapeQuote(targetId)}"`);
    } else if (targetType === 'route') {
        namedParams.push(`name="${escapeQuote(targetId)}"`);
        // route params with JSON braces deferred -- see file-level comment.
    }

    const decoded = decodeHtmlEntities(label).trim();
    if (decoded !== '')  namedParams.push(`label="${escapeQuote(decoded)}"`);

    const target    = matchAttr(anchorHtml, 'target');
    const rel       = matchAttr(anchorHtml, 'rel');
    const className = matchAttr(anchorHtml, 'class');
    const useLatest = matchAttr(anchorHtml, 'data-use-latest-label') === 'true';

    if (target)    namedParams.push(`target="${escapeQuote(target)}"`);
    if (rel)       namedParams.push(`rel="${escapeQuote(rel)}"`);
    if (className) namedParams.push(`class="${escapeQuote(className)}"`);
    if (useLatest) namedParams.push(`useLatestLabel="true"`);

    return namedParams.length > 0
        ? `{widget:${colonPath.join(':')} ${namedParams.join(' ')}}`
        : `{widget:${colonPath.join(':')}}`;
}

/**
 * Convert editor HTML into stored dtmpl. Rewrites every marker
 * `<a data-widget="link" ...>label</a>` into a `{widget:link:...}` tag.
 * Anchors without `data-widget="link"` pass through unchanged.
 */
export function htmlToDtmpl(html: string): string {
    return html.replace(LINK_ANCHOR_RE, (match, _q, label: string) =>
        buildLinkTag(match, String(label)) ?? match,
    );
}

/**
 * Convert stored dtmpl into editor HTML by replacing each
 * `{widget:link:TYPE[:HEX] ...}` with a marker `<a>` that LinkWidget's
 * parseHTML rule rehydrates into a node.
 */
export function dtmplToHtml(content: string): string {
    return content.replace(LINK_WIDGET_TAG_RE, (full, colonPath: string, paramsStr: string | undefined) => {
        const segments = colonPath.split(':');
        const targetType = segments[0];
        if (!['page', 'section', 'vfs', 'url', 'route'].includes(targetType)) {
            // Unknown type: pass through unchanged so source-mode editing
            // doesn't silently drop tags from a future schema.
            return full;
        }

        const params = parseParams(paramsStr ?? '');

        let targetId = '';
        if (isColonPathType(targetType)) {
            targetId = segments[1] ?? '';
            if (isHexUuid(targetId)) targetId = hexToCanonicalUuid(targetId);
        } else if (targetType === 'url') {
            targetId = params['href'] ?? '';
        } else if (targetType === 'route') {
            targetId = params['name'] ?? '';
        }

        if (targetId === '') {
            // Malformed widget (no identifier): pass through so authors
            // see the original tag in source mode and can fix it.
            return full;
        }

        const label     = params['label']     ?? '';
        const target    = params['target']    ?? '';
        const rel       = params['rel']       ?? '';
        const className = params['class']     ?? '';
        const useLatest = params['useLatestLabel'] === 'true';

        const dataAttrs: string[] = [
            ` data-widget="link"`,
            ` data-target-type="${escapeAttr(targetType)}"`,
            ` data-target-id="${escapeAttr(targetId)}"`,
        ];
        if (useLatest) dataAttrs.push(` data-use-latest-label="true"`);

        const standardAttrs: string[] = [` href="#"`];
        if (target)    standardAttrs.push(` target="${escapeAttr(target)}"`);
        if (rel)       standardAttrs.push(` rel="${escapeAttr(rel)}"`);
        if (className) standardAttrs.push(` class="${escapeAttr(className)}"`);

        return `<a${dataAttrs.join('')}${standardAttrs.join('')}>${escapeAttr(label)}</a>`;
    });
}
