import { ApplicationRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '@coolms/ui-angular';

import { ChatAddressFake } from './chat-address.fake';
import { ChatLastOpenedService } from './chat-last-opened.service';
import { MessagesPageComponent } from './messages.page';
import { chatPageProviders, FAKE_ROWS, type FakeChatServer, PHONE_QUERY } from './messages-page.fake';

/**
 * Chat opened at the list alone, the person's last conversation stored: on a desktop it opens, the address naming it
 * in place of the list's (no entry added); on a phone the list opens with its row marked, not opened. One no longer
 * read opens the list, with no error, notice or console error. Each open is remembered. The store is stood in for.
 */
describe('Chat -- the last conversation opened', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    let address: ChatAddressFake;
    let remember: jasmine.Spy;
    let read: jasmine.Spy;
    let toastError: jasmine.Spy;
    let consoleError: jasmine.Spy;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const q = (sel: string): HTMLElement | null => el().querySelector<HTMLElement>(sel);
    const shown = (node: HTMLElement | null): boolean => node !== null && getComputedStyle(node).display !== 'none' && node.offsetWidth > 0;
    const history = (): Array<string | null> => address.entries.map(e => e.conversationId);

    afterEach(() => {
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    async function settle(): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve));
        fixture.detectChanges();
        TestBed.inject(ApplicationRef).tick();
    }

    /** The page loaded at this address, this wide, with this conversation stored as the last. */
    async function load(at: ChatAddressFake, stored: string | null, width = 1200): Promise<void> {
        address = at;
        const server: FakeChatServer = { rows: FAKE_ROWS, reads: [] };
        remember = jasmine.createSpy('remember');
        read = jasmine.createSpy('read').and.returnValue(of(stored));
        toastError = jasmine.createSpy('toast error');
        TestBed.configureTestingModule({
            imports: [MessagesPageComponent],
            providers: [
                ...chatPageProviders(server, address),
                { provide: ChatLastOpenedService, useValue: { read, remember } },
                { provide: ToastService, useValue: { error: toastError } },
            ],
        });
        const original = window.matchMedia.bind(window);
        spyOn(window, 'matchMedia').and.callFake((query: string) => (query === PHONE_QUERY
            ? { matches: width < 600, media: query, addEventListener: (): void => {}, removeEventListener: (): void => {} } as unknown as MediaQueryList
            : original(query)));
        consoleError = spyOn(console, 'error').and.callThrough();
        fixture = TestBed.createComponent(MessagesPageComponent);
        el().style.width = width + 'px';
        el().style.height = '700px';
        document.body.appendChild(el());
        fixture.detectChanges();
        await settle();
        await settle();
    }

    it('on a desktop, /chat opens the last conversation, the address naming it in place', async () => {
        await load(new ChatAddressFake(), 'd2');

        expect(fixture.componentInstance.selectedId()).toBe('d2');
        expect(address.navigations).toEqual([{ commands: ['/chat', 'd2'], replaceUrl: true }]);
        expect(history()).withContext('no entry added').toEqual(['d2']);
    });

    it('on a phone, /chat opens the list with the last conversation marked, not opened', async () => {
        await load(new ChatAddressFake(), 'd2', 390);

        expect(fixture.componentInstance.selectedId()).withContext('not opened').toBeNull();
        expect(address.navigations).toEqual([]);
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        const row = q('.msg__row[data-conversation="d2"]')!;
        expect(row.getAttribute('aria-current')).toBe('true');
        expect(row.classList).toContain('msg__row--active');
        expect(el().querySelectorAll('.msg__row[aria-current]').length).withContext('only that row').toBe(1);
    });

    it('a last conversation no longer read opens the list: nothing opened, no error, notice or console error', async () => {
        await load(new ChatAddressFake(), 'x9');

        expect(fixture.componentInstance.selectedId()).toBeNull();
        expect(q('.msg__thread-head')).toBeNull();
        expect(q('.msg__err')).withContext('no error line').toBeNull();
        expect(fixture.componentInstance.error()).toBeNull();
        expect(toastError).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(history()).withContext('the list alone, in place').toEqual([null]);
    });

    it('on a phone, one no longer read marks no row', async () => {
        await load(new ChatAddressFake(), 'x9', 390);

        expect(el().querySelectorAll('.msg__row[aria-current]').length).toBe(0);
        expect(fixture.componentInstance.selectedId()).toBeNull();
    });

    it('an address naming a conversation is followed, not the last one', async () => {
        await load(new ChatAddressFake('d1'), 'd2');

        expect(fixture.componentInstance.selectedId()).toBe('d1');
        expect(read).not.toHaveBeenCalled();
        expect(address.navigations).toEqual([]);
    });

    it('each open is remembered', async () => {
        await load(new ChatAddressFake(), null);
        (q('.msg__row[data-conversation="d3"]') as HTMLButtonElement).click();
        await settle();
        (q('.msg__row[data-conversation="d1"]') as HTMLButtonElement).click();
        await settle();

        expect(remember.calls.allArgs()).toEqual([['d3'], ['d1']]);
    });
});
