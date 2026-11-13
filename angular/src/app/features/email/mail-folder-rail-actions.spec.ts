import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';

import type { FolderRow } from './folder-tree.util';
import { NO_FLAGS } from './mail-folder-actions';
import { type FolderMenuAsk, LONG_PRESS_MS, MailFolderRailComponent } from './mail-folder-rail.component';

function row(folder: string, name: string, over: Partial<FolderRow> = {}): FolderRow {
    return { folder: { folder, total: 3, unseen: 0 }, name, depth: 0, selectable: true, flags: NO_FLAGS, ...over };
}

const ROWS: FolderRow[] = [
    row('INBOX', 'Inbox', { flags: { ...NO_FLAGS, canMarkRead: true } }),
    row('Projects', 'Projects', { flags: { ...NO_FLAGS, busy: 'mark-read' } }),
    row('Holder', 'Holder', { selectable: false, flags: { ...NO_FLAGS, canCreateChild: true } }),
];

/** The rail's part in folder actions: a row's menu by mouse, key and long press; a busy row; New folder at the foot. */
describe('MailFolderRailComponent -- folder actions', () => {
    let fixture: ComponentFixture<MailFolderRailComponent>;
    let asks: FolderMenuAsk[];
    let chosen: string[];
    let created: number;

    function render(rows: readonly FolderRow[] = ROWS, newFolderLabel: string | null = null): HTMLElement {
        TestBed.configureTestingModule({ imports: [MailFolderRailComponent] });
        fixture = TestBed.createComponent(MailFolderRailComponent);
        fixture.componentRef.setInput('rows', rows);
        fixture.componentRef.setInput('selected', 'INBOX');
        fixture.componentRef.setInput('answered', true);
        fixture.componentRef.setInput('newFolderLabel', newFolderLabel);
        asks = [];
        chosen = [];
        created = 0;
        fixture.componentInstance.menu.subscribe(a => asks.push(a));
        fixture.componentInstance.chosen.subscribe(f => chosen.push(f));
        fixture.componentInstance.create.subscribe(() => { created += 1; });
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    const rowEl = (el: HTMLElement, folder: string): HTMLElement => {
        const found = el.querySelector<HTMLElement>(`.mbx__folders [data-folder="${folder}"]`);
        if (found === null) {
            throw new Error(`no row for ${folder}`);
        }
        return found;
    };
    const pointer = (type: string, x: number, y: number): PointerEvent =>
        new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: y, bubbles: true });

    it('a busy row shows a spinner and says which action runs, as its description, not its name', () => {
        const el = render();
        const busy = rowEl(el, 'Projects');

        expect(busy.querySelector('[data-test="folder-busy"]')).not.toBeNull();
        expect(busy.getAttribute('aria-busy')).toBe('true');
        const described = busy.getAttribute('aria-describedby');
        expect(described).not.toBeNull();
        expect(el.querySelector(`#${described ?? 'none'}`)?.textContent?.trim()).toBe('Mark all as read is running in this folder.');
        expect(busy.title).toContain('Mark all as read is running in this folder.');
        expect(busy.querySelector('[data-test="folder-name"]')?.textContent?.trim()).toBe('Projects');
        expect(busy.textContent).withContext('the row\'s name stays the folder\'s alone').not.toContain('is running');

        const idle = rowEl(el, 'INBOX');
        expect(idle.querySelector('[data-test="folder-busy"]')).toBeNull();
        expect(idle.getAttribute('aria-busy')).toBeNull();
    });

    it('a right-click asks for the row\'s menu where it was', () => {
        const el = render();
        const evt = new MouseEvent('contextmenu', { clientX: 40, clientY: 50, bubbles: true, cancelable: true });
        rowEl(el, 'INBOX').dispatchEvent(evt);

        expect(asks.length).toBe(1);
        expect(asks[0].folder).toBe('INBOX');
        expect(asks[0].opener).toBeNull();
        expect(asks[0].event.clientX).toBe(40);
    });

    it('Shift+F10 and the Menu key on a focused row ask for its menu under it, the row its opener', () => {
        const el = render();
        const inbox = rowEl(el, 'INBOX');
        const f10 = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
        inbox.dispatchEvent(f10);
        rowEl(el, 'Holder').dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
        inbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true }));

        expect(asks.map(a => a.folder)).toEqual(['INBOX', 'Holder']);
        expect(asks[0].opener).toBe(inbox);
        expect(f10.defaultPrevented).toBeTrue();
        expect(rowEl(el, 'Holder').getAttribute('tabindex')).withContext('a holder with actions is focusable').toBe('0');
    });

    it('a touch held about 500 ms asks for the menu, and the click that ends it selects nothing', fakeAsync(() => {
        const el = render();
        const inbox = rowEl(el, 'INBOX');
        inbox.dispatchEvent(pointer('pointerdown', 10, 20));
        tick(LONG_PRESS_MS - 1);
        expect(asks.length).toBe(0);
        tick(1);

        expect(asks.length).toBe(1);
        expect(asks[0].event.clientX).toBe(10);
        inbox.dispatchEvent(pointer('pointerup', 10, 20));
        inbox.click();
        expect(chosen).withContext('the press opened the menu, not the folder').toEqual([]);
        inbox.click();
        expect(chosen).toEqual(['INBOX']);
    }));

    it('a touch that moves to scroll, or lifts early, asks for nothing', fakeAsync(() => {
        const el = render();
        const inbox = rowEl(el, 'INBOX');
        inbox.dispatchEvent(pointer('pointerdown', 10, 20));
        inbox.dispatchEvent(pointer('pointermove', 10, 60));
        tick(LONG_PRESS_MS * 2);
        inbox.dispatchEvent(pointer('pointerdown', 10, 20));
        tick(LONG_PRESS_MS / 2);
        inbox.dispatchEvent(pointer('pointerup', 10, 20));
        tick(LONG_PRESS_MS * 2);

        expect(asks).toEqual([]);
    }));

    it('New folder sits at the foot of the list only when offered', () => {
        let el = render(ROWS, null);
        expect(el.querySelector('[data-test="new-folder"]')).toBeNull();

        TestBed.resetTestingModule();
        el = render(ROWS, 'New folder');
        const button = el.querySelector<HTMLButtonElement>('[data-test="new-folder"]');
        expect(button?.textContent?.trim()).toBe('New folder');
        const all = Array.from(el.querySelectorAll('.mbx__folders > *'));
        expect(all[all.length - 1]).withContext('after every row').toBe(button as Element);
        button?.click();
        expect(created).toBe(1);
    });
});
