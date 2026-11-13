import { Directive, ElementRef, afterEveryRender, inject, input } from '@angular/core';

/**
 * Names the text field inside a composite field (an address chip field) by the label element whose id it is given:
 * the field's own input gets `aria-labelledby`. A wrapping label cannot do it there, since the chips' Remove buttons
 * come first and a label names the first control it holds.
 */
@Directive({
    selector: '[appInnerLabel]',
    standalone: true,
})
export class InnerLabelDirective {
    /** The id of the element whose text names the field. */
    readonly appInnerLabel = input.required<string>();
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    constructor() {
        afterEveryRender(() => {
            const field = this.host.nativeElement.querySelector('input');
            if (field !== null && field.getAttribute('aria-labelledby') !== this.appInnerLabel()) {
                field.setAttribute('aria-labelledby', this.appInnerLabel());
            }
        });
    }
}
