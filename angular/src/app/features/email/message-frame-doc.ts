/**
 * The document a message body is drawn in: the server-sanitised HTML in a minimal page whose CSP blocks every remote
 * fetch until the reader loads images. The iframe that shows it is sandboxed to `allow-same-origin` alone (so the page
 * can measure it from outside; no scripts, no popups, no forms), so this is defence in depth over the server
 * sanitiser, and styles cross in neither direction. It never scrolls: the frame is as tall as it (MessageFrameFit).
 *
 * Long words and URLs still wrap (`overflow-wrap: break-word`), but nothing makes every character a break opportunity
 * when a table works out its column widths. `overflow-wrap: anywhere` and `word-break: break-word` both do: a
 * notification's narrow "Status" column then shrank to one letter per line.
 */
export const MESSAGE_FRAME_STYLE =
    'html,body{margin:0;padding:8px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
    + 'font-size:14px;line-height:1.5;color:#1f2937;overflow-wrap:break-word;}'
    + 'img{max-width:100%;height:auto;}a{color:#2563eb;}';

export function messageFrameDoc(html: string, loadRemoteImages: boolean): string {
    // No remote by default: data: images (inlined cid:) and inline styles only.
    // "Load images" widens img-src to http(s); scripts/objects/frames stay blocked.
    const imgSrc = loadRemoteImages ? 'data: https: http:' : 'data:';
    const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`;
    return '<!doctype html><html><head><meta charset="utf-8">'
        + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        + '<base target="_blank">'
        + `<style>${MESSAGE_FRAME_STYLE}</style>`
        + `</head><body>${linksOpenApart(html)}</body></html>`;
}

/**
 * Every link of the body -- `a[href]` and `area[href]` -- opens apart from the page: `rel="noopener noreferrer"` and
 * `target="_blank"`, whatever the mail carried. Defence in depth under the page's own click handling
 * (MessageFrameFit), for the server's sanitiser forces `rel` on `<a>` and not on `<area>`. Parsed in an inert
 * document (DOMParser: no script runs, nothing loads); a body with no link is returned byte-identical.
 */
export function linksOpenApart(html: string): string {
    if (!/<(a|area)[\s>]/i.test(html) || typeof DOMParser === 'undefined') {
        return html;
    }
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
    const links = doc.body.querySelectorAll('a[href], area[href]');
    if (links.length === 0) {
        return html;
    }
    links.forEach(link => {
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('target', '_blank');
    });

    return doc.body.innerHTML;
}
