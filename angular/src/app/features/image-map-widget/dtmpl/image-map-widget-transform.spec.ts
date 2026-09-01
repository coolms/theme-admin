import { dtmplToHtml, htmlToDtmpl } from './image-map-widget-transform';

/**
 * The `{widget:imagemap:<slug>}` ↔ marker-div transform.
 *
 * The interesting cases are not the happy path — they are the ones that lose
 * an author's work quietly: a parameter the picker never sets, a slug shape
 * the tokenizer could split, and a marker that should not become a tag at all.
 */
describe('imagemap widget transform', () => {
    const marker = (attrs: string) => `<p>a</p><div data-widget="imagemap" ${attrs}></div><p>b</p>`;

 describe('htmlToDtmpl', () => {
 it('emits the slug POSITIONALLY, backtick-quoted', () => {
            const out = htmlToDtmpl(marker('data-slug="restaurant-floor" data-name="Restaurant floor"'));

 // Positional `_id`, not `slug=` — the renderer reads the second
 // `:` segment. A dashed slug must survive tokenizing, hence backticks.
            expect(out).toContain('{widget:imagemap:`restaurant-floor`}');
 // The human name is chip-only and must never reach storage.
            expect(out).not.toContain('Restaurant floor');
        });

 it('drops a marker with no slug rather than storing an unrenderable tag', () => {
            expect(htmlToDtmpl(marker('data-name="orphan"'))).toBe('<p>a</p><p>b</p>');
        });

 it('carries date, now and class through', () => {
            const out = htmlToDtmpl(marker('data-slug="floor" data-now="true" data-class="wide"'));

            expect(out).toContain('now=`true`');
            expect(out).toContain('class=`wide`');
        });

 it('leaves other widgets alone', () => {
            const other = '<div data-widget="document" data-slug="invoice"></div>';
            expect(htmlToDtmpl(other)).toBe(other);
        });
    });

 describe('dtmplToHtml', () => {
 it('rebuilds a marker the node can rehydrate', () => {
            const html = dtmplToHtml('{widget:imagemap:`floor-1`}');

            expect(html).toContain('data-widget="imagemap"');
            expect(html).toContain('data-slug="floor-1"');
        });

 it('accepts an unquoted slug', () => {
            expect(dtmplToHtml('{widget:imagemap:floor-1}')).toContain('data-slug="floor-1"');
        });

 it('escapes a slug so it cannot break out of the attribute', () => {
            const html = dtmplToHtml('{widget:imagemap:`a"b`}');

            expect(html).toContain('data-slug="a&quot;b"');
        });
    });

 describe('round trip', () => {
 it('preserves a plain tag', () => {
            const original = '{widget:imagemap:`floor-1`}';
            expect(htmlToDtmpl(dtmplToHtml(original))).toBe(original);
        });

 it('preserves parameters the PICKER never sets', () => {
 // The regression this exists for: an author hand-writes `now=true`,
 // opens the page in the editor and presses Save. A transform that
 // knew only the slug would delete the flag and the page would
 // silently stop showing live status.
            const original = '{widget:imagemap:`floor-1` date=`2026-07-20` now=`true` class=`wide`}';
            const back = htmlToDtmpl(dtmplToHtml(original));

            expect(back).toContain('date=`2026-07-20`');
            expect(back).toContain('now=`true`');
            expect(back).toContain('class=`wide`');
        });

 it('survives text around it untouched', () => {
            const original = 'before {widget:imagemap:`m`} after';
            expect(htmlToDtmpl(dtmplToHtml(original))).toBe(original);
        });
    });
});
