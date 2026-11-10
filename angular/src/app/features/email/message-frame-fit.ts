/**
 * The message frame grows to its document's height and never scrolls itself, so the message pane keeps one scroll
 * region (contract `pane-toolbar`, mail "message pane scroll", form (a)).
 *
 * The frame's sandbox never has allow-scripts: no script ever runs inside it, and the host reads its
 * document from outside. The height is read when the frame loads, again as the frame's width changes (a ResizeObserver
 * on the frame: a narrower frame rewraps its text taller), as its document changes (a MutationObserver on it) and as
 * an image in it loads or fails -- each time on the next animation
 * frame, and written only when it moves by a whole pixel. The document itself is not given to a ResizeObserver: the
 * page's observer watching an element of another document is reported as a resize loop by the browser, whatever the
 * callback does.
 *
 * Links: the frame may open nothing itself, so the host listens for clicks on its links, keeps the frame from
 * following them, and opens an http(s) or mailto address in a new tab with no opener and no referrer. Any other
 * scheme (javascript:, data:, file:, ...) does nothing.
 */
export class MessageFrameFit {
    private watch: ResizeObserver | null = null;
    private mutations: MutationObserver | null = null;
    private unlisten: (() => void) | null = null;
    private cancel: (() => void) | null = null;

    constructor(private readonly open: (url: string) => void = url => { window.open(url, '_blank', 'noopener,noreferrer'); }) {}

    /** Fits this frame now and follows it; a frame fitted before is let go. */
    follow(frame: HTMLIFrameElement): void {
        this.stop();
        const doc = frame.contentDocument;
        if (doc === null || doc.documentElement === null) {
            return;
        }
        const fit = (): void => {
            // A fit scheduled for a document the frame no longer shows does nothing.
            if (frame.contentDocument !== doc) {
                return;
            }
            // The frame's own border (and padding), whatever its box-sizing: its content box must hold the document.
            const height = frameContentHeight(doc) + (frame.offsetHeight - frame.clientHeight);
            // Written only when it moves by a whole pixel, so the observer settles instead of chasing subpixels.
            if (height > 0 && Math.abs(height - frame.getBoundingClientRect().height) >= 1) {
                frame.style.height = `${height}px`;
            }
        };
        // Observed sizes are written on the next frame, never inside the observer's own delivery: a height written
        // there can resize what is observed in the same delivery, which the browser reports as a loop.
        let pending = 0;
        const later = (): void => {
            if (pending === 0) {
                pending = requestAnimationFrame(() => {
                    pending = 0;
                    fit();
                });
            }
        };
        this.cancel = () => {
            if (pending !== 0) {
                cancelAnimationFrame(pending);
                pending = 0;
            }
        };
        fit();
        if (typeof ResizeObserver !== 'undefined') {
            this.watch = new ResizeObserver(later);
            this.watch.observe(frame);
        }
        if (typeof MutationObserver !== 'undefined') {
            this.mutations = new MutationObserver(later);
            this.mutations.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        }
        // An image loading or failing, now or added later: neither event bubbles, so both are caught on their way
        // down. A failed image changes the height too (its box falls back to its alt text or nothing), and missing it
        // would clip the end of the message.
        doc.addEventListener('load', later, true);
        doc.addEventListener('error', later, true);
        const onClick = (event: MouseEvent): void => {
            const link = linkOf(event.target);
            if (link === null) {
                return;
            }
            event.preventDefault();
            const url = openableUrl(link.href);
            if (url !== null) {
                this.open(url);
            }
        };
        doc.addEventListener('click', onClick);
        this.unlisten = () => {
            doc.removeEventListener('click', onClick);
            doc.removeEventListener('load', later, true);
            doc.removeEventListener('error', later, true);
        };
    }

    stop(): void {
        this.cancel?.();
        this.cancel = null;
        this.watch?.disconnect();
        this.watch = null;
        this.mutations?.disconnect();
        this.mutations = null;
        this.unlisten?.();
        this.unlisten = null;
    }
}

/** The link a click landed in, read without the frame's own constructors (its realm is not the page's). */
function linkOf(target: EventTarget | null): { href: string } | null {
    const node = target as { closest?: (selector: string) => unknown } | null;
    if (node === null || typeof node.closest !== 'function') {
        return null;
    }
    const link = node.closest('a[href], area[href]') as { href?: unknown } | null;

    return link !== null && typeof link.href === 'string' ? { href: link.href } : null;
}

/** The address a message link may open: http(s) and mailto only, as written; anything else is null. */
export function openableUrl(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }

    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
}

/**
 * The height the frame's document takes: its root element's own box, which an auto height sizes to the content and
 * never to the frame (`scrollHeight` would never come down below the frame's current height). Whole pixels, up.
 */
export function frameContentHeight(doc: Document): number {
    return Math.ceil(doc.documentElement.getBoundingClientRect().height);
}
