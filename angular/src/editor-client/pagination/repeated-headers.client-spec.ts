// Copied from @coolms/editor-client's own specs (src/pagination/repeated-headers.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import type { PlacedRow } from '@coolms/document-engine';

import { repeatedHeadersOf } from '@coolms/editor-client';

/**
 * Spec for the repeated-header seam.
 *
 * The engine repeats a `w:tblHeader` row at the top of every page a table
 * continues onto, and has. The canvas did not draw it: ProseMirror
 * renders the table once, so the room the engine kept at the top of each
 * continuation page stayed EMPTY, and the author saw a blank strip where the
 * `.docx` and the PDF both show the header again.
 */
describe('repeatedHeadersOf', () => {
    const row = (rowIndex: number, repeated: boolean, blockIndex = 0): PlacedRow => ({
        yPx: 0,
        heightPx: 20,
        cells: [],
        blockIndex,
        rowIndex,
        repeated,
    });

    it('finds nothing in a document whose table never continues', () => {
        expect(repeatedHeadersOf([{ rows: [row(0, false), row(1, false)] }])).toEqual([]);
    });

    it('names the page a header is drawn again at the top of', () => {
        const pages = [
            { rows: [row(0, false), row(1, false)] },
            { rows: [row(0, true), row(2, false)] },
        ];

        expect(repeatedHeadersOf(pages)).toEqual([
            { page: 1, blockIndex: 0, rowIndexes: [0] },
        ]);
    });

    /**
     *  Word repeats EVERY leading header row, not just the first, and the
     * engine follows it. Drawing one where the engine placed two would leave
     * the second one's room empty and the copy a row short of the file.
     */
    it('keeps every header row the page repeats', () => {
        const pages = [
            { rows: [row(0, false), row(1, false), row(2, false)] },
            { rows: [row(0, true), row(1, true), row(3, false)] },
        ];

        expect(repeatedHeadersOf(pages)).toEqual([
            { page: 1, blockIndex: 0, rowIndexes: [0, 1] },
        ]);
    });

    it('reports each continuation page separately', () => {
        const pages = [
            { rows: [row(0, false)] },
            { rows: [row(0, true), row(1, false)] },
            { rows: [row(0, true), row(2, false)] },
        ];

        expect(repeatedHeadersOf(pages).map((header) => header.page)).toEqual([1, 2]);
    });

    /**
     * The rows a page repeats are not always the table the page CONTINUES: a
     * document can carry more than one table, and the block index travels with
     * the rows so the canvas clones from the right one.
     */
    it('carries the block the rows belong to', () => {
        const pages = [
            { rows: [row(0, false, 3)] },
            { rows: [row(0, true, 3), row(4, false, 3)] },
        ];

        expect(repeatedHeadersOf(pages)[0]?.blockIndex).toBe(3);
    });

    /**
     *  Only the rows the ENGINE marked. Deriving "the leading header rows"
     * again here would be a second opinion about a question the engine has
 * already answered -- and the two disagreeing is exactly the a defect
     * fixed, where the canvas repeated a row the `.docx` never did.
     */
    it('takes the engine\'s answer rather than deriving one', () => {
        const pages = [
            { rows: [row(0, false)] },
            { rows: [row(0, false), row(1, false)] },
        ];

        expect(repeatedHeadersOf(pages)).toEqual([]);
    });
});
