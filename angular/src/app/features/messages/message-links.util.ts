import { plainTextRuns, type TextRun } from '@coolms/editor-client/plain-text';

/** Text in these is left as it is: a link is one already, and code says what it says. */
const LEFT_ALONE = 'a, code, pre';

/** What a text must hold for a web or mail address to be in it. */
const MAY_HOLD = /:\/\/|www\.|@|&(?:#0*64|#x0*40|commat);/i;

/**
 * A message's stored HTML with the web and mail addresses in its text made links, opened in a new tab. The text between
 * tags is all it reads: nothing of it is read as HTML, and a link's target is only ever http:, https: or mailto:.
 * Angular sanitises the result at the binding.
 */
export function linkifyMessageHtml(html: string): string {
    if (!MAY_HOLD.test(html)) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.parentElement?.closest(LEFT_ALONE) ?? null) === null) texts.push(node as Text);
    }
    let linked = false;
    for (const text of texts) {
        const runs = plainTextRuns(text.data);
        if (!runs.some(run => run.href !== undefined)) continue;
        linked = true;
        text.replaceWith(...runs.map(run => {
            if (run.href === undefined) return doc.createTextNode(run.text);
            const link = doc.createElement('a');
            link.href = run.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = run.text;
            return link;
        }));
    }
    return linked ? doc.body.innerHTML : html;
}

/** A reading kept per body: a message is drawn again on every change. The map is dropped before it grows without end. */
function remembered<T>(read: (body: string) => T): (body: string | null) => T {
    const known = new Map<string, T>();
    return said => {
        const body = said ?? '';
        const before = known.get(body);
        if (before !== undefined) return before;
        const now = read(body);
        if (known.size >= 500) known.clear();
        known.set(body, now);
        return now;
    };
}

/** An HTML body with its addresses made links. */
export const linkedMessageHtml: (html: string | null) => string = remembered(linkifyMessageHtml);

/** A plain body as its words and links. */
export const messageRuns: (body: string | null) => readonly TextRun[] = remembered(plainTextRuns);
