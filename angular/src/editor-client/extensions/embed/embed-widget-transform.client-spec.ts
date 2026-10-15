// Copied from @coolms/editor-client's own specs (src/extensions/embed/embed-widget-transform.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { embedDtmplToHtml, embedHtmlToDtmpl } from '@coolms/editor-client';

/**
 * Spec for the embed widget <-> dtmpl transform.
 *
 * Key invariants:
 *   - every param is BACKTICK-delimited on save (the DTMPL lexer's only string
 *     form; even the digit-led `ratio` would otherwise lex as a number),
 *   - dtmpl -> HTML -> dtmpl is lossless for url / ratio / title,
 *   - a tag without `src` (load) or a marker without `data-url` (save) passes
 *     through unchanged so source-mode editing never silently drops content.
 */
describe('embed-widget-transform', () => {
    describe('embedDtmplToHtml', () => {
        it('expands a full tag into a marker div the node parses', () => {
            const html = embedDtmplToHtml(
                '{widget:embed:video src=`https://youtu.be/dQw4w9WgXcQ` ratio=`4x3` title=`Demo`}',
            );
            expect(html).toContain('data-widget="embed"');
            expect(html).toContain('data-url="https://youtu.be/dQw4w9WgXcQ"');
            expect(html).toContain('data-ratio="4x3"');
            expect(html).toContain('data-title="Demo"');
            expect(html).toContain('class="cms-embed-placeholder"');
        });

        it('defaults an unknown ratio to 16x9', () => {
            const html = embedDtmplToHtml('{widget:embed:video src=`https://vimeo.com/1` ratio=`99x1`}');
            expect(html).toContain('data-ratio="16x9"');
        });

        it('passes a tag with no src through unchanged', () => {
            const tag = '{widget:embed:video ratio=`16x9`}';
            expect(embedDtmplToHtml(tag)).toBe(tag);
        });

        it('carries the iframe kind through to the marker', () => {
            const html = embedDtmplToHtml('{widget:embed:iframe src=`https://codepen.io/team/embed/abc` ratio=`4x3`}');
            expect(html).toContain('data-kind="iframe"');
            expect(html).toContain('data-url="https://codepen.io/team/embed/abc"');
            expect(html).toContain('data-ratio="4x3"');
        });

        it('carries the audio kind through to the marker', () => {
            const html = embedDtmplToHtml('{widget:embed:audio src=`https://open.spotify.com/track/abc`}');
            expect(html).toContain('data-kind="audio"');
            expect(html).toContain('data-url="https://open.spotify.com/track/abc"');
        });
    });

    describe('embedHtmlToDtmpl', () => {
        it('rewrites a marker div into a backtick-quoted tag', () => {
            const tag = embedHtmlToDtmpl(
                '<div data-widget="embed" data-url="https://vimeo.com/123456" data-ratio="21x9" data-title="Talk" class="cms-embed-placeholder"><span>x</span></div>',
            );
            expect(tag).toBe('{widget:embed:video src=`https://vimeo.com/123456` ratio=`21x9` title=`Talk`}');
        });

        it('omits the title param when empty', () => {
            const tag = embedHtmlToDtmpl(
                '<div data-widget="embed" data-url="https://youtu.be/abc123" data-ratio="16x9" data-title=""></div>',
            );
            expect(tag).toBe('{widget:embed:video src=`https://youtu.be/abc123` ratio=`16x9`}');
        });

        it('leaves a marker without data-url unchanged', () => {
            const div = '<div data-widget="embed" data-ratio="16x9"></div>';
            expect(embedHtmlToDtmpl(div)).toBe(div);
        });

        it('emits the iframe kind in the token', () => {
            const tag = embedHtmlToDtmpl(
                '<div data-widget="embed" data-kind="iframe" data-url="https://codepen.io/team/embed/abc" data-ratio="4x3" data-title=""></div>',
            );
            expect(tag).toBe('{widget:embed:iframe src=`https://codepen.io/team/embed/abc` ratio=`4x3`}');
        });

        it('omits ratio for the audio kind', () => {
            const tag = embedHtmlToDtmpl(
                '<div data-widget="embed" data-kind="audio" data-url="https://open.spotify.com/track/abc" data-ratio="16x9" data-title="Song"></div>',
            );
            expect(tag).toBe('{widget:embed:audio src=`https://open.spotify.com/track/abc` title=`Song`}');
        });
    });

    describe('round-trip', () => {
        it('preserves the tag across dtmpl -> HTML -> dtmpl', () => {
            const original = '{widget:embed:video src=`https://www.youtube.com/watch?v=dQw4w9WgXcQ` ratio=`16x9` title=`Never gonna`}';
            expect(embedHtmlToDtmpl(embedDtmplToHtml(original))).toBe(original);
        });

        it('preserves a title-less tag', () => {
            const original = '{widget:embed:video src=`https://vimeo.com/123456` ratio=`4x3`}';
            expect(embedHtmlToDtmpl(embedDtmplToHtml(original))).toBe(original);
        });

        it('preserves an iframe tag', () => {
            const original = '{widget:embed:iframe src=`https://www.google.com/maps/embed?pb=!1m18` ratio=`4x3` title=`Map`}';
            expect(embedHtmlToDtmpl(embedDtmplToHtml(original))).toBe(original);
        });

        it('preserves a (ratio-less) audio tag', () => {
            const original = '{widget:embed:audio src=`https://open.spotify.com/track/abc` title=`Song`}';
            expect(embedHtmlToDtmpl(embedDtmplToHtml(original))).toBe(original);
        });
    });
});
