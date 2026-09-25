import { dtmplToHtml, htmlToDtmpl } from './link-widget-transform';

/**
 * The stored form of a link is one the DTMPL lexer reads.
 *
 * Its param values are backtick strings. Until 2026-09-25 they were written
 * double-quoted (`label="About"`), which the lexer does not read: the DTMPL
 * parser stopped at the `"` for every link written, and 2 of the 54 stored
 * page bodies could not be parsed at all.
 */
describe('link-widget-transform', () => {
    const PAGE = '019d0d67-e8ed-7446-8da0-aea6c493a200';
    const HEX = '019d0d67e8ed74468da0aea6c493a200';

    const anchor = (label: string, extra = ''): string =>
        '<a data-widget="link" data-target-type="page" data-target-id="' + PAGE + '"' + extra + ' href="#">' + label + '</a>';

    it('writes every param as a backtick string, and no double quote', () => {
        const stored = htmlToDtmpl('<p>' + anchor('About us', ' target="_self" rel="nofollow"') + '</p>');

        expect(stored).toBe('<p>{widget:link:page:' + HEX + ' label=`About us` target=`_self` rel=`nofollow`}</p>');
        expect(stored).not.toContain('"');
    });

    it('escapes a backtick in a label the way the lexer reads it', () => {
        expect(htmlToDtmpl(anchor('the `x` key'))).toBe('{widget:link:page:' + HEX + ' label=`the \\`x\\` key`}');
    });

    it('keeps useLatestLabel a string, not a DTMPL boolean', () => {
        expect(htmlToDtmpl(anchor('About', ' data-use-latest-label="true"'))).toContain('useLatestLabel=`true`');
    });

    it('reads back what it writes', () => {
        const html = anchor('the `x` key', ' target="_self"');

        const again = dtmplToHtml(htmlToDtmpl(html));

        expect(again).toContain('data-target-id="' + PAGE + '"');
        expect(again).toContain('target="_self"');
        expect(again).toContain('>the `x` key</a>');
        expect(htmlToDtmpl(again)).toBe(htmlToDtmpl(html));
    });

    it('still reads a link stored double-quoted, and re-saves it in the form the lexer reads', () => {
        const legacy = '{widget:link:page:' + HEX + ' label="about" target="_self"}';

        const html = dtmplToHtml(legacy);

        expect(html).toContain('>about</a>');
        expect(htmlToDtmpl(html)).toBe('{widget:link:page:' + HEX + ' label=`about` target=`_self`}');
    });
});
