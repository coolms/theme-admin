// Copied from @coolms/editor-client's own specs (src/document-schema-round-trip.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { Editor } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import BulletList from '@tiptap/extension-bullet-list';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import History from '@tiptap/extension-history';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';

import Code from '@tiptap/extension-code';
import { CalloutNode } from '@coolms/editor-client';
import { MathNode } from '@coolms/editor-client';
import { CmsTextAlignExtension } from '@coolms/editor-client';
import { createCoolmsCodeBlock } from '@coolms/editor-client';
import { CmsHardBreak } from '@coolms/editor-client';
import { CmsTable } from '@coolms/editor-client';
import { CmsTableCell, CmsTableHeader } from '@coolms/editor-client';
import { CmsTableRow } from '@coolms/editor-client';
import { DocumentImageNode } from '@coolms/editor-client';
import { FootnoteReferenceNode } from '@coolms/editor-client';
import { PageBreakNode } from '@coolms/editor-client';
import { SubscriptMark, SuperscriptMark } from '@coolms/editor-client';
import { CoolmsTextStyle } from '@coolms/editor-client';

/**
 * The editor's SCHEMA is the third place a document can lose its formatting.
 *
 * One change made the PHP model round-trip through editor HTML without loss, and
 * Another built the endpoints that carry it. Between the two sits ProseMirror,
 * which does not ignore what it cannot model -- it STRIPS it. So a `.ddoc`
 * whose vocabulary the schema does not declare comes back poorer than it went
 * in, and the save writes the poorer version over the author's file.
 *
 * Every case below is a shape `DocumentHtmlWriter` really emits. The assertion
 * is the HTML back out of a real editor, because a claim about a `parseHTML`
 * declaration proves nothing about what the serializer writes.
 *
 * ## What was measured before this spec existed
 *
 * Five losses, each silent: `<u>` (nothing registered an underline mark at
 * all, though the paste cleanup emits one), `<img>` (page content uses media
 * widgets, so no image node existed), the table's own width/border/margin
 * attributes, `<br data-page-break>` (the marker went, the break became a line
 * break), and a span carrying ONLY a highlight.
 *
 *  A sixth was worse than a loss: `<sup data-footnote="3">` parsed as the
 * superscript MARK, so the digit stayed, the attribute went, and the document
 * looked right with a dead footnote in it.
 */
describe('the document vocabulary through the editor schema', () => {
    let element: HTMLElement;

    /**
     * The units a document surface mounts.
     *
     *  This list is not decoration -- it is the SCHEMA under test, and it has
     * to track what the `document-builder` profile really mounts. The editor
     * assembles its units from the profile's contributors, so withdrawing a
     * contributor unmounts its node, and mounting one here that production does
     * not is a test that passes for a shape the app would strip.
     *
     *  It said "callout, math, embed and grid claim no tag in this
 * vocabulary" and that stopped being true, when
     * `DocumentHtmlWriter` began emitting `<pre><code>` and
     * `<div class="callout ...">`. Math, embed and grid still claim none.
     */
    const documentExtensions = [
        Document, Paragraph, Text, History, CmsHardBreak,
        Bold, Italic, Strike, Underline, SuperscriptMark, SubscriptMark, Code,
        Heading, BulletList, OrderedList, ListItem, Blockquote,
        Link.configure({ openOnClick: false }),
        CmsTable.configure({ resizable: true }), CmsTableRow, CmsTableHeader, CmsTableCell,
        PageBreakNode, CoolmsTextStyle,
        // The document vocabulary.
        createCoolmsCodeBlock(), CalloutNode, MathNode,
        // The ones the `preserveDocumentFormatting` switch adds.
        DocumentImageNode, FootnoteReferenceNode, CmsTextAlignExtension,
    ];

    const roundTrip = (html: string): string => {
        const editor = new Editor({ element, extensions: documentExtensions, content: html });
        const out = editor.getHTML();
        editor.destroy();

        return out;
    };

    beforeEach(() => {
        element = document.createElement('div');
        document.body.appendChild(element);
    });

    afterEach(() => {
        element.remove();
    });

    it('keeps the four run marks', () => {
        const html = '<p><strong>b</strong><em>i</em><u>u</u><s>s</s></p>';

        expect(roundTrip(html)).toBe(html);
    });

    /**
     *  The colour comes back as `rgb(255, 0, 0)`, not as the `#FF0000` that
     * went in -- `el.style.color` is the BROWSER's normalisation and there is no
     * way to read the original text back out of it.
     *
     * That is not a loss, and the assertion says so rather than pretending the
     * hex survives: `TextMapper::hex()` on the PHP side accepts `rgb()` and
     * `rgba()` as well as hex, so the model gets `FF0000` either way. It is a
     * real cross-boundary dependency, though -- this is the shape the PHP mapper
     * actually receives in production, which is why it has a test of its own.
     */
    it('keeps a run\'s font, size, colour and highlight', () => {
        const out = roundTrip(
            '<p><span style="font-family:Georgia;font-size:16pt;color:#FF0000;background-color:#FFFF00">x</span></p>',
        );

        expect(out).toContain('font-family: Georgia');
        expect(out).toContain('font-size: 16pt');
        expect(out).toContain('color: rgb(255, 0, 0)');
        expect(out).toContain('background-color: rgb(255, 255, 0)');
    });

    /**  A highlight ALONE used to match nothing and be stripped. */
    it('keeps a run carrying only a highlight', () => {
        expect(roundTrip('<p><span style="background-color:#FFFF00">x</span></p>'))
            .toContain('background-color: rgb(255, 255, 0)');
    });

    /**
 * THE assertion behind: a `<sup>` with no `data-footnote` is a
     * superscripted character, and one WITH it is a footnote reference. Both
     * are `<sup>`, and the schema has to tell them apart -- a spec covering
     * only one of them would pass while the other silently became the other.
     */
    it('keeps a bare superscript and a subscript', () => {
        expect(roundTrip('<p>12 m<sup>2</sup></p>')).toContain('<sup>2</sup>');
        expect(roundTrip('<p>H<sub>2</sub>O</p>')).toContain('<sub>2</sub>');
    });

    it('keeps an inline code mark', () => {
        expect(roundTrip('<p>Run <code>ls -la</code> first.</p>')).toContain('<code>ls -la</code>');
    });

    /**
     * The shape `DocumentHtmlWriter` emits for a run of `Code` paragraphs.
     *
     *  The NEWLINES are the assertion. A code block whose lines are joined
     * into one is a code block that no longer runs, and the loss would be
     * invisible in a "contains the text" check.
     */
    it('keeps a code block, lines and all', () => {
        const out = roundTrip('<pre><code>function f()\n{\n    return 1;\n}</code></pre>');

        expect(out).toContain('<pre>');
        expect(out).toContain('function f()');
        expect(out).toContain('    return 1;');
        expect(out.replace(/<[^>]+>/g, '').split('\n').length).toBe(4);
    });

    /**
     *  The callout is selected by its CLASS and typed by its ATTRIBUTE --
     * `parseHTML` matches `div.callout`, and `data-callout` carries which kind.
     * Two different keys for one fact, on two sides of the wire: the PHP mapper
     * reads the attribute and the schema reads the class. A writer emitting
     * only one of them produces a callout that one side keeps and the other
     * strips, which is why both are asserted here.
     */
    it('keeps a callout, its type and its paragraphs', () => {
        const out = roundTrip(
            '<div class="callout callout-warning" data-callout="warning"><p>First</p><p>Second</p></div>',
        );

        expect(out).toContain('data-callout="warning"');
        expect(out).toContain('First');
        expect(out).toContain('Second');
    });

    it('keeps each callout type distinct', () => {
        for (const type of ['note', 'warning', 'tip']) {
            const out = roundTrip(`<div class="callout callout-${type}" data-callout="${type}"><p>x</p></div>`);
            expect(out).withContext(`the ${type} callout`).toContain(`data-callout="${type}"`);
        }
    });

    /**
     * A formula, which is a span the schema has to claim BEFORE the text-style
     * mark does -- otherwise it comes back as prose carrying a class nobody
 * reads, which is the editor-side twin of the loss fixed in PHP.
     */
    it('keeps a formula as a formula', () => {
        const out = roundTrip('<p>Rate is <span class=katex-src data-display=0>a+b</span>.</p>');

        expect(out).toContain('katex-src');
        expect(out).toContain('a+b');
    });

    it('keeps a heading, a quote and a nested list', () => {
        expect(roundTrip('<h2>Section</h2>')).toContain('<h2>Section</h2>');
        expect(roundTrip('<blockquote><p>Quoted</p></blockquote>')).toContain('<blockquote>');

        const nested = roundTrip('<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>');
        expect(nested).toContain('Outer');
        expect(nested).toContain('Inner');
        // The nesting itself, not merely both texts: a flattened list would
        // still contain both words.
        expect(nested.indexOf('<ul>')).toBeLessThan(nested.lastIndexOf('<ul>'));
    });

    /**
     *  Including the ABSENCE of one. An unaligned paragraph must render no
     * `text-align` at all: absent means inherit, and inherit is the right
     * margin in a right-to-left document, so an editor that helpfully filled in
     * `left` would pin every paragraph of every imported document to one edge.
     */
    it('keeps every paragraph alignment, and adds none where there is none', () => {
        for (const align of ['left', 'center', 'right', 'justify']) {
            expect(roundTrip(`<p style="text-align: ${align}">x</p>`))
                .toContain(`text-align: ${align}`);
        }

        expect(roundTrip('<p>x</p>')).not.toContain('text-align');
    });

    it('keeps an alignment on a heading too', () => {
        expect(roundTrip('<h1 style="text-align: center">Title</h1>'))
            .toContain('text-align: center');
    });

    it('keeps a link', () => {
        expect(roundTrip('<p><a href="https://example.com/terms">terms</a></p>'))
            .toContain('href="https://example.com/terms"');
    });

    /**  The one that looked right and was dead. */
    it('keeps a footnote reference as a reference, not as superscript', () => {
        const out = roundTrip('<p>note<sup data-footnote="3">3</sup></p>');

        expect(out).toContain('data-footnote="3"');
    });

    it('keeps a plain superscript that is not a footnote', () => {
        const out = roundTrip('<p>x<sup>2</sup></p>');

        expect(out).toContain('<sup>2</sup>');
        expect(out).not.toContain('data-footnote');
    });

    it('keeps a block page break and a page break inside a paragraph', () => {
        expect(roundTrip('<hr data-page-break>')).toContain('data-page-break');

        //  Different thing, same marker: the `<br>` form is how OOXML breaks
        // a page mid-paragraph, and losing the attribute turns it into an
        // ordinary line break with the following text on the same page.
        const inline = roundTrip('<p>before<br data-page-break>after</p>');
        expect(inline).toContain('data-page-break');
        expect(inline).toContain('before');
        expect(inline).toContain('after');
    });

    it('keeps an ordinary soft line break unmarked', () => {
        const out = roundTrip('<p>one<br>two</p>');

        expect(out).toContain('<br>');
        expect(out).not.toContain('data-page-break');
    });

    it('keeps a table\'s own width, border and cell margin', () => {
        const out = roundTrip(
            '<table data-width-twips="9000" data-border-eighths="0" data-border-color=""'
            + ' data-cell-margin-twips="0" data-cell-margin-horizontal-twips="0">'
            + '<tbody><tr><td colwidth="600"><p>cell</p></td></tr></tbody></table>',
        );

        expect(out).toContain('data-width-twips="9000"');
        //  Zero, not absent: a borderless table that came back stating
        // nothing gets the mapper's default border on the next save.
        expect(out).toContain('data-border-eighths="0"');
        expect(out).toContain('data-cell-margin-twips="0"');
        expect(out).toContain('data-cell-margin-horizontal-twips="0"');
        expect(out).toContain('colwidth="600"');
    });

    //  The two axes are kept APART. Both stated as the canvas paints them --
    // 6px vertical, 10px horizontal -- and a schema modelling only the older
    // attribute would drop the second on load and save a table that states one
 // margin, which is the state a later fix closed.
    it('keeps the cell margin\'s two axes apart', () => {
        const out = roundTrip(
            '<table data-width-twips="9000" data-cell-margin-twips="90"'
            + ' data-cell-margin-horizontal-twips="150">'
            + '<tbody><tr><td colwidth="600"><p>cell</p></td></tr></tbody></table>',
        );

        expect(out).toContain('data-cell-margin-twips="90"');
        expect(out).toContain('data-cell-margin-horizontal-twips="150"');
    });

    it('keeps a row height and a column width', () => {
        const out = roundTrip(
            '<table><tbody><tr data-height="20"><td colwidth="160"><p>a</p></td>'
            + '<td colwidth="440"><p>b</p></td></tr></tbody></table>',
        );

        expect(out).toContain('data-height="20"');
        expect(out).toContain('colwidth="160"');
        expect(out).toContain('colwidth="440"');
    });

    /**
     *  The marker is a row ATTRIBUTE and not a `<thead>` precisely because of
     * this trip. ProseMirror's table schema has no thead node -- it serialises
     * rows straight into a `<tbody>` -- so a `<thead>` parses fine and then
     * vanishes on the way out, taking "repeat at the top of every page" with it
     * on the author's first save.
     */
    it('keeps a header row that repeats on every page', () => {
        const out = roundTrip(
            '<table><tbody><tr data-repeat-header><th colwidth="600"><p>Item</p></th></tr>'
            + '<tr><td colwidth="600"><p>Widget</p></td></tr></tbody></table>',
        );

        expect(out).toContain('data-repeat-header');
        expect(out).toContain('<th');
        // The body row keeps neither -- a repeat written onto every row would
        // put the whole table at the top of each page.
        expect(out.match(/data-repeat-header/g)?.length).toBe(1);
        expect(out).toContain('<td');
    });

    /**
     * The two facts are separate, and this is the case that proves it: a
     * row-label column is header cells in rows that do not repeat. Fusing them
     * into one flag is the tempting simplification.
     */
    it('keeps a header cell in a row that does not repeat', () => {
        const out = roundTrip(
            '<table><tbody><tr><th colwidth="300"><p>Total</p></th>'
            + '<td colwidth="600"><p>12.00</p></td></tr></tbody></table>',
        );

        expect(out).toContain('<th');
        expect(out).toContain('<td');
        expect(out).not.toContain('data-repeat-header');
    });

    /** An image imported from a `.docx` has no address at all. */
    it('keeps an image, its size, and a data URI', () => {
        const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
            + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const out = roundTrip(`<p><img src="${src}" width="40" height="30"></p>`);

        expect(out).toContain('src="data:image/png;base64,');
        expect(out).toContain('width="40"');
        expect(out).toContain('height="30"');
    });

    it('keeps an image that has an address', () => {
        const out = roundTrip('<p><img src="/media/logo.png" width="40" height="30"></p>');

        expect(out).toContain('src="/media/logo.png"');
    });
});
