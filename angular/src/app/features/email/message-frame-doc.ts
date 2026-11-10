/**
 * What a message's frame page holds: the admin's own mail-frame page, served with the contract's policy, into
 * which the page writes the server-sanitised HTML and these styles. The frame never runs a script, and never scrolls:
 * it is as tall as its document (MessageFrameFit).
 *
 * Long words and URLs still wrap (`overflow-wrap: break-word`), but nothing makes every character a break opportunity
 * when a table works out its column widths. `overflow-wrap: anywhere` and `word-break: break-word` both do: a
 * notification's narrow "Status" column then shrank to one letter per line.
 */
export const MESSAGE_FRAME_STYLE =
    'html,body{margin:0;padding:8px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
    + 'font-size:14px;line-height:1.5;color:#1f2937;overflow-wrap:break-word;}'
    + 'img{max-width:100%;height:auto;}a{color:#2563eb;}';

/** The id of the style element the page writes into the frame page, once. */
export const MESSAGE_FRAME_STYLE_ID = 'cms-mail-frame-style';

/**
 * Writes a message into its loaded frame page: the frame's styles into its head (once), and the server-sanitised HTML,
 * its links set to open apart (linksOpenApart), into its body. No script in it runs: the frame has no allow-scripts,
 * the page's policy has script-src 'none', and HTML set this way never runs its scripts.
 */
export function writeMessage(doc: Document, html: string): void {
    if (doc.getElementById(MESSAGE_FRAME_STYLE_ID) === null) {
        const style = doc.createElement('style');
        style.id = MESSAGE_FRAME_STYLE_ID;
        style.textContent = MESSAGE_FRAME_STYLE;
        (doc.head ?? doc.documentElement).appendChild(style);
    }
    doc.body.innerHTML = linksOpenApart(html);
}

/**
 * Every link of the body -- `a[href]` and `area[href]` -- opens apart from the page: `rel="noopener noreferrer"` and
 * `target="_blank"`, whatever the mail carried. Defence in depth over the server's sanitiser (which forces `rel` on
 * both) and under the page's own click handling (MessageFrameFit). Parsed in an inert document (DOMParser: no script
 * runs, nothing loads); a body with no link is returned byte-identical.
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
