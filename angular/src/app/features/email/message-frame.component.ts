import { ChangeDetectionStrategy, Component, DestroyRef, inject, input } from '@angular/core';
import { type SafeHtml } from '@angular/platform-browser';
import { MessageFrameFit } from './message-frame-fit';

/**
 * The frame a message body is drawn in. Its sandbox is `allow-same-origin` and nothing else: no scripts, no popups,
 * no forms, no navigation of the page. It is as tall as its document and never scrolls itself; its links open through
 * the page (MessageFrameFit).
 */
@Component({
    selector: 'app-message-frame',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <iframe #frame class="mbx__body-frame" [srcdoc]="doc()" sandbox="allow-same-origin"
                referrerpolicy="no-referrer" title="Message body" (load)="fit.follow(frame)"></iframe>
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
    /** The message's frame document (messageFrameDoc), trusted by the page. */
    readonly doc = input.required<SafeHtml | string | null>();
    readonly fit = new MessageFrameFit();

    constructor() {
        inject(DestroyRef).onDestroy(() => this.fit.stop());
    }
}
