import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type PaneToolbarAction } from '@coolms/ui-angular';
import { MailBulkBarComponent } from './mail-bulk-bar.component';

@Component({
    standalone: true,
    imports: [MailBulkBarComponent],
    template: `
        <div [style.width.px]="width()">
            <app-mail-bulk-bar [count]="count()" [actions]="actions" (action)="seen.push('action:' + $event)"
                               (selectAll)="seen.push('all')" (clear)="seen.push('clear')" />
        </div>
    `,
})
class HostComponent {
    readonly width = signal(339);
    readonly count = signal(2);
    readonly actions: PaneToolbarAction[] = [
        { id: 'archive', label: 'Archive', icon: 'archive', group: 'remove', overflow: 2 },
        { id: 'delete', label: 'Delete', icon: 'trash', group: 'remove', overflow: 3 },
        { id: 'star', label: 'Star', icon: 'star', group: 'mark', overflow: 1 },
    ];
    readonly seen: string[] = [];
}

/**
 * The checked-rows bar: how many are checked is the pane toolbar's own status slot, Select all and Clear are two named
 * icon buttons after the toolbar, and the toolbar takes the rest of the row. Rendered.
 */
describe('MailBulkBarComponent', () => {
    let f: ComponentFixture<HostComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] });
        f = TestBed.createComponent(HostComponent);
        document.body.appendChild(f.nativeElement);
        f.detectChanges();
    });
    afterEach(() => (f.nativeElement as HTMLElement).remove());

    const root = () => f.nativeElement as HTMLElement;
    const bar = () => root().querySelector<HTMLElement>('.mbx__bulkbar')!;

    it('puts the count in the toolbar status slot, and nowhere else', () => {
        const status = root().querySelector<HTMLElement>('cms-pane-toolbar .cms-pane-toolbar__status');
        expect(status?.textContent?.trim()).toBe('2 selected');
        expect(status?.title).toBe('2 selected');
        const outside = Array.from(bar().children).filter(c => c.tagName !== 'CMS-PANE-TOOLBAR');
        expect(outside.some(c => (c.textContent ?? '').includes('selected'))).toBeFalse();
        f.componentInstance.count.set(5);
        f.detectChanges();
        expect(root().querySelector('cms-pane-toolbar .cms-pane-toolbar__status')?.textContent?.trim()).toBe('5 selected');
    });

    it('draws the toolbar, then Select all and Clear as icon buttons with names and tooltips', () => {
        const kids = Array.from(bar().children) as HTMLElement[];
        expect(kids.map(k => k.tagName === 'CMS-PANE-TOOLBAR' ? 'toolbar' : k.dataset['test'])).toEqual(['toolbar', 'bulk-select-all', 'bulk-clear']);
        const [, all, clear] = kids;
        expect(all.getAttribute('aria-label')).toBe('Select all loaded messages');
        expect(all.title).toBe('Select all loaded messages');
        expect(all.querySelector('.bi-check-all')).not.toBeNull();
        expect(all.textContent?.trim()).toBe('');
        expect(clear.getAttribute('aria-label')).toBe('Clear selection');
        expect(clear.title).toBe('Clear selection');
        expect(clear.querySelector('.bi-x-lg')).not.toBeNull();
    });

    it('gives the toolbar every pixel the two buttons leave', () => {
        const kids = Array.from(bar().children) as HTMLElement[];
        const style = getComputedStyle(bar());
        const inner = bar().clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap);
        const buttons = kids.slice(1).reduce((sum, k) => sum + k.getBoundingClientRect().width, 0);
        expect(kids[0].getBoundingClientRect().width).toBeCloseTo(inner - buttons - 2 * gap, 0);
    });

    it('passes on the action chosen, Select all and Clear', () => {
        root().querySelector<HTMLButtonElement>('cms-pane-toolbar [data-action="archive"]')!.click();
        root().querySelector<HTMLButtonElement>('[data-test="bulk-select-all"]')!.click();
        root().querySelector<HTMLButtonElement>('[data-test="bulk-clear"]')!.click();
        expect(f.componentInstance.seen).toEqual(['action:archive', 'all', 'clear']);
    });
});
