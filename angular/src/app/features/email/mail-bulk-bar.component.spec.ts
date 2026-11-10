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
 * The checked-rows bar: Clear leads and carries the count ("x 2 selected", "x 2" once every label of the toolbar is
 * hidden), the toolbar takes the rest of the row, Select all is an icon button after it. Rendered.
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
    const clear = () => root().querySelector<HTMLButtonElement>('[data-test="bulk-clear"]')!;
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    async function settle(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            f.detectChanges();
            await frame();
        }
        await f.whenStable();
        f.detectChanges();
    }
    async function at(width: number): Promise<void> {
        f.componentInstance.width.set(width);
        await settle();
    }
    const said = () => (clear().textContent ?? '').replace(/\s+/g, ' ').trim();

    it('leads with Clear, which carries the count, cross first; the toolbar has no status', async () => {
        await at(1000);
        const kids = Array.from(bar().children) as HTMLElement[];
        expect(kids.map(k => k.tagName === 'CMS-PANE-TOOLBAR' ? 'toolbar' : k.dataset['test'])).toEqual(['bulk-clear', 'toolbar', 'bulk-select-all']);
        expect(clear().firstElementChild?.classList).toContain('bi-x-lg');
        expect(said()).toBe('2 selected');
        expect(clear().getAttribute('aria-label')).toBe('Clear selection (2 selected)');
        expect(clear().title).toBe('Clear selection (2 selected)');
        expect(root().querySelector('cms-pane-toolbar .cms-pane-toolbar__status')).toBeNull();
        f.componentInstance.count.set(5);
        f.detectChanges();
        expect(clear().getAttribute('aria-label')).toBe('Clear selection (5 selected)');
    });

    it('reads "x 2" once the toolbar has hidden every label, its name unchanged, and takes its word back when all show', async () => {
        await at(150);
        expect(root().querySelector('cms-pane-toolbar .cms-pane-toolbar')!.classList).toContain('cms-pane-toolbar--labels-hidden');
        expect(said()).toBe('2');
        expect(clear().getAttribute('aria-label')).toBe('Clear selection (2 selected)');

        await at(1000);
        expect(root().querySelector('cms-pane-toolbar .cms-pane-toolbar')!.classList).not.toContain('cms-pane-toolbar--labels-hidden');
        expect(said()).toBe('2 selected');
    });

    it('has Select all as an icon button with its name and tooltip, and no other Clear', async () => {
        await at(339);
        const all = root().querySelector<HTMLButtonElement>('[data-test="bulk-select-all"]')!;
        expect(all.getAttribute('aria-label')).toBe('Select all loaded messages');
        expect(all.title).toBe('Select all loaded messages');
        expect(all.querySelector('.bi-check-all')).not.toBeNull();
        expect(root().querySelectorAll('.bi-x-lg').length).toBe(1);
    });

    it('gives the toolbar every pixel the two buttons leave', async () => {
        await at(339);
        const kids = Array.from(bar().children) as HTMLElement[];
        const style = getComputedStyle(bar());
        const inner = bar().clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap);
        const buttons = kids[0].getBoundingClientRect().width + kids[2].getBoundingClientRect().width;
        expect(kids[1].getBoundingClientRect().width).toBeCloseTo(inner - buttons - 2 * gap, 0);
    });

    it('passes on the action chosen, Select all and Clear', async () => {
        await at(1000);
        root().querySelector<HTMLButtonElement>('cms-pane-toolbar [data-action="archive"]')!.click();
        root().querySelector<HTMLButtonElement>('[data-test="bulk-select-all"]')!.click();
        clear().click();
        expect(f.componentInstance.seen).toEqual(['action:archive', 'all', 'clear']);
    });
});
