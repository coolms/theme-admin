import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SECTION_BREAK_HTML, SECTION_BREAK_PATTERN } from '@coolms/editor-angular';
import type { Observable } from 'rxjs';

/** `application/x-coolms-document+json` — the native document source format. */
export const DDOC_DOCUMENT_MIME = 'application/x-coolms-document+json';

/**
 * The size row standing for "the paper this document is already on".
 *
 * Mirrors `PaperCatalog::CUSTOM_SIZE`. The server sends the row only when no
 * preset names the document's paper, and it carries both orientations like
 * every other row — so rotating odd paper is a lookup here, never a swap.
 */
export const DDOC_CUSTOM_SIZE = 'custom';

/** The four sides of a section's writing frame, in twips. */
export interface DdocMargins {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/**
 * A section's paper, in twips, exactly as the file states it.
 *
 * ⚠️ `preset` and `marginPreset` are LABELS the server put on those numbers,
 * and are absent when the paper is none of the offers. They exist so a control
 * can seed its selects without matching twips in the browser; the twips remain
 * the paper, and the server ignores a preset name sent back to it.
 */
export interface DdocPage {
    readonly widthTwips: number;
    readonly heightTwips: number;
    readonly orientation: string;
    readonly margins: DdocMargins;
    readonly preset: string | null;
    readonly marginPreset: string | null;
}

/** A paper size, with what it comes to in twips each way up. */
export interface DdocPaperSize {
    readonly value: string;
    readonly label: string;
    readonly portrait: { widthTwips: number; heightTwips: number };
    readonly landscape: { widthTwips: number; heightTwips: number };
}

/** A named set of margins, in twips. */
export interface DdocMarginPreset extends DdocMargins {
    readonly value: string;
    readonly label: string;
}

/**
 * What an author may choose from, with the twips behind every name.
 *
 * ⚠️ The twips travel WITH the offers on purpose. The alternative — the FE
 * knowing that A4 is 11906 x 16838 and that landscape swaps them — is a second
 * copy of `PageSizeResolver`'s table, which is the one thing the `.ddoc` paper
 * seam was designed to avoid. Nothing here is computed in the browser.
 */
export interface DdocPaperCatalog {
    readonly sizes: readonly DdocPaperSize[];
    readonly orientations: readonly { value: string; label: string }[];
    readonly margins: readonly DdocMarginPreset[];
}

export interface DdocSection {
    readonly page: DdocPage;
    readonly html: string;
    readonly headers: Record<string, string>;
    readonly footers: Record<string, string>;
}

export interface DdocPayload {
    readonly defaults: { fontName: string; fontSizePoints: number };
    readonly paper: DdocPaperCatalog;
    readonly sections: readonly DdocSection[];
    readonly footnotes: Record<string, string>;
}

/**
 * What a save sends: the body of each section, by position, and the paper only
 * when the author changed it.
 *
 * ⚠️ `page` is OMITTED unless the paper moved. Absent means "unchanged" on the
 * server, so leaving it out is what lets another author's paper edit survive a
 * save that only touched the text.
 */
export interface DdocSectionEdit {
    readonly html: string;
    readonly page?: DdocPage;
}

/**
 * What a save sends for the notes: id -> the body's HTML.
 *
 * ⚠️ Sent only when the author edited one. Absent means unchanged on the
 * server, and every note the payload does not mention keeps whatever the file
 * said — which is what stops a save that only touched the text from wiping the
 * bodies of an imported document's footnotes.
 */
export type DdocFootnoteEdits = Record<string, string>;

/**
 * The `.ddoc` editing endpoints.
 *
 * ## Why a `.ddoc` does not use the VFS content endpoint
 *
 * A `.dtmpl` needs no service of its own: its stored form IS a fragment of
 * HTML, so `GET /vfs/files/content` hands the editor exactly what it edits. A
 * `.ddoc` is the document MODEL, and the projection between the two — the
 * mapper chain, the style ids, twips — lives in PHP. Fetching the JSON here
 * would mean writing that chain a second time in TypeScript and then keeping
 * two implementations agreeing about `w:ilvl`.
 *
 * ⚠️ **The save sends every section, and only the bodies.** The page setup,
 * the headers, the footers and the footnote bodies are left out on purpose:
 * the server merges what arrives over the STORED document, so anything the
 * editor does not mention keeps whatever the file said. Sending a partial copy
 * of them would be the one way to lose them.
 */
/**
 * The document's sections as one flow, with a section break between them.
 *
 * A `.ddoc` is a LIST of sections and the editor holds one flow. Showing only
 * the first would leave the rest of the document invisible while still saving
 * it — an author would see a document shorter than the one they have.
 */
export function joinDdocSections(sections: readonly DdocSection[]): string {
    return sections.map(section => section.html).join(SECTION_BREAK_HTML);
}

/**
 * And back apart, one entry per section.
 *
 * ⚠️ The bodies, and the paper only when `page` is given. The furniture and the
 * footnote bodies are deliberately absent so the server's merge keeps whatever
 * the file says; sending a partial copy of them is the one way to lose them.
 *
 * An author who deletes a section break sends back fewer sections and the merge
 * drops the trailing one, which is what Word does with the same gesture. One
 * who adds a break gets a new section inheriting the last one's paper.
 *
 * ⚠️ `page` goes on EVERY section when it goes at all. The paper control edits
 * the whole document — the way Word's Page Setup defaults to "Apply to: whole
 * document" — so applying it to the first section alone would leave an author
 * looking at a control that describes a page the rest of their document is not
 * on.
 */
/**
 * The footnote ids the editor's HTML points at, in document order.
 *
 * ⚠️ Read off the MARKUP rather than the ProseMirror document, because that is
 * what the dialog holds — the editor hands back HTML and keeps its own state to
 * itself. The attribute is the fact on both sides (`FootnoteMapper` reads the
 * same one), so this cannot disagree with what a save actually sends.
 *
 * Deduplicated: two markers pointing at one note are one note.
 */
export function referencedFootnoteIds(html: string): number[] {
    const ids: number[] = [];

    for (const match of html.matchAll(/data-footnote="(\d+)"/g)) {
        const id = Number.parseInt(match[1] ?? '', 10);
        if (Number.isInteger(id) && id >= 1 && !ids.includes(id)) {
            ids.push(id);
        }
    }

    return ids;
}

/**
 * Whether the document's sections are on more than one paper.
 *
 * A paper control describes the FIRST section, so a document whose sections
 * disagree needs to say so — otherwise the status bar states a page that most
 * of the document is not on.
 *
 * Compared on the twips, not on `preset`: two sections can both be off-catalog
 * (`preset: null`) and still be different paper, and calling that agreement is
 * exactly the case an author would be misled by.
 */
export function sectionsDisagreeOnPaper(payload: DdocPayload): boolean {
    const [first, ...rest] = payload.sections;
    if (undefined === first) return false;

    return rest.some(section => section.page.widthTwips !== first.page.widthTwips
        || section.page.heightTwips !== first.page.heightTwips
        || section.page.orientation !== first.page.orientation
        || section.page.margins.top !== first.page.margins.top
        || section.page.margins.right !== first.page.margins.right
        || section.page.margins.bottom !== first.page.margins.bottom
        || section.page.margins.left !== first.page.margins.left);
}

export function splitDdocSections(html: string, page?: DdocPage): DdocSectionEdit[] {
    return html.split(SECTION_BREAK_PATTERN)
        .map(part => (undefined === page ? { html: part } : { html: part, page }));
}

@Injectable({ providedIn: 'root' })
export class DdocDocumentService {
    private readonly http = inject(HttpClient);

    read(path: string): Observable<DdocPayload> {
        return this.http.get<DdocPayload>(this.url('content', path));
    }

    write(
        path: string,
        sections: readonly DdocSectionEdit[],
        footnotes?: DdocFootnoteEdits,
    ): Observable<{ contentHash: string }> {
        return this.http.put<{ contentHash: string }>(
            this.url('content', path),
            this.payload(sections, footnotes),
        );
    }

    /**
     * The document as a PDF, rendered from what is on screen.
     *
     * Nothing is saved: the server merges in memory. What an author previews is
     * what a save-then-download would produce, because it is the same merge.
     */
    render(
        path: string,
        sections: readonly DdocSectionEdit[],
        footnotes?: DdocFootnoteEdits,
    ): Observable<Blob> {
        return this.http.post(
            this.url('preview', path),
            this.payload(sections, footnotes),
            { responseType: 'blob' },
        );
    }

    download(
        path: string,
        sections: readonly DdocSectionEdit[],
        format: 'docx' | 'pdf',
        footnotes?: DdocFootnoteEdits,
    ): Observable<Blob> {
        return this.http.post(
            `${this.url('download', path)}&format=${format}`,
            this.payload(sections, footnotes),
            { responseType: 'blob' },
        );
    }

    /**
     * ⚠️ `footnotes` is OMITTED when there is nothing to say, never sent as an
     * empty object. `{}` is a payload that mentions the notes and changes none
     * — the same outcome today, but only by accident of the merge rules, while
     * the rule the seam states is that an ABSENT key is unchanged. Saying
     * nothing is the shape that cannot be misread later.
     */
    private payload(
        sections: readonly DdocSectionEdit[],
        footnotes?: DdocFootnoteEdits,
    ): Record<string, unknown> {
        return undefined === footnotes || 0 === Object.keys(footnotes).length
            ? { sections }
            : { sections, footnotes };
    }

    private url(action: string, path: string): string {
        return `/api/v1/document/ddoc/${action}?path=${encodeURIComponent(path)}`;
    }
}
