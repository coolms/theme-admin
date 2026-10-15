// Copied from @coolms/editor-client's own specs (src/pagination/flow-blocks.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isFlowTable, type FlowBlock, type FlowItem } from '@coolms/document-engine';

import { flowBlocksFromDoc, fontFamiliesIn, rowPositionOf, type BlockBox, type FlowOptions }
    from '@coolms/editor-client';

/**
 * Spec for the editor document -> engine flow mapping.
 *
 * Written for a defect: a top-level block reached the engine as bare spans,
 * so the layout stacked bare lines where the browser stacked boxes with margins
 * -- and a heading arrived at body size on a body line. The engine then believed
 * far more fitted on a page than did, and text ran off the paper.
 *
 * The numbers below are the ones measured off the real canvas: a body paragraph
 * is 14.6625px on a 17.8986px line with .75em (10.9969px) beneath it, and an h1
 * is 24px on a 28.8px line with .8em/.4em around it.
 */
describe('flowBlocksFromDoc', () => {
    const schema = new Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: { group: 'block', content: 'inline*' },
            heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
            text: { group: 'inline' },
            // Enough of a table to exercise the row-height seam. Named exactly
            // as the editor's nodes are, because the mapper dispatches on those
            // names and a spec that renamed them would prove nothing.
            table: { group: 'block', content: 'tableRow+' },
            tableRow: {
                content: 'tableCell+',
                attrs: { height: { default: null }, repeatHeader: { default: false } },
            },
            tableCell: { content: 'block+' },
            // Produces no flow item, which is what makes the document's child
            // index and the block index diverge -- see 'row handles' below.
            pageBreak: { group: 'block' },
        },
        marks: {
            // Named exactly as the editor names it: the mapper dispatches on
            // the mark's type name and a renamed one would prove nothing.
            coolmsTextStyle: {
                attrs: { fontFamily: { default: null }, fontSize: { default: null } },
            },
        },
    });

    const paragraph = (text: string): ProseMirrorNode =>
        schema.node('paragraph', null, '' === text ? [] : [schema.text(text)]);
    const heading = (level: number, text: string): ProseMirrorNode =>
        schema.node('heading', { level }, [schema.text(text)]);

    /** The item at an index, as the paragraph the test knows it to be. */
    const blockAt = (items: readonly FlowItem[], index: number): FlowBlock => {
        const item = items[index];
        if (undefined === item || isFlowTable(item)) {
            throw new Error('expected a paragraph at index ' + String(index));
        }

        return item;
    };

    const BODY: BlockBox = {
        lineHeightPx: 17.8986,
        fontSizePx: 14.6625,
        bold: false,
        spaceBeforePx: 0,
        spaceAfterPx: 10.9969,
    };
    const H1: BlockBox = {
        lineHeightPx: 28.8,
        fontSizePx: 24,
        bold: true,
        spaceBeforePx: 19.2,
        spaceAfterPx: 9.6,
    };

    /** Everything the mapper needs, with nothing measured unless a test says so. */
    const options = (boxes: readonly (BlockBox | null)[] = []): FlowOptions => {
        let asked = 0;

        return {
            contentWidthPx: 642,
            cellPaddingPx: 0,
            cellBorderPx: 0,
            cellBorderStyle: 'solid',
            cellBorderColorHex: '#000000',
            cellParagraphSpaceAfterPx: 0,
            listIndentPx: 24,
            listParagraphSpaceAfterPx: 0,
            listSpaceAfterPx: 0,
            measureHeightAt: () => null,
            measureBoxAt: () => boxes[asked++] ?? null,
        };
    };

    it('carries a body paragraph’s bottom margin into the block style', () => {
        const doc = schema.node('doc', null, [paragraph('Alpha')]);

        const block = blockAt(flowBlocksFromDoc(doc, options([BODY])), 0);

 // Before that fix this was undefined, and 10.9969px per paragraph went
        // missing from every page the engine filled.
        expect(block.style?.spaceAfterPx).toBe(10.9969);
        expect(block.style?.spaceBeforePx).toBe(0);
    });

    it('carries a heading’s own size and weight, but NOT a line height', () => {
        const doc = schema.node('doc', null, [heading(1, 'Title')]);

        const block = blockAt(flowBlocksFromDoc(doc, options([H1])), 0);

        //  The line height is the browser's own number -- the CSS union of
        // the strut and each run's inline box -- and handing it over makes the
        // engine honour it through the `auto` branch and throw away the rule
        // that was measured against LibreOffice at 11 of 11.
        //
 // The SIZE is the half of no face metric can supply, so it still
        // travels.
        expect(block.style?.lineHeightPx).toBeUndefined();
        expect(block.style?.fontSizePx).toBe(24);
        expect(block.style?.bold).toBe(true);
        expect(block.style?.spaceBeforePx).toBe(19.2);
        expect(block.style?.spaceAfterPx).toBe(9.6);
    });

    it('measures each block separately rather than reusing the first', () => {
        const doc = schema.node('doc', null, [heading(1, 'Title'), paragraph('Alpha')]);

        const blocks = flowBlocksFromDoc(doc, options([H1, BODY]));

        // Asserted on the SIZE and the space above, which still differ per
        // block. The line height used to carry this and no longer travels at
        // all -- see the test above for why.
        expect(blockAt(blocks, 0).style?.fontSizePx).toBe(24);
        expect(blockAt(blocks, 1).style?.fontSizePx).toBe(14.6625);
        expect(blockAt(blocks, 0).style?.spaceBeforePx).toBe(19.2);
        expect(blockAt(blocks, 1).style?.spaceBeforePx).toBe(0);
    });

    it('measures an empty paragraph too — the reported repro was pressing Enter', () => {
        const doc = schema.node('doc', null, [paragraph(''), paragraph('')]);

        const blocks = flowBlocksFromDoc(doc, options([BODY, BODY]));

        expect(blocks.length).toBe(2);
        // An empty block still advances the page by a line AND a margin: 28.9px,
        // not 17.9. Believing the smaller number is what let a run of empty
        // paragraphs type straight off the bottom of the paper.
        expect(blockAt(blocks, 0).style?.spaceAfterPx).toBe(10.9969);
        expect(blockAt(blocks, 0).spans).toEqual([]);
    });

    it('leaves a block that cannot be measured alone rather than zeroing it', () => {
        const doc = schema.node('doc', null, [paragraph('Alpha')]);

        const block = blockAt(flowBlocksFromDoc(doc, options([null])), 0);

        // A block the view has not drawn yet is measured again next pass. Zeroes
        // would be a confident wrong answer in the meantime.
        expect(block.style?.spaceAfterPx).toBeUndefined();
        expect(block.style?.fontSizePx).toBeUndefined();
    });

    /**
     * A row height is authored in POINTS (what `w:trHeight` states and the
     * control offers) and the engine measures in px, so this seam converts --
     * and getting it wrong would break the canvas's pages in a different place
     * from the .docx's, which is the one thing a paged editor must not do
     *.
     */
    it('carries a row height through to the engine, points as px', () => {
        const doc = schema.node('doc', null, [
            schema.node('table', null, [
                schema.node('tableRow', { height: 30 }, [
                    schema.node('tableCell', null, [paragraph('Tall')]),
                ]),
                schema.node('tableRow', null, [
                    schema.node('tableCell', null, [paragraph('Auto')]),
                ]),
            ]),
        ]);

        const [item] = flowBlocksFromDoc(doc, options());
        if (undefined === item || !isFlowTable(item)) {
            throw new Error('expected a table');
        }

        // 30pt at 96/72.
        expect(item.rows[0]?.heightPx).toBe(40);
        // A row that states nothing must carry nothing: absent means "as tall
        // as the tallest cell", and a zero would mean a row nobody can see.
        expect(item.rows[1]?.heightPx).toBeUndefined();
    });

    /**
     *  The engine falls back to deriving "this row repeats" from its cells
     * being header cells -- a guess that disagreed with the `.docx`, which
     * repeated nothing at all until `w:tblHeader` was writable. This
     * seam is what stops it guessing, so the value has to arrive STATED, and
     * `false` has to arrive as `false` rather than as an absence the fallback
     * would then answer for.
     */
    it('carries the stated header repeat through to the engine', () => {
        const doc = schema.node('doc', null, [
            schema.node('table', null, [
                schema.node('tableRow', { repeatHeader: true }, [
                    schema.node('tableCell', null, [paragraph('Head')]),
                ]),
                schema.node('tableRow', null, [
                    schema.node('tableCell', null, [paragraph('Body')]),
                ]),
            ]),
        ]);

        const [item] = flowBlocksFromDoc(doc, options());
        if (undefined === item || !isFlowTable(item)) {
            throw new Error('expected a table');
        }

        expect(item.rows[0]?.repeatHeader).toBe(true);
        expect(item.rows[1]?.repeatHeader).toBe(false);
    });

    /**
     *  A run's own face and size, which the toolbar offers and the engine
     * was never told. MEASURED 2026-08-24 on eight paragraphs set in Courier
     * New: the canvas drew ONE A4 sheet and the text ran 343px -- nineteen
     * lines -- past the bottom of it, because every character had been measured
     * with the base proportional face.
     */
    it('carries a run\'s own face and size to the engine', () => {
        const styled = schema.text('Courier', [schema.marks['coolmsTextStyle']!.create({
            fontFamily: 'Courier New',
            fontSize: 18,
        })]);
        const doc = schema.node('doc', null, [schema.node('paragraph', null, [styled])]);

        const span = blockAt(flowBlocksFromDoc(doc, options([BODY])), 0).spans[0];

        expect(span?.fontFamily).toBe('Courier New');
        //  The mark keeps POINTS and the engine measures in px.
        expect(span?.fontSizePx).toBeCloseTo(24, 5);
    });

    /** A run that asked for nothing states nothing: the base style answers. */
    it('leaves a plain run\'s face and size absent', () => {
        const doc = schema.node('doc', null, [paragraph('Plain')]);

        const span = blockAt(flowBlocksFromDoc(doc, options([BODY])), 0).spans[0];

        expect(span?.fontFamily).toBeUndefined();
        expect(span?.fontSizePx).toBeUndefined();
    });

    /**
     *  The catalogue holds only what it was ASKED for, and an unheld family
     * resolves to the base one -- a silent change to the page count. So the
     * families are collected before the layout runs, not discovered by a wrong
     * answer.
     */
    it('reports every family the document names, once each', () => {
        const mark = (family: string) => schema.marks['coolmsTextStyle']!.create({ fontFamily: family });
        const doc = schema.node('doc', null, [
            schema.node('paragraph', null, [schema.text('a', [mark('Courier New')])]),
            schema.node('paragraph', null, [schema.text('b', [mark('Georgia')])]),
            schema.node('paragraph', null, [schema.text('c', [mark('Courier New')])]),
            paragraph('plain'),
        ]);

        expect(fontFamiliesIn(doc).sort()).toEqual(['Courier New', 'Georgia']);
    });

    /**
     * The handle the paged canvas reaches a table row by.
     *
     * `rowPositionOf` is where a page gap that opens inside a table goes -- as
     * a spacer ROW -- and what `view.nodeDOM()` answers the row's own `<tr>`
     * for, which is how a repeated header gets cloned.
     */
    describe('row handles', () => {
        const cell = (text: string): ProseMirrorNode =>
            schema.node('tableCell', null, [paragraph(text)]);
        const row = (...texts: readonly string[]): ProseMirrorNode =>
            schema.node('tableRow', null, texts.map(cell));
        const table = (...rows: readonly ProseMirrorNode[]): ProseMirrorNode =>
            schema.node('table', null, [...rows]);

        it('points rowPositionOf at the row node itself', () => {
            const doc = schema.node('doc', null, [table(row('a'), row('b'))]);

            const at = rowPositionOf(doc, 0, 1);

            expect(at).not.toBeNull();
            expect(doc.nodeAt(at ?? 0)?.type.name).toBe('tableRow');
            // The SECOND row, so an off-by-one in the walk cannot pass.
            expect(doc.nodeAt(at ?? 0)?.textContent).toBe('b');
        });

        /**
         *  Counted the way `flowBlocksFromDoc` counts: a page break produces
         * no flow item, so the document's child index runs AHEAD of the block
         * index after the first one. A walk that used the child index would
         * point the gaps at the wrong table the moment an author broke a page.
         */
        it('counts blocks past a page break the way the flow does', () => {
            const doc = schema.node('doc', null, [
                table(row('first')),
                schema.node('pageBreak'),
                table(row('second')),
            ]);

            // The second table is the document's THIRD child and the flow's
            // SECOND block, which is the whole point of the case.
            expect(doc.child(1).type.name).toBe('pageBreak');
            expect(flowBlocksFromDoc(doc, options()).length).toBe(2);

            const at = rowPositionOf(doc, 1, 0);

            expect(doc.nodeAt(at ?? 0)?.textContent).toBe('second');
        });

        it('answers nothing for a row that is not there', () => {
            const doc = schema.node('doc', null, [table(row('a'))]);

            expect(rowPositionOf(doc, 0, 4)).toBeNull();
        });

        it('answers nothing for a block that is not a table', () => {
            const doc = schema.node('doc', null, [paragraph('Alpha')]);

            expect(rowPositionOf(doc, 0, 0)).toBeNull();
        });
    });

    /**
     *  A table's rules are ROOM, and the engine has its own seam for them:
     * it keeps a rule's width between the rows it separates, which is what
     * `border-collapse: collapse` draws -- N + 1 of them down a table of N
     * rows. The measurement used to be folded into the cell PADDING instead,
     * and the engine applies padding to both sides of every row, so a rule
     * shared between two rows was counted twice: 42.90px a row against the
     * browser's 41.69.
     */
    it('declares a table\'s rules rather than folding them into the padding', () => {
        const doc = schema.node('doc', null, [
            schema.node('table', null, [
                schema.node('tableRow', null, [schema.node('tableCell', null, [paragraph('a')])]),
            ]),
        ]);

        const [item] = flowBlocksFromDoc(doc, {
            ...options(),
            cellPaddingPx: 6,
            cellBorderPx: 1,
            cellBorderStyle: 'dashed',
            cellBorderColorHex: '#38383a',
        });
        if (undefined === item || !isFlowTable(item)) {
            throw new Error('expected a table');
        }

        // The padding arrives as padding, untouched by the rule.
        expect(item.cellPaddingPx).toBe(6);
        expect(item.borders?.insideH?.widthPx).toBe(1);
        expect(item.borders?.top?.widthPx).toBe(1);
        // Measured, not invented: nothing on this canvas paints from the model,
        // but a model that describes a table nobody drew is worse than one that
        // says only the width.
        expect(item.borders?.insideH?.style).toBe('dashed');
        expect(item.borders?.insideH?.colorHex).toBe('#38383a');
    });

    /** A table with no rule declares none, rather than one of width zero. */
    it('declares no borders when the cells draw none', () => {
        const doc = schema.node('doc', null, [
            schema.node('table', null, [
                schema.node('tableRow', null, [schema.node('tableCell', null, [paragraph('a')])]),
            ]),
        ]);

        const [item] = flowBlocksFromDoc(doc, { ...options(), cellPaddingPx: 6, cellBorderPx: 0 });
        if (undefined === item || !isFlowTable(item)) {
            throw new Error('expected a table');
        }

        expect(item.borders).toBeUndefined();
    });

    /**
     *  A heading holds on to what it heads, or it prints alone at the foot of
     * a page. The engine has modelled `keepWithNext` since it could read one
     * out of a `.docx` and nothing on this side ever set it -- so the canvas
     * stranded a heading exactly as the file did. `StylesPart::headingStyle()`
     * writes the `w:keepNext` that says the same thing to a reader.
     */
    it('tells the engine a heading holds on to what it heads', () => {
        const doc = schema.node('doc', null, [heading(2, 'Section'), paragraph('Body')]);

        const blocks = flowBlocksFromDoc(doc, options([H1, BODY]));

        expect(blockAt(blocks, 0).style?.keepWithNext).toBe(true);
        // And an ordinary paragraph does NOT: a page may break under it.
        expect(blockAt(blocks, 1).style?.keepWithNext).toBeUndefined();
    });

    it('keeps the ProseMirror positions the engine reports breaks in', () => {
        const doc = schema.node('doc', null, [paragraph('Alpha'), paragraph('Beta')]);

        const blocks = flowBlocksFromDoc(doc, options([BODY, BODY]));

        // Measuring must not disturb the handles: 'Alpha' starts at 1, and
        // 'Beta' at 1 + 5 + 2 for the paragraph's own open/close tokens.
        expect(blockAt(blocks, 0).spans[0]?.at).toBe(1);
        expect(blockAt(blocks, 1).spans[0]?.at).toBe(8);
    });
});
