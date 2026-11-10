import { linksOpenApart, writeMessage } from './message-frame-doc';

/** An empty page like the admin's mail-frame page, in a frame of this width, with the message written into it. */
function drawn(html: string, width: number, into: (frame: HTMLIFrameElement) => void): Promise<Document> {
    const frame = document.createElement('iframe');
    frame.style.width = `${width}px`;
    frame.style.height = '600px';
    document.body.appendChild(frame);
    into(frame);
    return new Promise(resolve => {
        frame.onload = () => {
            const doc = frame.contentDocument as Document;
            writeMessage(doc, html);
            resolve(doc);
        };
        frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body></body></html>';
    });
}

/**
 * The message frame's own styles must not let a table's narrow column collapse. Measured in the browser the suite runs in: the
 * document is drawn in a real iframe at a reading-pane width, and the header's height is compared with one line.
 */
describe('the message frame styles', () => {
    const NOTIFICATION =
        '<table width="100%" style="border-collapse:collapse"><thead><tr>'
        + '<th align="left">Job</th><th align="left">Annotations</th><th id="status" align="left">Status</th>'
        + '<th align="left">Duration</th></tr></thead><tbody><tr>'
        + '<td>build-and-test-the-release-tools-against-every-supported-runtime</td>'
        + '<td>The job was not started because recent account payments have failed or your spending limit needs to be '
        + 'increased.</td><td>failure</td><td>2s</td></tr></tbody></table>';

    let frame: HTMLIFrameElement;

    afterEach(() => frame?.remove());

    const draw = (html: string, width: number): Promise<Document> => drawn(html, width, f => { frame = f; });

    for (const width of [520, 380]) {
        it(`keeps a narrow column's header on one line at ${width}px`, async () => {
            const doc = await draw(NOTIFICATION, width);
            const th = doc.getElementById('status') as HTMLElement;
            const lineHeight = parseFloat(doc.defaultView!.getComputedStyle(th).lineHeight);
            expect(th.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
        });
    }

    it('still wraps a long unbroken word instead of widening the page', async () => {
        const doc = await draw('<p>' + 'x'.repeat(400) + '</p>', 380);
        expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(380);
    });

    it('writes its styles once, and the message into the body', async () => {
        const doc = await draw('<p id="one">one</p>', 380);
        writeMessage(doc, '<p id="two">two</p>');
        expect(doc.querySelectorAll('#cms-mail-frame-style').length).toBe(1);
        expect(doc.getElementById('one')).toBeNull();
        expect(doc.getElementById('two')?.textContent).toBe('two');
    });
});

/** Every link of a mail opens apart from the page, whatever it carried; a body with no link is left as it came. */
describe('linksOpenApart', () => {
    const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

    it('gives <a rel="opener"> and <area target="_self"> rel="noopener noreferrer" and target="_blank"', () => {
        const out = parse(linksOpenApart(
            '<p><a id="a" href="https://example.com/" rel="opener" target="_top">a</a></p>'
            + '<img usemap="#m" src="data:,"><map name="m"><area id="area" href="https://example.com/area" target="_self"></map>',
        ));
        for (const id of ['a', 'area']) {
            expect(out.getElementById(id)!.getAttribute('rel')).withContext(id).toBe('noopener noreferrer');
            expect(out.getElementById(id)!.getAttribute('target')).withContext(id).toBe('_blank');
        }
    });

    it('leaves an anchor with no href untouched', () => {
        const out = parse(linksOpenApart('<p><a name="top" id="n">top</a> <a id="l" href="https://example.com/">l</a></p>'));
        expect(out.getElementById('n')!.hasAttribute('rel')).toBeFalse();
        expect(out.getElementById('n')!.hasAttribute('target')).toBeFalse();
        expect(out.getElementById('l')!.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('returns a body with no link byte-identical, and one with only an anchor name too', () => {
        const plain = '<p>Hi <b>there</b>,</p><table><tr><td>x</td></tr></table>';
        expect(linksOpenApart(plain)).toBe(plain);
        const named = '<p><a name="top">top</a></p>';
        expect(linksOpenApart(named)).toBe(named);
    });

    it('is applied as the message is written into its frame page', () => {
        const doc = parse('<!doctype html><html><head></head><body></body></html>');
        writeMessage(doc, '<a id="x" href="https://example.com/" rel="opener">x</a>');
        expect(doc.getElementById('x')!.getAttribute('rel')).toBe('noopener noreferrer');
    });
});
