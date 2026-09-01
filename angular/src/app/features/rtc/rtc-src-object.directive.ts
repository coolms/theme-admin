import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Binds a `MediaStream` to a media element's `srcObject`, Slice 4d).
 * `srcObject` is a live object property, not a reflected attribute, so there is
 * no native template binding for it — this directive sets it reactively from a
 * signal input, letting the overlay declare `<video [rtcSrcObject]="stream()">`.
 */
@Directive({
    selector: 'video[rtcSrcObject],audio[rtcSrcObject]',
    standalone: true,
})
export class RtcSrcObjectDirective {
    private readonly el = inject<ElementRef<HTMLMediaElement>>(ElementRef);
    readonly rtcSrcObject = input<MediaStream | null>(null);

    constructor() {
        effect(() => {
            const stream = this.rtcSrcObject();
            const media = this.el.nativeElement;
            if (media.srcObject !== stream) {
                media.srcObject = stream;
            }
        });
    }
}
