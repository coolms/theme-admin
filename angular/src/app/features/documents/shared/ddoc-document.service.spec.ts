import { SECTION_BREAK_HTML } from '@coolms/editor-angular';
import { FileEditorRegistry } from '@coolms/ui-angular';

import {
    DDOC_DOCUMENT_MIME,
    joinDdocSections,
    referencedFootnoteIds,
    sectionsDisagreeOnPaper,
    splitDdocSections,
    type DdocPage,
    type DdocPayload,
    type DdocSection,
} from './ddoc-document.service';

/**
 * Joining a document's sections for editing, and splitting them apart again.
 *
 * The pair has to be exact in both directions: a split that misses a break
 * merges two sections into one and the save DROPS the trailing section's
 * headers and footers, because the server matches sections by position.
 */
describe('the ddoc section join and split', () => {
    const a4: DdocPage = {
        widthTwips: 11906,
        heightTwips: 16838,
        orientation: 'portrait',
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        preset: 'a4',
        marginPreset: 'normal',
    };

    const section = (html: string, page: DdocPage = a4): DdocSection => ({
        html,
        page,
        headers: {},
        footers: {},
    });

    /** The backend constant this must match: `DdocReader::MIME`. */
 it('is the mime the backend stamps on a .ddoc', () => {
        expect(DDOC_DOCUMENT_MIME).toBe('application/x-coolms-document+json');
    });

    /**
     * Why the registration in `app.config.ts` must be EXACT.
     *
     *  This spec cannot assert that the registration HAPPENS: importing
     * `app.config` for its side effects pulls the whole application graph into
     * the karma build and takes the entire suite from passing to zero executed
     * (see `sheet-document-editor.spec.ts`, which learned it the hard way).
     * What is testable is the property that makes the exact entry load-bearing
     * rather than tidy, pinned so nobody "simplifies" it into a fallback that
     * cannot fire.
     */
 it('cannot inherit an editor from a wildcard, so the entry must be exact', () => {
 // The resolver's ONLY fallback is the mime's first segment plus `/*`.
 expect(DDOC_DOCUMENT_MIME.split('/')[0] + '/*').toBe('application/*');
        expect(FileEditorRegistry.hasEditorForMime('application/*')).toBeFalse();
 // The `+json` suffix does not reach `application/json` either.
        expect(DDOC_DOCUMENT_MIME).not.toBe('application/json');
    });

 it('joins one section to itself, with no break', () => {
        expect(joinDdocSections([section('<p>only</p>')])).toBe('<p>only</p>');
    });

 it('puts a break between two sections and takes it out again', () => {
        const joined = joinDdocSections([section('<p>one</p>'), section('<p>two</p>')]);

        expect(joined).toContain(SECTION_BREAK_HTML);
        expect(splitDdocSections(joined).map(s => s.html)).toEqual(['<p>one</p>', '<p>two</p>']);
    });

    /**
     *  The serializer writes the marker with an empty VALUE, which is not
     * the literal the join emits. A split that matched only the literal would
     * silently stop splitting the moment the content had been through the
     * editor — which is every save.
     */
 it('splits on the marker as the editor serialises it', () => {
        const asSerialised = '<p>one</p><hr data-section-break=""><p>two</p>';

        expect(splitDdocSections(asSerialised).map(s => s.html)).toEqual(['<p>one</p>', '<p>two</p>']);
    });

 it('splits every break, not only the first', () => {
        const three = '<p>a</p><hr data-section-break=""><p>b</p><hr data-section-break=""><p>c</p>';

        expect(splitDdocSections(three).length).toBe(3);
    });

    /** A document the author has emptied still has one section. */
 it('always yields at least one section', () => {
        expect(splitDdocSections('').map(s => s.html)).toEqual(['']);
    });

    /** Sends only the bodies — the merge on the server keeps the rest. */
 it('sends nothing but the html', () => {
        const [first] = splitDdocSections('<p>only</p>');

        expect(Object.keys(first)).toEqual(['html']);
    });

    /**
     *  The paper goes on EVERY section or none. The control edits the whole
     * document, so applying it to the first alone would leave an author reading
     * a status bar that describes a page the rest of the document is not on.
     */
 it('puts the paper on every section when the paper is given', () => {
        const sections = splitDdocSections(
            '<p>a</p><hr data-section-break=""><p>b</p>',
            a4,
        );

        expect(sections.length).toBe(2);
        for (const part of sections) {
            expect(part.page).toBe(a4);
        }
    });

    /**
     * The dialog only passes the paper when the author moved it — this is the
     * other half of that contract, and the one that keeps a text-only save
     * from overwriting somebody else's page setup.
     */
 it('omits the paper entirely when none is given', () => {
        for (const part of splitDdocSections('<p>a</p><hr data-section-break=""><p>b</p>')) {
            expect('page' in part).toBeFalse();
        }
    });

 describe('and reading the footnote references out of the body', () => {
 it('finds them in document order', () => {
            expect(referencedFootnoteIds(
                '<p>a<sup data-footnote="7">7</sup></p><p>b<sup data-footnote="2">2</sup></p>',
            )).toEqual([7, 2]);
        });

        /** Two markers pointing at one note are one note. */
 it('reports an id once however many markers point at it', () => {
            expect(referencedFootnoteIds(
                '<p><sup data-footnote="3">3</sup><sup data-footnote="3">3</sup></p>',
            )).toEqual([3]);
        });

        /**
         *  OOXML reserves -1 and 0 for the separator notes, so a marker
         * naming either points at a horizontal rule rather than a note. The
         * panel must not offer one as something to edit.
         */
 it('ignores an id below one', () => {
            expect(referencedFootnoteIds('<p><sup data-footnote="0">0</sup></p>')).toEqual([]);
        });

 it('ignores a plain superscript that is not a reference', () => {
            expect(referencedFootnoteIds('<p>x<sup>2</sup></p>')).toEqual([]);
        });

        /** The shape the SERIALIZER produces, which is the one that matters. */
 it('finds a marker written by the editor', () => {
            const serialised = '<p>a<sup data-footnote="4" class="x">4</sup></p>';

            expect(referencedFootnoteIds(serialised)).toEqual([4]);
        });
    });

 describe('and telling whether the sections agree on paper', () => {
        const payload = (...sections: DdocSection[]): DdocPayload => ({
            defaults: { fontName: 'Carlito', fontSizePoints: 11 },
            paper: { sizes: [], orientations: [], margins: [] },
            sections,
            footnotes: {},
        });

 it('is false for a document with one section', () => {
            expect(sectionsDisagreeOnPaper(payload(section('<p>a</p>')))).toBeFalse();
        });

 it('is false when every section is on the same paper', () => {
            expect(sectionsDisagreeOnPaper(payload(section('<p>a</p>'), section('<p>b</p>')))).toBeFalse();
        });

 it('is true when a later section turns the paper round', () => {
            const landscape: DdocPage = {
                ...a4,
                widthTwips: 16838,
                heightTwips: 11906,
                orientation: 'landscape',
            };

            expect(sectionsDisagreeOnPaper(payload(section('<p>a</p>'), section('<p>b</p>', landscape)))).toBeTrue();
        });

        /** A margin nobody would notice is still different paper to print on. */
 it('is true when only the margins differ', () => {
            const narrow: DdocPage = { ...a4, margins: { ...a4.margins, left: 720 }, marginPreset: null };

            expect(sectionsDisagreeOnPaper(payload(section('<p>a</p>'), section('<p>b</p>', narrow)))).toBeTrue();
        });

        /**
         *  Compared on the TWIPS, never on `preset`. Two sections can both be
         * off-catalog — `preset: null` on each — and still be different paper,
         * and calling that agreement is exactly the case an author would be
         * misled by.
         */
 it('is true for two different papers that no preset names', () => {
            const one: DdocPage = { ...a4, widthTwips: 12000, preset: null };
            const two: DdocPage = { ...a4, widthTwips: 13000, preset: null };

            expect(sectionsDisagreeOnPaper(payload(section('<p>a</p>', one), section('<p>b</p>', two)))).toBeTrue();
        });
    });
});
