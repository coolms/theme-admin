import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService } from '@coolms/ui-angular';

import { MailHitRowComponent } from './mail-hit-row.component';

/**
 * A search hit's row, shared by the stored results and the server's: sender and date on the first line, the subject on
 * the second, then the chips and the snippet; a press says it was chosen.
 */
describe('MailHitRowComponent', () => {
    function render(inputs: Record<string, unknown>): { el: HTMLElement; chosen: number[] } {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [{ provide: DateTimeFormatService, useValue: { auto: (iso: string | null | undefined) => iso ?? '' } }],
        });
        const fixture = TestBed.createComponent(MailHitRowComponent);
        for (const [k, v] of Object.entries(inputs)) {
            fixture.componentRef.setInput(k, v);
        }
        const chosen: number[] = [];
        fixture.componentInstance.chosen.subscribe(() => chosen.push(1));
        fixture.detectChanges();

        return { el: fixture.nativeElement as HTMLElement, chosen };
    }

    const lineOf = (el: HTMLElement, cls: string): string => (el.querySelector(`.${cls}`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('sender and date, then subject, then the folder chip and the snippet', () => {
        const { el, chosen } = render({
            testId: 'local-hit', from: 'Accounts Team', date: '2026-10-31T15:54:00+00:00', subject: 'Invoice for October',
            chips: ['Inbox'], snippet: 'Please find the invoice attached.', unread: true,
        });

        expect(lineOf(el, 'mhr__top .mhr__from')).toBe('Accounts Team');
        expect(lineOf(el, 'mhr__top .mhr__date')).toBe('2026-10-31T15:54:00+00:00');
        expect(lineOf(el, 'mhr__subject')).toBe('Invoice for October');
        expect(lineOf(el, 'mhr__chip')).toBe('Inbox');
        expect(lineOf(el, 'mhr__snippet')).toBe('Please find the invoice attached.');
        const button = el.querySelector<HTMLButtonElement>('[data-test="local-hit"]');
        expect(button?.classList.contains('mhr--unread')).toBeTrue();

        button?.click();
        expect(chosen.length).toBe(1);
    });

    it('a hit without a sender or a subject says so', () => {
        const { el } = render({ from: null, subject: '' });

        expect(lineOf(el, 'mhr__from')).toBe('(unknown)');
        expect(lineOf(el, 'mhr__subject')).toBe('(no subject)');
        expect(el.querySelector('.mhr__snippet')).toBeNull();
    });
});
