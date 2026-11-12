import {
    ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked,
} from '@angular/core';
import { writeMessage } from './message-frame-doc';
import { MessageFrameFit } from './message-frame-fit';

/** The admin's mail frame page, served with the contract's policy; images from this origin and data: only. */
export const MAIL_FRAME_PAGE = '/admin/mail-frame.html';
/** The same page once the person chose Load images for the message: remote https images too. */
export const MAIL_FRAME_IMAGES_PAGE = '/admin/mail-frame-images.html';

/**
 * The frame a message body is drawn in. Its document is the admin's own mail frame page, never srcdoc, so
 * it carries that page's policy and not the admin's. Its sandbox is exactly allow-same-origin allow-popups
 * allow-popups-to-escape-sandbox: never allow-scripts, so no script runs in it. Once the page has loaded, the
 * server-sanitised HTML is written into its body (writeMessage); the frame is as tall as its document and never
 * scrolls itself, and its links open through the page (MessageFrameFit).
 */
@Component({
    selector: 'app-message-frame',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (images()) {
            <iframe #frame class="mbx__body-frame" src="/admin/mail-frame-images.html"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    referrerpolicy="no-referrer" [title]="label()" (load)="loaded(frame)"></iframe>
        } @else {
            <iframe #frame class="mbx__body-frame" src="/admin/mail-frame.html"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    referrerpolicy="no-referrer" [title]="label()" (load)="loaded(frame)"></iframe>
        }
    `,
    styles: [`
        :host { display: block; }
        /* As tall as its document, so it never scrolls itself. */
        .mbx__body-frame {
            display: block; width: 100%; height: 0; overflow: hidden;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px); background: #fff;
        }
    `],
})
export class MessageFrameComponent {
    /** The message's server-sanitised HTML. */
    readonly html = input.required<string | null | undefined>();
    /** The person chose Load images for this message: the page that allows remote images. */
    readonly images = input(false);
    /** The frame's accessible name. */
    readonly label = input('Message body');
    readonly fit = new MessageFrameFit();

    /** The frame whose page has loaded, ready to be written into. */
    private readonly ready = signal<HTMLIFrameElement | null>(null);

    constructor() {
        inject(DestroyRef).onDestroy(() => this.fit.stop());
        // Another message in the same page: written again, and the document's change refits it.
        effect(() => {
            const html = this.html() ?? '';
            const frame = this.ready();
            if (frame !== null) {
                untracked(() => this.write(frame, html));
            }
        });
    }

    /** The page has loaded (again, after Load images switched it): the message goes in, then the fit follows it. */
    protected loaded(frame: HTMLIFrameElement): void {
        this.write(frame, this.html() ?? '');
        this.fit.follow(frame);
        this.ready.set(frame);
    }

    private write(frame: HTMLIFrameElement, html: string): void {
        const doc = frame.contentDocument;
        if (doc !== null && doc.body !== null) {
            writeMessage(doc, html);
        }
    }
}
