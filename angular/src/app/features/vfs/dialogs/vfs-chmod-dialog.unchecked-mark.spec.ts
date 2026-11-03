import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';

import { VfsChmodDialogComponent } from './vfs-chmod-dialog.component';

/**
 * The admin's checkbox (`.cms-checkbox`, styles.scss) draws its tick only when checked: the icon is in the markup
 * either way, and an unchecked box drawing it in the text colour read as checked -- in the permissions dialog, Write
 * for Group, Setgid, Sticky and Apply recursively all looked ticked while off. Measured as the browser draws them.
 */
describe('an unchecked box shows no mark', () => {
    function box(checked: boolean): HTMLElement {
        const span = document.createElement('span');
        span.className = checked ? 'cms-checkbox cms-checkbox--checked' : 'cms-checkbox';
        span.innerHTML = '<i class="bi bi-check"></i>';
        document.body.appendChild(span);
        return span;
    }

    function markShown(span: Element): boolean {
        const mark = span.querySelector('.bi');
        return mark !== null && getComputedStyle(mark).visibility === 'visible';
    }

    it('the box draws its tick only when checked, and keeps its size either way', () => {
        const on = box(true);
        const off = box(false);
        try {
            expect(markShown(on)).withContext('the subject: a checked box shows its tick').toBeTrue();
            expect(markShown(off)).withContext('an unchecked box').toBeFalse();
            expect(off.getBoundingClientRect().width).toBe(on.getBoundingClientRect().width);
            expect(off.getBoundingClientRect().height).toBe(on.getBoundingClientRect().height);
        } finally {
            on.remove();
            off.remove();
        }
    });

    it('in the permissions dialog, each box shows a mark exactly when it is on', () => {
        TestBed.configureTestingModule({
            providers: [
                { provide: DialogRef, useValue: { close: () => undefined } },
                // 0754: Owner rwx, Group r-x, Other r--; no setgid, no sticky; recursive off.
                { provide: DIALOG_DATA, useValue: { nodeName: 'docs', initialMode: '0754', isDirectory: true } },
            ],
        });
        const fixture = TestBed.createComponent(VfsChmodDialogComponent);
        fixture.detectChanges();
        const boxes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.cms-checkbox'));
        document.body.appendChild(fixture.nativeElement);
        try {
            expect(boxes.length).withContext('the subject: the dialog draws its boxes').toBeGreaterThan(10);
            const drawn = boxes.map(b => markShown(b));
            const on = boxes.map(b => b.classList.contains('cms-checkbox--checked'));
            expect(on.filter(Boolean).length).withContext('some boxes are on, some off').toBeGreaterThan(0);
            expect(on.filter(x => !x).length).toBeGreaterThan(0);
            expect(drawn).toEqual(on);
        } finally {
            (fixture.nativeElement as HTMLElement).remove();
        }
    });
});
