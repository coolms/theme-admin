// Copied from @coolms/editor-client's own specs (src/extensions/paste-cleanup/paste-cleanup.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { cleanPastedHtml, looksLikeOfficeOrDocs } from '@coolms/editor-client';

/**
 * Spec for the Word / Google-Docs paste cleanup.
 *
 * The `cleanPastedHtml` cases need a DOM (`DOMParser`) and so pin real browser
 * behaviour; `looksLikeOfficeOrDocs` is a pure string check.
 *
 * Key invariants:
 *   - only Word / Docs HTML is rewritten; everything else (incl. intra-editor
 *     widget copies) passes through untouched;
 *   - mso cruft, conditional comments, empty filler paragraphs are removed;
 *   - Google-Docs style-encoded bold/italic/underline survive as <strong>/
 *     <em>/<u>; spans are unwrapped; presentational attributes are stripped;
 *   - headings / lists / links are preserved.
 */

describe('looksLikeOfficeOrDocs', () => {
    it('flags Word markup', () => {
        expect(looksLikeOfficeOrDocs('<p class="MsoNormal">x</p>')).toBe(true);
        expect(looksLikeOfficeOrDocs('<o:p></o:p>')).toBe(true);
        expect(looksLikeOfficeOrDocs('<span style="mso-bidi-font-weight:bold">x</span>')).toBe(true);
    });

    it('flags Google Docs markup', () => {
        expect(looksLikeOfficeOrDocs('<b id="docs-internal-guid-abc"><span>x</span></b>')).toBe(true);
    });

    it('leaves ordinary / intra-editor HTML alone', () => {
        expect(looksLikeOfficeOrDocs('<p>hello <strong>world</strong></p>')).toBe(false);
        expect(looksLikeOfficeOrDocs('<div class="callout callout-note">note</div>')).toBe(false);
    });
});

describe('cleanPastedHtml', () => {
    it('returns non-Office HTML unchanged', () => {
        const html = '<div data-widget="media" class="cms-grid"><p>x</p></div>';
        expect(cleanPastedHtml(html)).toBe(html);
    });

    it('strips mso styles, classes and empty filler paragraphs from Word', () => {
        const word = `
            <p class="MsoNormal" style="margin:0in;mso-pagination:none">Hello <b>bold</b></p>
            <p class="MsoNormal" style="mso-pagination:none">&nbsp;</p>
            <o:p></o:p>`;
        const out = cleanPastedHtml(word);
        expect(out).toContain('Hello');
        expect(out).toContain('<b>bold</b>');
        expect(out).not.toContain('Mso');
        expect(out).not.toContain('mso-');
        expect(out).not.toContain('class=');
        expect(out).not.toContain('o:p');
        // The &nbsp;-only filler paragraph is gone.
        expect(out.match(/<p>/g) ?? []).toHaveSize(1);
    });

    it('converts Google-Docs style-encoded emphasis to semantic tags', () => {
        const docs = `<b id="docs-internal-guid-1">
            <span style="font-weight:700">heavy</span>
            <span style="font-style:italic">slanted</span>
            <span style="text-decoration:underline">under</span>
            <span style="font-weight:400">plain</span>
        </b>`;
        const out = cleanPastedHtml(docs);
        expect(out).toContain('<strong>heavy</strong>');
        expect(out).toContain('<em>slanted</em>');
        expect(out).toContain('<u>under</u>');
        expect(out).toContain('plain');
        expect(out).not.toContain('<span');
        expect(out).not.toContain('style=');
    });

    it('preserves headings, lists and links', () => {
        const word = `<div class="MsoNormal">
            <h2 style="mso-pagination:none">Title</h2>
            <ul style="mso-list:l0"><li class="MsoListParagraph">one</li><li>two</li></ul>
            <a href="https://example.com" style="color:#06c">link</a>
        </div>`;
        const out = cleanPastedHtml(word);
        expect(out).toContain('<h2>Title</h2>');
        expect(out).toContain('<li>one</li>');
        expect(out).toContain('<li>two</li>');
        expect(out).toContain('href="https://example.com"');
        expect(out).not.toContain('style=');
    });

    it('drops javascript: hrefs', () => {
        const word = '<p class="MsoNormal"><a href="javascript:alert(1)">x</a></p>';
        const out = cleanPastedHtml(word);
        expect(out).toContain('<a>x</a>');
        expect(out).not.toContain('javascript:');
    });

    it('normalises smart quotes only when asked', () => {
        const word = '<p class="MsoNormal">“hi” ‘there’</p>';
        expect(cleanPastedHtml(word)).toContain('“hi”');
        expect(cleanPastedHtml(word, { normalizeSmartQuotes: true })).toContain('"hi" \'there\'');
    });
});
