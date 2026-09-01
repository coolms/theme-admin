import {
    dtmplToHtml,
    htmlToDtmpl,
    extractMediaUuids,
    type MediaResolveResult,
} from './media-widget-transform';

/**
 * Spec for the media widget <-> dtmpl transform, focused on the collection
 * gallery (UUID-based) path and its disambiguation from single assets.
 *
 * Key invariant: galleries (collection-mode) and single assets now share the
 * `{widget:media:<uuid> …}` prefix; they are told apart by the presence of a
 * `type=` param (galleries always carry it, single assets never do). The legacy
 * path form `{widget:media:/path …}` is gone.
 */

const ASSET_UUID = '019d3dbc-45e8-7e01-aaad-8aa3db96e95c';
const COLL_UUID  = '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

const resolve = (uuid: string): MediaResolveResult | null =>
    ({ url: `/media/preview/${uuid}.jpg`, kind: 'image' });

describe('dtmplToHtml — single vs gallery disambiguation', () => {
    it('renders a single-asset tag (no type=) as an <img> marker', () => {
        const html = dtmplToHtml(`{widget:media:${ASSET_UUID} size=medium}`, resolve);
        expect(html).toContain('data-widget="media"');
        expect(html).toContain(`data-uuid="${ASSET_UUID}"`);
        expect(html).not.toContain('media-gallery');
    });

    it('renders a gallery tag (type=) as a media-gallery placeholder div', () => {
        const html = dtmplToHtml(`{widget:media:${COLL_UUID} type=grid cols=3}`, resolve);
        expect(html).toContain('data-widget="media-gallery"');
        expect(html).toContain(`data-collection="${COLL_UUID}"`);
        expect(html).toContain('data-cols="3"');
        expect(html).not.toContain('<img');
    });
});

/**
 * Single-asset string params (alt/class/caption) must be BACKTICK-delimited.
 * The DTMPL tag lexer's only string delimiter is the backtick; a double-quoted
 * value throws "Unexpected character" -> HTTP 500 at SSR. These specs pin the
 * delimiter, the raw (decoded) storage, and the save/reload round-trip.
 *
 * Note on JS: the dtmpl strings below carry literal backticks, so they are
 * written as single-quoted JS strings (backticks inside `'…'` are literal),
 * never as JS template literals.
 */
describe('htmlToDtmpl — single-asset string params are backtick-delimited (SSR-safe)', () => {
    const imgWith = (attrs: string) =>
        `<img data-widget="media" data-kind="image" data-uuid="${ASSET_UUID}" data-size="medium" src="/x.jpg"${attrs}>`;

    it('emits a caption as a backtick param, never a double-quoted one', () => {
        const figure =
            `<figure>${imgWith('')}<figcaption>Hello world</figcaption></figure>`;
        const dtmpl = htmlToDtmpl(figure);
        // Backtick delimiter, not the SSR-fatal double quote.
        expect(dtmpl).toContain('caption=`Hello world`');
        expect(dtmpl).not.toContain('caption="');
    });

    it('emits alt and class as backtick params', () => {
        const dtmpl = htmlToDtmpl(imgWith(' alt="A caption" class="hero big"'));
        expect(dtmpl).toContain('alt=`A caption`');
        expect(dtmpl).toContain('class=`hero big`');
        expect(dtmpl).not.toContain('alt="');
        expect(dtmpl).not.toContain('class="');
    });

    it('stores RAW text — decodes the HTML entities the editor serialized', () => {
        // The editor serializes alt="Tom & \"Jerry\"" as the entity form below.
        const dtmpl = htmlToDtmpl(imgWith(' alt="Tom &amp; &quot;Jerry&quot;"'));
        // Decoded back to raw; double quotes are SAFE inside a backtick string.
        expect(dtmpl).toContain('alt=`Tom & "Jerry"`');
        expect(dtmpl).not.toContain('&amp;');
        expect(dtmpl).not.toContain('&quot;');
    });

    it('escapes an embedded backtick in a caption', () => {
        const figure =
            `<figure>${imgWith('')}<figcaption>a \` b</figcaption></figure>`;
        const dtmpl = htmlToDtmpl(figure);
        // Literal backtick is escaped as \` so it doesn't close the string.
        expect(dtmpl).toContain('caption=`a \\` b`');
    });
});

describe('single-asset round-trip dtmpl -> html -> dtmpl (backtick params)', () => {
    it('preserves a caption across save/reload', () => {
        const original = '{widget:media:' + ASSET_UUID + ' size=medium caption=`Hello world`}';
        const back = htmlToDtmpl(dtmplToHtml(original, resolve));
        expect(back).toContain('{widget:media:' + ASSET_UUID + ' ');
        expect(back).toContain('caption=`Hello world`');
        expect(back).not.toContain('caption="');
    });

    it('preserves alt and class across save/reload', () => {
        const original = '{widget:media:' + ASSET_UUID + ' size=medium alt=`A caption` class=`hero`}';
        const back = htmlToDtmpl(dtmplToHtml(original, resolve));
        expect(back).toContain('alt=`A caption`');
        expect(back).toContain('class=`hero`');
    });

    it('preserves double quotes carried inside a backtick caption', () => {
        const original = '{widget:media:' + ASSET_UUID + ' caption=`He said "hi"`}';
        const back = htmlToDtmpl(dtmplToHtml(original, resolve));
        expect(back).toContain('caption=`He said "hi"`');
    });
});

describe('htmlToDtmpl — gallery placeholder div', () => {
    it('rewrites a gallery div to a UUID widget tag with only lex-safe params', () => {
        const div =
            `<div data-widget="media-gallery" data-collection="${COLL_UUID}"`
            + ' data-name="portraits" data-type="slider" data-cols="" data-limit="20" data-depth="1"'
            + ' class="cms-media-gallery-placeholder"><span></span></div>';
        const dtmpl = htmlToDtmpl(div);
        expect(dtmpl).toContain(`{widget:media:${COLL_UUID} `);
        expect(dtmpl).toContain('type=slider');
        expect(dtmpl).toContain('limit=20');
        expect(dtmpl).toContain('depth=1');
        // The DTMPL tag lexer's only string delimiter is the backtick — a
        // double-quoted value 500s at SSR. So the tag must carry NO `"` and the
        // display name must NOT be serialized.
        expect(dtmpl).not.toContain('"');
        expect(dtmpl).not.toContain('name=');
        expect(dtmpl).not.toContain('/'); // no path form, no slash anywhere in the tag
    });
});

describe('gallery round-trip dtmpl -> html -> dtmpl', () => {
    it('preserves collection uuid, type, and numeric params (name not stored)', () => {
        const original = `{widget:media:${COLL_UUID} type=grid cols=3 limit=20}`;
        const back = htmlToDtmpl(dtmplToHtml(original, resolve));
        expect(back).toContain(`{widget:media:${COLL_UUID} `);
        expect(back).toContain('type=grid');
        expect(back).toContain('cols=3');
        expect(back).toContain('limit=20');
        expect(back).not.toContain('"');
    });
});

describe('extractMediaUuids', () => {
    it('returns single-asset uuids and skips gallery (collection) uuids', () => {
        const content =
            `{widget:media:${ASSET_UUID} size=medium} and `
            + `{widget:media:${COLL_UUID} type=grid cols=3}`;
        const uuids = extractMediaUuids(content);
        expect(uuids).toContain(ASSET_UUID);
        expect(uuids).not.toContain(COLL_UUID);
    });
});
