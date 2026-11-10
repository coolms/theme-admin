/**
 * The message frame grows to its document's height and never scrolls itself, so the message pane keeps one scroll
 * region (contract `pane-toolbar`, mail "message pane scroll", form (a)).
 *
 * The frame's sandbox is `allow-same-origin` alone: no script ever runs inside it, it opens no window and navigates
 * nothing, and the host reads its document from outside. The height is read when the frame loads (after its images),
 * again as its document resizes (a ResizeObserver on its root element, whose width is the frame's, so a narrower
 * frame that rewraps the text taller is followed too).
 *
 * Links: the frame may open nothing itself, so the host listens for clicks on its links, keeps the frame from
 * following them, and opens an http(s) or mailto address in a new tab with no opener and no referrer. Any other
 * scheme (javascript:, data:, file:, ...) does nothing.
 */
export class MessageFrameFit {
    private watch: ResizeObserver | null = null;
    private unlisten: (() => void) | null = null;

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
            if (height > 0 && frame.style.height !== `${height}px`) {
                frame.style.height = `${height}px`;
            }
        };
        fit();
        if (typeof ResizeObserver !== 'undefined') {
            // The document's root follows the frame's width too (a narrower frame rewraps it taller), so it is the
            // one element observed. Fitting changes the frame's height, never the root's size, so a fit inside the
            // observer's delivery asks for no second one.
            this.watch = new ResizeObserver(fit);
            this.watch.observe(doc.documentElement);
        }
        for (const img of Array.from(doc.images)) {
            if (!img.complete) {
                img.addEventListener('load', fit, { once: true });
            }
        }
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
        this.unlisten = () => doc.removeEventListener('click', onClick);
    }

    stop(): void {
        this.watch?.disconnect();
        this.watch = null;
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
