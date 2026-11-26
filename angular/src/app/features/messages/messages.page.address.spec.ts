import { ApplicationRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatAddressFake } from './chat-address.fake';
import { MessagesPageComponent } from './messages.page';
import { MessagesQuickPanelComponent } from './messages-quick-panel.component';
import { chatPageProviders, fakeConversation, FAKE_ROWS, type FakeChatServer, PHONE_QUERY } from './messages-page.fake';

/**
 * The open conversation is in the address, at every width: `/admin/chat/<id>`, the list alone `/admin/chat`. Opening
 * one from the list alone is an entry of its own in the history; opening one in place of another replaces that one's
 * entry, so switching does not stack the history. Back (the browser's or the page's) returns to the list; a reload or
 * a link opens the conversation it names; an id the person may not read opens nothing and leaves the address. The
 * older `?c=<id>` link is replaced by `/chat/<id>`. The address and the history are stood in for.
 */
describe('Chat -- the open conversation in the address', () => {
    let fixture: ComponentFixture<MessagesPageComponent>;
    let address: ChatAddressFake;
    let server: FakeChatServer;
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

    /** The page loaded at this address, this wide. */
    async function load(at: ChatAddressFake, width = 1200, older: FakeChatServer['older'] = []): Promise<void> {
        address = at;
        server = { rows: FAKE_ROWS, older, reads: [] };
        TestBed.configureTestingModule({ imports: [MessagesPageComponent], providers: chatPageProviders(server, address) });
        const original = window.matchMedia.bind(window);
        spyOn(window, 'matchMedia').and.callFake((query: string) => (query === PHONE_QUERY
            ? { matches: width < 600, media: query, addEventListener: (): void => {}, removeEventListener: (): void => {} } as unknown as MediaQueryList
            : original(query)));
        fixture = TestBed.createComponent(MessagesPageComponent);
        el().style.width = width + 'px';
        el().style.height = '700px';
        document.body.appendChild(el());
        fixture.detectChanges();
        await settle();
    }

    async function open(id: string): Promise<void> {
        (q(`.msg__row[data-conversation="${id}"]`) as HTMLButtonElement).click();
        await settle();
        expect(fixture.componentInstance.selectedId()).withContext('opened ' + id).toBe(id);
    }

    it('opening one from the list writes /chat/<id>, an entry of its own', async () => {
        await load(new ChatAddressFake());
        expect(address.navigations).withContext('nothing asked on load').toEqual([]);

        await open('d1');

        expect(address.navigations).toEqual([{ commands: ['/chat', 'd1'], replaceUrl: false }]);
        expect(history()).toEqual([null, 'd1']);
    });

    it('switching conversations on a desktop replaces the entry: one Back returns to the list', async () => {
        await load(new ChatAddressFake());
        await open('d1');
        await open('d2');
        await open('d3');

        expect(history()).withContext('the history').toEqual([null, 'd3']);
        expect(address.navigations.map(n => n.replaceUrl)).toEqual([false, true, true]);

        address.back();
        await settle();
        expect(fixture.componentInstance.selectedId()).withContext('back to the list').toBeNull();
        expect(q('.msg__empty')).withContext('the empty pane').not.toBeNull();
    });

    it('a reload of /chat/<id>, or a link to it, opens that conversation', async () => {
        await load(new ChatAddressFake('d2'));

        expect(fixture.componentInstance.selectedId()).toBe('d2');
        expect(q('.msg__thread-name')?.textContent?.trim()).toBe('Person d2');
        expect(address.navigations).withContext('the address stays').toEqual([]);
    });

    it('a link to a conversation not on the first page reads that one row and opens it', async () => {
        await load(new ChatAddressFake('o1'), 1200, [fakeConversation('o1', '2026-10-01T10:00:00+00:00')]);

        expect(server.reads).toContain('o1');
        expect(fixture.componentInstance.selectedId()).toBe('o1');
        expect(address.navigations).toEqual([]);
    });

    it('on a phone, a link opens the conversation alone; its Back shows the list in place of the address', async () => {
        await load(new ChatAddressFake('d2'), 390);
        expect(shown(q('.msg__thread'))).withContext('conversation pane').toBe(true);
        expect(shown(q('.msg__list'))).withContext('list').toBe(false);

        (q('[data-test="chat-phone-back"]') as HTMLButtonElement).click();
        await settle();

        expect(history()).withContext('replaced, not stepped out of the page').toEqual([null]);
        expect(address.index).toBe(0);
        expect(shown(q('.msg__list'))).withContext('list').toBe(true);
        expect(fixture.componentInstance.selectedId()).toBeNull();
    });

    it('an id the person may not read opens nothing, shows nothing of it, and leaves the address', async () => {
        await load(new ChatAddressFake('x9'));

        expect(server.reads).withContext('asked the server').toContain('x9');
        expect(fixture.componentInstance.selectedId()).toBeNull();
        expect(q('.msg__thread-head')).withContext('no conversation drawn').toBeNull();
        expect(q('.msg__empty')).withContext('the empty pane').not.toBeNull();
        expect(el().textContent).not.toContain('x9');
        expect(address.navigations).toEqual([{ commands: ['/chat'], replaceUrl: true }]);
        expect(history()).withContext('in place').toEqual([null]);
    });

    it('the older ?c=<id> link is replaced by /chat/<id> and opens it', async () => {
        await load(new ChatAddressFake(null, { c: 'd3' }));

        expect(address.navigations[0]).toEqual({ commands: ['/chat', 'd3'], replaceUrl: true });
        expect(history()).toEqual(['d3']);
        expect(address.current.query).withContext('no ?c= left').toEqual({});
        expect(fixture.componentInstance.selectedId()).toBe('d3');
    });

    it("the quick panel's open in Chat goes to /chat/<id>, or /chat with none open", async () => {
        await load(new ChatAddressFake());
        const panel = TestBed.createComponent(MessagesQuickPanelComponent);
        panel.componentInstance.openId.set('d2');
        panel.componentInstance.openFull();
        panel.componentInstance.openId.set(null);
        panel.componentInstance.openFull();
        panel.destroy();

        expect(address.navigations.map(n => n.commands)).toEqual([['/chat', 'd2'], ['/chat']]);
    });
});
