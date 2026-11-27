import { ApplicationRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatAddressFake } from './chat-address.fake';
import { MessagesPageComponent } from './messages.page';
import { chatPageProviders, FAKE_ROWS, type FakeChatServer, PHONE_QUERY } from './messages-page.fake';
import type { ChatMessageDto } from './messages.types';

/**
 * At a phone's width Chat shows one pane at a time, as Mail does: the list with nothing open; the open conversation
 * filling the page with a Back that returns to the list, the focus on the row it came from. At a desktop's width both
 * panes stand side by side and there is no Back. The page is rendered in the browser at each width, with the stand-in
 * services, the phone's width answered by the media query the page asks, and the address and history stood in for.
 */
describe('Chat -- one pane at a time on a phone', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    let address: ChatAddressFake;
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const q = (sel: string): HTMLElement | null => el().querySelector<HTMLElement>(sel);
    const shown = (node: HTMLElement | null): boolean => node !== null && getComputedStyle(node).display !== 'none' && node.offsetWidth > 0;

    beforeEach(() => {
        address = new ChatAddressFake();
        const server: FakeChatServer = { rows: FAKE_ROWS, reads: [] };
        TestBed.configureTestingModule({ imports: [MessagesPageComponent], providers: chatPageProviders(server, address) });
    });
    afterEach(() => {
        (fixture?.nativeElement as HTMLElement | undefined)?.remove();
        fixture?.destroy();
    });

    /** The address's change reaches the page, and the page is drawn again, its after-render work done. */
    async function settle(): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve));
        fixture.detectChanges();
        TestBed.inject(ApplicationRef).tick();
    }

    /** The page drawn this wide, the window answering the phone's query as a window that wide would. */
    function show(width: number): void {
        const original = window.matchMedia.bind(window);
        spyOn(window, 'matchMedia').and.callFake((query: string) => (query === PHONE_QUERY
            ? { matches: width < 600, media: query, addEventListener: (): void => {}, removeEventListener: (): void => {} } as unknown as MediaQueryList
            : original(query)));
        fixture = TestBed.createComponent(MessagesPageComponent);
        el().style.width = width + 'px';
        el().style.height = '700px';
        document.body.appendChild(el());
        fixture.detectChanges();
        expect(el().querySelectorAll('.msg__row').length).withContext('the rows drawn').toBe(3);
    }

    async function open(id: string): Promise<void> {
        (q(`.msg__row[data-conversation="${id}"]`) as HTMLButtonElement).click();
        await settle();
        expect(fixture.componentInstance.selectedId()).withContext('opened').toBe(id);
    }

    it('on a phone with nothing open: the list fills the page, the conversation pane is not shown', () => {
        show(390);
        const page = q('.msg')!;
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(q('.msg__list')!.offsetWidth).withContext('list width').toBe(page.clientWidth);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(shown(q('[data-test="chat-phone-back"]'))).withContext('back').toBe(false);
    });

    it('on a phone with one open: the conversation fills the page with Back, the list is not shown', async () => {
        show(390);
        await open('d2');
        const page = q('.msg')!;
        const thread = q('.msg__thread')!;
        expect(shown(thread)).withContext('conversation pane').toBe(true);
        expect(thread.offsetWidth).withContext('conversation width').toBe(page.clientWidth);
        expect(shown(q('.msg__list'))).withContext('list').toBe(false);
        const back = q('[data-test="chat-phone-back"]') as HTMLButtonElement;
        expect(shown(back)).withContext('back shown').toBe(true);
        expect(back.tagName).toBe('BUTTON');
        expect(back.tabIndex).withContext('in the tab order').toBe(0);
        expect(back.disabled).toBe(false);
        expect(back.textContent?.trim()).withContext('its name').toBe('Back');
        expect(back.parentElement).withContext('Back is in the conversation pane').toBe(thread);
    });

    it('on a phone, Back returns to the list through the history, the focus on the row it came from', async () => {
        show(390);
        await open('d2');
        expect(address.entries.length).withContext('the open is an entry of its own').toBe(2);
        const back = q('[data-test="chat-phone-back"]') as HTMLButtonElement;
        back.focus();
        back.click();
        await settle();

        expect(address.index).withContext('stepped back in the history').toBe(0);
        expect(address.current.conversationId).withContext('the address').toBeNull();
        expect(fixture.componentInstance.selectedId()).withContext('closed').toBeNull();
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(document.activeElement).withContext('focus').toBe(q('.msg__row[data-conversation="d2"]'));
    });

    it("on a phone, the browser's Back returns to the list, the focus on the row it came from", async () => {
        show(390);
        await open('d3');
        address.back();
        await settle();

        expect(fixture.componentInstance.selectedId()).withContext('closed').toBeNull();
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(document.activeElement).withContext('focus').toBe(q('.msg__row[data-conversation="d3"]'));
    });

    it('on a phone, a thread opened in the conversation fills the page in its place', async () => {
        show(390);
        await open('d1');
        fixture.componentInstance.openThreadRoot.set({ id: 'm1', conversationId: 'd1', seq: 1, body: 'Root', replyCount: 0 } as unknown as ChatMessageDto);
        fixture.detectChanges();
        const page = q('.msg')!;
        expect(shown(q('.msg__tp'))).withContext('thread panel').toBe(true);
        expect(q('.msg__tp')!.offsetWidth).withContext('thread panel width').toBe(page.clientWidth);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(false);
        expect(shown(q('.msg__list'))).withContext('list').toBe(false);
    });

    it('on a desktop: the list and the conversation side by side, no Back', async () => {
        show(1200);
        expect(shown(q('.msg__list'))).withContext('list, nothing open').toBe(true);
        expect(shown(q('.msg__thread'))).withContext('conversation pane, nothing open').toBe(true);
        await open('d2');
        const list = q('.msg__list')!;
        const thread = q('.msg__thread')!;
        expect(shown(list)).withContext('list').toBe(true);
        expect(shown(thread)).withContext('conversation pane').toBe(true);
        expect(list.getBoundingClientRect().right).withContext('list left of the conversation').toBeLessThanOrEqual(thread.getBoundingClientRect().left);
        expect(thread.offsetWidth).withContext('conversation shares the width').toBeLessThan(q('.msg')!.clientWidth - 200);
        expect(shown(q('[data-test="chat-phone-back"]'))).withContext('back').toBe(false);
    });
});
