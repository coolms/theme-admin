import { TestBed } from '@angular/core/testing';

import { EmailMailboxDto } from './email.types';
import { MailboxSwitcherComponent } from './mailbox-switcher.component';

const WORK: EmailMailboxDto = { id: 'a', label: 'Work', emailAddress: 'work@example.test' };
const HOME: EmailMailboxDto = { id: 'b', label: 'Home', emailAddress: 'home@example.test' };

function make(mailboxes: EmailMailboxDto[], currentId: string, unread: Record<string, number> = {}) {
    const fixture = TestBed.createComponent(MailboxSwitcherComponent);
    fixture.componentRef.setInput('mailboxes', mailboxes);
    fixture.componentRef.setInput('currentId', currentId);
    fixture.componentRef.setInput('unread', unread);
    const chosen: string[] = [];
    fixture.componentInstance.chosen.subscribe(id => chosen.push(id));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, chosen };
}

describe('MailboxSwitcherComponent', () => {
    it('with one mailbox names it and opens nothing', () => {
        const { el } = make([WORK], 'a');
        expect(el.querySelector('button')).toBeNull();
        expect(el.querySelector('.mbs__label')?.textContent).toContain('Work');
        expect(el.querySelector('.mbs__address')?.textContent).toContain('work@example.test');
    });

    it('shows only the current mailbox until the card is opened', () => {
        const { el } = make([WORK, HOME], 'a');
        expect(el.querySelectorAll('.mbs__choice').length).toBe(0);
        expect(el.querySelector('.mbs__card')?.textContent).toContain('Work');
        expect(el.querySelector('.mbs__card')?.textContent).not.toContain('Home');
    });

    it('the card counts only the open mailbox, and a dot says others have unread mail', () => {
        const { el, fixture } = make([WORK, HOME], 'a', { a: 3, b: 120 });
        expect(el.querySelector('.mbs__card .mbs__count')?.getAttribute('aria-label')).toBe('3 unread');
        expect(el.querySelector('.mbs__card .mbs__count')?.textContent?.trim()).toBe('3');
        const dot = el.querySelector('.mbs__card .mbs__elsewhere');
        expect(dot?.getAttribute('title')).toBe('Unread mail in other mailboxes');
        expect(dot?.getAttribute('aria-label')).toBe('Unread mail in other mailboxes');
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        const rows = Array.from(el.querySelectorAll('.mbs__choice'));
        expect(rows.map(r => r.querySelector('.mbs__count')?.textContent?.trim())).toEqual(['3', '99+']);
        expect(rows[0].getAttribute('aria-current')).toBe('true');
        expect(rows[1].getAttribute('aria-current')).toBe('false');
    });

    it('a choice emits and closes; choosing the current one emits nothing', () => {
        const { el, fixture, chosen } = make([WORK, HOME], 'a');
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        el.querySelectorAll<HTMLButtonElement>('.mbs__choice')[0].click();
        fixture.detectChanges();
        expect(chosen).toEqual([]);
        expect(el.querySelector('.mbs__list')).toBeNull();
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        el.querySelectorAll<HTMLButtonElement>('.mbs__choice')[1].click();
        fixture.detectChanges();
        expect(chosen).toEqual(['b']);
        expect(el.querySelector('.mbs__list')).toBeNull();
    });

    it('opening puts the focus on the current mailbox, and Escape gives it back to the card', async () => {
        const { el, fixture } = make([WORK, HOME], 'b');
        document.body.appendChild(el);
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(document.activeElement).toBe(el.querySelectorAll('.mbs__choice')[1]);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(document.activeElement).toBe(el.querySelector('.mbs__card'));
        el.remove();
    });

    it('an open mailbox with nothing unread shows no number, whatever the others hold', () => {
        const { el } = make([WORK, HOME], 'a', { a: 0, b: 120 });
        expect(el.querySelector('.mbs__card .mbs__count')).toBeNull();
        expect(el.querySelector('.mbs__card .mbs__elsewhere')).not.toBeNull();
    });

    it('no dot when no other mailbox has unread mail', () => {
        const { el } = make([WORK, HOME], 'a', { a: 3, b: 0 });
        expect(el.querySelector('.mbs__card .mbs__count')?.textContent?.trim()).toBe('3');
        expect(el.querySelector('.mbs__card .mbs__elsewhere')).toBeNull();
    });

    it('Escape and a press elsewhere close it', () => {
        const { el, fixture } = make([WORK, HOME], 'a');
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(el.querySelector('.mbs__list')).toBeNull();
        el.querySelector<HTMLButtonElement>('.mbs__card')?.click();
        fixture.detectChanges();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        fixture.detectChanges();
        expect(el.querySelector('.mbs__list')).toBeNull();
    });

    it('one gear, on the mailbox card, only when the server offers the settings; it emits settings', () => {
        const without = make([WORK, HOME], 'a');
        expect(without.el.querySelectorAll('[data-test="mailbox-settings"]').length).toBe(0);

        TestBed.resetTestingModule();
        const { el, fixture } = make([WORK, HOME], 'a');
        fixture.componentRef.setInput('hasSettings', true);
        let opened = 0;
        fixture.componentInstance.settings.subscribe(() => { opened += 1; });
        fixture.detectChanges();
        const gears = el.querySelectorAll<HTMLButtonElement>('[data-test="mailbox-settings"]');
        expect(gears.length).toBe(1);
        expect(gears[0].closest('.mbs__head')?.querySelector('.mbs__card')).withContext('beside the card, in its frame').not.toBeNull();
        gears[0].click();
        expect(opened).toBe(1);
    });

    describe('the card, drawn', () => {
        const LONG: EmailMailboxDto = { id: 'c', label: 'Alexandra Konstantinopoulou @ GMail, the long-standing personal mailbox', emailAddress: 'alexandra.konstantinopoulou.personal@gmail.example.test' };

        /** The card in a column this wide, with a 99+ count. */
        function drawn(width: number) {
            const made = make([LONG, HOME], 'c', { c: 250 });
            const host = made.fixture.nativeElement as HTMLElement;
            host.style.width = width + 'px';
            host.style.display = 'block';
            host.setAttribute('data-card-spec', '');
            document.body.appendChild(host);
            made.fixture.detectChanges();
            return made;
        }
        const box = (el: Element | null) => el!.getBoundingClientRect();
        const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        afterEach(() => document.querySelectorAll('[data-card-spec]').forEach(e => e.remove()));

        it('is one height at every width, the name and the address each on one line with an ellipsis', () => {
            const heights = [180, 230, 380].map(w => {
                const { el } = drawn(w);
                const label = el.querySelector<HTMLElement>('.mbs__label')!;
                const address = el.querySelector<HTMLElement>('.mbs__address')!;
                expect(getComputedStyle(label).whiteSpace).withContext(w + 'px').toBe('nowrap');
                expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
                expect(label.scrollWidth).withContext('the long name is cut').toBeGreaterThan(label.clientWidth);
                expect(getComputedStyle(address).textOverflow).toBe('ellipsis');
                const height = box(el.querySelector('.mbs__card')).height;
                el.remove();
                return height;
            });
            expect(new Set(heights).size).withContext(heights.join(', ')).toBe(1);
        });

        it('says the whole name and address as its tooltip and its accessible name', () => {
            const { el } = drawn(230);
            const card = el.querySelector('.mbs__card')!;
            expect(card.getAttribute('title')).toBe(LONG.label + ', ' + LONG.emailAddress);
            expect(card.getAttribute('aria-label')).toBe('Mailbox: ' + LONG.label + ', ' + LONG.emailAddress + ', 250 unread');
        });

        it('anchors 99+ to the avatar top-right corner, inside the avatar, over neither its letter nor the name', () => {
            for (const w of [180, 230, 380]) {
                const { el } = drawn(w);
                const avatar = el.querySelector<HTMLElement>('.mbs__card .mbs__avatar')!;
                const badge = avatar.querySelector<HTMLElement>('.mbs__count')!;
                expect(badge.textContent?.trim()).toBe('99+');
                expect(getComputedStyle(avatar).position).toBe('relative');
                expect(getComputedStyle(badge).position).toBe('absolute');
                const a = box(avatar);
                const b = box(badge);
                expect(b.top).withContext(w + 'px: at the top').toBeLessThan(a.top);
                expect(Math.abs(b.right - a.right)).withContext(w + 'px: at the right').toBeLessThanOrEqual(4);
                expect(overlap(b, box(el.querySelector('.mbs__card .mbs__label')))).withContext(w + 'px: the name').toBeFalse();
                expect(overlap(b, box(avatar.querySelector('.mbs__initial')))).withContext(w + 'px: the letter').toBeFalse();
                el.remove();
            }
        });
    });
});
