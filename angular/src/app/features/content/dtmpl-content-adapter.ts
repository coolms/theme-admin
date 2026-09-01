import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ContentAdapter } from '@coolms/editor-angular';
import { formFieldDtmplToHtml, formFieldHtmlToDtmpl } from '@coolms/editor-angular';
import { embedDtmplToHtml, embedHtmlToDtmpl } from '@coolms/editor-angular';
// `migrateLegacyGridLayout` is defined in this file (see export below) but
// referenced inside the class methods — TypeScript handles the forward
// reference at runtime since the function is hoisted at module load.
import { MediaService } from '../media/media.service';
import { kindForMime } from '../media/dtmpl/dtmpl-media-node';
import { dtmplToHtml, extractMediaUuids, htmlToDtmpl } from './media-widget-transform';
import {
    dtmplToHtml as linkDtmplToHtml,
    htmlToDtmpl as linkHtmlToDtmpl,
} from '../link/dtmpl/link-widget-transform';
import {
    dtmplToHtml as formDtmplToHtml,
    htmlToDtmpl as formHtmlToDtmpl,
} from '../form-widget/dtmpl/form-widget-transform';
import {
    dtmplToHtml as documentDtmplToHtml,
    htmlToDtmpl as documentHtmlToDtmpl,
} from '../document-widget/dtmpl/document-widget-transform';
import {
    dtmplToHtml as imageMapDtmplToHtml,
    htmlToDtmpl as imageMapHtmlToDtmpl,
} from '../image-map-widget/dtmpl/image-map-widget-transform';

/**
 * Bridges the storage form (`{widget:media:UUID …}` dtmpl) to the editor
 * HTML the bridge consumes. Lives in the Content module because dtmpl is a
 * content-storage concern; the bridge stays neutral and the page editor
 * passes this adapter as `[contentAdapter]`.
 *
 *   toEditor   asynchronous: extracts every {widget:media:UUID …} reference,
 *              batch-fetches the missing assets via MediaService, then runs
 *              dtmplToHtml with a resolver that maps each uuid to its
 *              preview URL + kind. Mirrors the legacy mountEditorWithContent
 *              flow that page-editor used to do inline.
 *   toStorage  synchronous: htmlToDtmpl is a pure regex transform.
 *
 * The cache is per-adapter-instance (component-scoped — see
 * `providedIn: 'root'` decision below). Multiple editor instances reading
 * the same uuid share a single fetch.
 */
@Injectable({ providedIn: 'root' })
export class DtmplContentAdapter implements ContentAdapter {
    private readonly mediaSvc = inject(MediaService);

    /** uuid -> { mime, presetUrls } cache shared across adapter calls. */
    private readonly cache = new Map<string, { mime: string; urls: Record<string, string> }>();

    /**
     * Defense-in-depth: drop every `{widget:NAMESPACE:…}` reference whose
     * namespace isn't in the active profile's allow-list. Mirrors the
     * backend ContentSanitizer's grammar exactly so saved content the
     * server would reject also doesn't surface in the editor.
     *
     * The wildcard '*' short-circuits — when the profile permits any
     * widget, return the input unchanged.
     */
    stripDisallowedWidgets(content: string, allowedWidgets: ReadonlyArray<string>): string {
        if (allowedWidgets.includes('*')) return content;
        const allowed = new Set(allowedWidgets);
        // Mirror ContentSanitizer's pattern:
        //   {widget:NAMESPACE:ID …}
        // NAMESPACE = [a-zA-Z][a-zA-Z0-9_-]* ; ID = up to whitespace or `}`.
        return content.replace(
            /\{widget:([a-z][a-z0-9_-]*):[^\s}]+(?:\s+[^}]*)?\}/gi,
            (full, namespace: string) => allowed.has(namespace) ? full : '',
        );
    }

    async toEditor(stored: string): Promise<string> {
        const uuids = extractMediaUuids(stored);
        const missing = uuids.filter(id => !this.cache.has(id));
        if (missing.length > 0) {
            const fetches = missing.map(id => firstValueFrom(this.mediaSvc.get(id)).catch(() => null));
            const assets = await Promise.all(fetches);
            for (const a of assets) {
                if (!a) continue;
                const urls: Record<string, string> = {};
                if (a.thumbnailUrl) urls['__thumb']    = a.thumbnailUrl;
                if (a.originalUrl)  urls['__original'] = a.originalUrl;
                if (a.presetUrls)   Object.assign(urls, a.presetUrls);
                this.cache.set(a.id, { mime: a.mimeType, urls });
            }
        }

        const afterMedia = dtmplToHtml(stored, (id, size) => {
            const entry = this.cache.get(id);
            if (!entry) return null;
            const url = size === 'original'
                ? (entry.urls['__original'] ?? entry.urls['__thumb'] ?? null)
                : (entry.urls[size]         ?? entry.urls['__thumb'] ?? entry.urls['__original'] ?? null);
            return { url, kind: kindForMime(entry.mime) };
        });
        // Link / formField / embed / form / document transforms are sync and
        // order-independent with the media transform: media targets
        // `{widget:media:...}`, link `{widget:link:...}`, formField
        // `{widget:formField:...}`, embed `{widget:embed:...}`, form
        // `{widget:form:...}`, document `{widget:document:...}`, imagemap
        // `{widget:imagemap:...}` — seven disjoint namespaces, no regex
        // overlap. The legacy gridLayout migration runs last so it sees the
        // final HTML the parser will see.
        return migrateLegacyGridLayout(
            imageMapDtmplToHtml(
                documentDtmplToHtml(
                    formDtmplToHtml(embedDtmplToHtml(formFieldDtmplToHtml(linkDtmplToHtml(afterMedia)))),
                ),
            ),
        );
    }

    toStorage(html: string): string {
        // Order-independent across all six: media markers are <img>, link
        // markers are <a>, formField markers are <span>, embed markers are
        // <div data-widget="embed">, form markers are <div data-widget="form">,
        // document markers are <div data-widget="document">, imagemap markers
        // are <div data-widget="imagemap"> (all distinct from the media-gallery
        // <div>). No cross-claims.
        return imageMapHtmlToDtmpl(
            documentHtmlToDtmpl(
                formHtmlToDtmpl(
                    embedHtmlToDtmpl(htmlToDtmpl(linkHtmlToDtmpl(formFieldHtmlToDtmpl(html)))),
                ),
            ),
        );
    }
}

/**
 * Wrap a bare `<div class="row">` (no `cms-grid` ancestor) in
 * `<div class="cms-grid">` so F.1 documents — which emitted gridLayout as
 * a flat row + cols structure — fit the F.1.1 schema (`gridLayout >
 * gridRow+ > gridColumn+`). Idempotent: rows already inside a `cms-grid`
 * wrapper are left alone, so a second pass over migrated content is a
 * no-op.
 *
 * Implementation walks the string with a depth counter so a nested
 * `cms-grid` (theoretically possible if F.6's DOCX adapter starts emitting
 * one) doesn't double-wrap. Pure regex would either over-wrap or under-wrap
 * for non-trivial nesting.
 */
export function migrateLegacyGridLayout(html: string): string {
    if (!html.includes('class="row"')) return html;
    const ROW_OPEN = /<div\s+class="row">/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROW_OPEN.exec(html)) !== null) {
        const before = html.slice(lastIndex, match.index);
        result += before;
        // Determine whether this `<div class="row">` is already inside a
        // `<div class="cms-grid">` by counting opens vs closes in the
        // text we've emitted so far.
        const opensSoFar = countOccurrences(result, '<div class="cms-grid">');
        const closesSoFar = countMatchingCloses(result, '<div class="cms-grid">');
        const insideCmsGrid = opensSoFar > closesSoFar;
        if (insideCmsGrid) {
            result += match[0];
        } else {
            // Find the matching `</div>` for this row by depth-tracking.
            const rowEnd = findMatchingClose(html, ROW_OPEN.lastIndex);
            if (rowEnd === -1) {
                // Unbalanced HTML — leave as-is so source-mode editing
                // shows the original, fixable input.
                result += match[0];
            } else {
                const inner = html.slice(ROW_OPEN.lastIndex, rowEnd);
                result += `<div class="cms-grid"><div class="row">${inner}</div></div>`;
                ROW_OPEN.lastIndex = rowEnd + '</div>'.length;
            }
        }
        lastIndex = ROW_OPEN.lastIndex;
    }
    result += html.slice(lastIndex);
    return result;
}

function countOccurrences(s: string, needle: string): number {
    let n = 0;
    let i = 0;
    while ((i = s.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
}

/** Count `</div>` tags that close a previously seen `cms-grid` open. */
function countMatchingCloses(s: string, openTag: string): number {
    // Approximation: count `</div>` occurrences after the last open. Not
    // perfect for deeply nested grids, but the migration only fires for
    // bare top-level rows so the approximation is sufficient.
    const openAt = s.lastIndexOf(openTag);
    if (openAt === -1) return 0;
    const tail = s.slice(openAt);
    let depth = 0;
    let closes = 0;
    let i = 0;
    while (i < tail.length) {
        if (tail.startsWith('<div', i)) { depth++; i += 4; continue; }
        if (tail.startsWith('</div>', i)) {
            depth--;
            if (depth === 0) { closes++; }
            i += 6;
            continue;
        }
        i++;
    }
    return closes;
}

/** Find the index of the matching `</div>` for a `<div>` whose body starts at `start`. */
function findMatchingClose(s: string, start: number): number {
    let depth = 1;
    let i = start;
    while (i < s.length) {
        if (s.startsWith('<div', i)) { depth++; i += 4; continue; }
        if (s.startsWith('</div>', i)) {
            depth--;
            if (depth === 0) return i;
            i += 6;
            continue;
        }
        i++;
    }
    return -1;
}
