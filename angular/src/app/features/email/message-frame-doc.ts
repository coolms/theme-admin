/**
 * The document a message body is drawn in: the server-sanitised HTML in a minimal page whose CSP blocks every remote
 * fetch until the reader loads images. The iframe that shows it is `sandbox`ed (no scripts, no same-origin), so this
 * is defence in depth over the server sanitiser, and styles cross in neither direction.
 *
 * Long words and URLs still wrap (`overflow-wrap: break-word`), but nothing makes every character a break opportunity
 * when a table works out its column widths. `overflow-wrap: anywhere` and `word-break: break-word` both do: a
 * notification's narrow "Status" column then shrank to one letter per line.
 */
export const MESSAGE_FRAME_STYLE =
    'html,body{margin:0;padding:8px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
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
        + `</head><body>${html}</body></html>`;
}
