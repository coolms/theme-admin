// Copied from @coolms/editor-client's own specs (src/pagination/pagination-extension.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import {
    gapHeightHost, lineBoxesFrom, pageGapElement, repeatedHeaderElement, type PageGap,
} from '@coolms/editor-client';
import type { FlowItem, PlacedLine, PlacedRow } from '@coolms/document-engine';
import { loadPaginationEngine, resetPaginationEngine } from '@coolms/editor-client';

/**
 * `lineBoxesFrom` reads `isFlowTable` from the optional peer, which is fetched
 * rather than imported, so it has a precondition: the module must have
 * arrived. In the editor that is guaranteed -- `repaginate()` returns early
 * until it lands and is its only caller -- but a spec calls the function
 * directly.
 *
 * !! This is NOT what makes the file pass, and saying so would be the more
 * comfortable lie. Removing it leaves all 1219 specs green, measured: karma
 * bundles the suite, and `document-fonts.spec.ts` loads the engine as a side
 * effect of `loadFontManifest()` before anything here runs. It is here to make
 * the dependency explicit and independent of spec order, not to satisfy it.
 *
 * What actually distinguishes a working guard from a missing one is the pair
 * of cases at the end of `lineBoxesFrom`, which reset the module first.
 */
beforeAll(async () => {
    await loadPaginationEngine();
});

/**
 * Spec for what a page gap is DRAWN as.
 *
 * A gap between blocks is a block. A gap that opens a page inside a TABLE
 * cannot be: a block between two rows is discarded by the HTML parser, and a
 * block inside one CELL grows that cell alone -- which is what the canvas used
 * to do, one spacer per cell, leaving the row's box stretched from the foot of
 * one page to the head of the next with its borders drawn through the seam.
 */
describe('pageGapElement', () => {
    const gap = (extra: Partial<PageGap> = {}): PageGap =>
        ({ pos: 12, heightPx: 240, page: 2, ...extra });

    it('draws a gap between blocks as a block', () => {
        const element = pageGapElement(gap());

        expect(element.tagName).toBe('DIV');
        expect(element.style.height).toBe('240px');
    });

    it('draws a gap inside a table as a row spanning the grid', () => {
        const element = pageGapElement(gap({ columns: 3 }));

        expect(element.tagName).toBe('TR');
        expect(element.children.length).toBe(1);

        const cell = element.firstElementChild as HTMLTableCellElement;

        expect(cell.tagName).toBe('TD');
        // Short of the grid it would pin a column narrower than the table's own.
        expect(cell.colSpan).toBe(3);
        expect(cell.style.height).toBe('240px');
    });

    /**
     *  The correction pass writes a measured delta back into the gap's
     * height. A row is as tall as its CELLS, so a height written on the row
     * itself is a request the browser is free to ignore -- and the pages after
     * it would then never converge.
     */
    it('carries a row gap\'s height on the cell, and a block gap\'s on itself', () => {
        const row = pageGapElement(gap({ columns: 2 }));
        const block = pageGapElement(gap());

        expect(gapHeightHost(row)).toBe(row.firstElementChild as HTMLElement);
        expect(gapHeightHost(block)).toBe(block);
    });

    /** The correction pass finds a page's gaps by this, so it has to be there. */
    it('names the page it opens', () => {
        expect(pageGapElement(gap()).dataset['page']).toBe('2');
        expect(pageGapElement(gap({ columns: 2 })).dataset['page']).toBe('2');
    });
});

describe('repeatedHeaderElement', () => {
    const HEADER = '<tr data-repeat-header=""><th colwidth="300"><p>Item</p></th>'
        + '<th colwidth="300"><p>Amount</p></th></tr>';

    /**
     *  A row is only allowed in table content, and the element it is
     * parsed into decides whether it survives. Measured 2026-08-24:
     * `div.innerHTML` answers `<p>Item</p>` -- the row and its cells gone --
     * while a `<template>` parses table fragments as themselves. Build it in
     * the wrong one and the header the author is promised is a blank strip.
     */
    it('parses the row back with its cells', () => {
        const element = repeatedHeaderElement(HEADER);

        expect(element.tagName).toBe('TR');
        expect(element.children.length).toBe(2);
        expect(element.textContent).toBe('ItemAmount');
        expect(element.querySelectorAll('th').length).toBe(2);
    });

    /** The widths and the header marker travel with the markup, not beside it. */
    it('keeps what the row it copies was drawn with', () => {
        const element = repeatedHeaderElement(HEADER);

        expect(element.hasAttribute('data-repeat-header')).toBe(true);
        expect(element.querySelector('th')?.getAttribute('colwidth')).toBe('300');
    });

    it('marks the copy as a copy rather than a place to work', () => {
        const element = repeatedHeaderElement(HEADER);

        expect(element.classList.contains('cms-repeat-header')).toBe(true);
        expect(element.getAttribute('aria-hidden')).toBe('true');
    });
});

/**
 * The line box the ENGINE computed, turned into something a decoration can draw.
 *
 *  Why this is worth a spec of its own: the numbers are right in the engine
 * and the CSS is right on the page, and BETWEEN them sit two conversions that
 * are each easy to get silently wrong -- an index into the top-level flow items,
 * and a position that is one less than the one the flow carries.
 */
describe('lineBoxesFrom', () => {
    const line = (paragraphIndex: number, heightPx: number): PlacedLine =>
        ({ paragraphIndex, heightPx } as unknown as PlacedLine);

    const block = (at: number | undefined): FlowItem =>
        ({ spans: [], ...(undefined === at ? {} : { at }) } as FlowItem);

    it('reports the block POSITION, which is one before the flow item is at', () => {
        // A flow item's `at` is its CONTENT start; `nodeDOM()` takes the node.
        const boxes = lineBoxesFrom([block(1)], [{ lines: [line(0, 18.09)] }]);

        expect(boxes).toEqual([{ pos: 0, heightPx: 18.09 }]);
    });

    /**
     *  CSS has ONE line-height per block, so a paragraph whose lines differ
     * is drawn on its TALLEST -- the only choice that cannot make text overlap.
     */
    it('takes the tallest line of a block, across pages', () => {
        const boxes = lineBoxesFrom(
            [block(1)],
            [{ lines: [line(0, 18.09), line(0, 21.5)] }, { lines: [line(0, 19.0)] }],
        );

        expect(boxes).toEqual([{ pos: 0, heightPx: 21.5 }]);
    });

    /**
     *  A table is ONE flow item and its cells' paragraphs are not among the
     * top-level ones, so nothing here can speak for them. Emitting a box for
     * the table itself would state a line height for a grid.
     */
    it('says nothing about a table', () => {
        const table = { rows: [], at: 1 } as unknown as FlowItem;

        expect(lineBoxesFrom([table], [{ lines: [line(0, 18.09)] }])).toEqual([]);
    });

    it('skips a block the flow gave no position', () => {
        expect(lineBoxesFrom([block(undefined)], [{ lines: [line(0, 18.09)] }])).toEqual([]);
    });

    it('skips a line index no flow item answers to', () => {
        expect(lineBoxesFrom([], [{ lines: [line(7, 18.09)] }])).toEqual([]);
    });

    /** A zero height would draw a collapsed line rather than no opinion. */
    it('skips a height of zero', () => {
        expect(lineBoxesFrom([block(1)], [{ lines: [line(0, 0)] }])).toEqual([]);
    });

    /**
     * !! The two states of the OPTIONAL peer, which nothing else here can see.
     *
     * `@coolms/document-engine` is fetched rather than imported, so
     * `lineBoxesFrom` reads `isFlowTable` from a module that may not have
     * arrived. Every case above runs with it loaded -- and would run with it
     * loaded even if this file did nothing to arrange that, because karma
     * bundles the specs together and `document-fonts.spec.ts` loads the engine
     * as a side effect of `loadFontManifest()`.
     *
     * That was measured, not assumed: removing this file's `beforeAll` left
     * all 1219 specs passing. So the suite could not tell the guard working
     * from the guard being absent, and these two cases are what make the
     * difference visible. The first fails if the guard is removed; the second
     * fails if it never lets go.
     */
    describe('and the engine it needs', () => {
        afterAll(async () => {
            // Leave it loaded. The memo is module-global and every other spec
            // in this bundle assumes it has arrived.
            await loadPaginationEngine();
        });

        it('yields nothing while the peer has not arrived', () => {
            resetPaginationEngine();

            expect(lineBoxesFrom([block(1)], [{ lines: [line(0, 18.09)] }])).toEqual([]);
        });

        it('yields boxes once it has', async () => {
            resetPaginationEngine();
            await loadPaginationEngine();

            expect(lineBoxesFrom([block(1)], [{ lines: [line(0, 18.09)] }]))
                .toEqual([{ pos: 0, heightPx: 18.09 }]);
        });
    });
});

/**
 * The paragraphs inside table CELLS.
 *
 *  Their line boxes live on `PlacedCell.lines`, indexed relative to the cell,
 * so reaching them means mapping a placed cell back to the source cell that
 * produced it -- and that mapping is by INDEX. Every case here is about whether
 * the index can be trusted, because assigning one paragraph's height to another
 * moves text where losing a box costs a fraction of a pixel.
 */
describe('lineBoxesFrom, inside a table', () => {
    const line = (paragraphIndex: number, heightPx: number): PlacedLine =>
        ({ paragraphIndex, heightPx } as unknown as PlacedLine);

    const block = (at: number): FlowItem => ({ spans: [], at } as FlowItem);

    const table = (...cellBlocks: FlowItem[][]): FlowItem =>
        ({ rows: [{ cells: cellBlocks.map((blocks) => ({ blocks })) }] } as unknown as FlowItem);

    const row = (cells: { lines: PlacedLine[] }[], extra: Partial<PlacedRow> = {}): PlacedRow =>
        ({ blockIndex: 0, rowIndex: 0, repeated: false, cells, ...extra } as unknown as PlacedRow);

    it('reaches a paragraph inside a cell', () => {
        const boxes = lineBoxesFrom(
            [table([block(5)])],
            [{ lines: [], rows: [row([{ lines: [line(0, 16.5)] }])] }],
        );

        expect(boxes).toEqual([{ pos: 4, heightPx: 16.5 }]);
    });

    it('takes the tallest line of a cell paragraph', () => {
        const boxes = lineBoxesFrom(
            [table([block(5)])],
            [{ lines: [], rows: [row([{ lines: [line(0, 16.5), line(0, 19.25)] }])] }],
        );

        expect(boxes).toEqual([{ pos: 4, heightPx: 19.25 }]);
    });

    it('keeps each cell of a row on its own paragraphs', () => {
        const boxes = lineBoxesFrom(
            [table([block(5)], [block(9)])],
            [{ lines: [], rows: [row([
                { lines: [line(0, 16.5)] },
                { lines: [line(0, 21.0)] },
            ])] }],
        );

        expect(boxes).toEqual([{ pos: 4, heightPx: 16.5 }, { pos: 8, heightPx: 21.0 }]);
    });

    /**
     *  The guard the whole mapping rests on. A `w:vMerge` continuation puts a
     * cell in the placed row that no source cell answers to, and from there
     * every index is one out -- the SECOND cell's line height would land on the
     * FIRST cell's paragraph. Skipping the row loses a box; trusting the index
     * moves text.
     */
    it('skips a row the layout expanded past its source', () => {
        const boxes = lineBoxesFrom(
            [table([block(5)])],
            [{ lines: [], rows: [row([
                { lines: [line(0, 16.5)] },
                { lines: [line(0, 21.0)] },
            ])] }],
        );

        expect(boxes).toEqual([]);
    });

    /** A repeated header is the SAME source row drawn again, already covered. */
    it('says nothing twice for a repeated header row', () => {
        const boxes = lineBoxesFrom(
            [table([block(5)])],
            [{ lines: [], rows: [
                row([{ lines: [line(0, 16.5)] }]),
                row([{ lines: [line(0, 16.5)] }], { repeated: true }),
            ] }],
        );

        expect(boxes).toEqual([{ pos: 4, heightPx: 16.5 }]);
    });

    /** A table nested in a cell is not reached, and must not be guessed at. */
    it('says nothing about a table nested in a cell', () => {
        const nested = { rows: [], at: 5 } as unknown as FlowItem;
        const boxes = lineBoxesFrom(
            [table([nested])],
            [{ lines: [], rows: [row([{ lines: [line(0, 16.5)] }])] }],
        );

        expect(boxes).toEqual([]);
    });

    it('is unbothered by a page that carries no rows at all', () => {
        expect(lineBoxesFrom([block(1)], [{ lines: [line(0, 18.0)] }])).toEqual([
            { pos: 0, heightPx: 18.0 },
        ]);
    });
});
