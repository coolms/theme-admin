import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { type Observable, of, throwError } from 'rxjs';
import { AuthState, ErrorHandlerService } from '@coolms/core-angular';
import { CentrifugoClientService, ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailLiveEventsService } from './email-live-events.service';
import { EmailService } from './email.service';
import { type MailAlias, type MailAliasesDto } from './mail-aliases';
import { MailboxAliasesSectionComponent } from './mailbox-aliases-section.component';

const MAILBOX = 'mb-1';
const OWN = 'support@example.test';

/** The person's mail channel: every publication reaches every handler still on it; unsubscribing stops them all. */
class FakeChannel {
    handlers: ((ctx: { data: unknown }) => void)[] = [];
    readonly subscription = {
        state: 'subscribed',
        on: (event: string, h: (ctx: { data: unknown }) => void) => {
            if (event === 'publication') {
                this.handlers.push(h);
            }
        },
        off: (_event: string, h: (ctx: { data: unknown }) => void) => {
            this.handlers = this.handlers.filter(x => x !== h);
        },
        subscribe: () => undefined,
        // One subscription per channel in the realtime client: closing it closes it for every handler.
        unsubscribe: () => {
            this.handlers = [];
        },
    };

    client(): object {
        return { isConnected: signal(true), connect: () => Promise.resolve(), getOrCreateSubscription: () => this.subscription };
    }

    publish(data: unknown): void {
        for (const h of [...this.handlers]) {
            h({ data });
        }
    }
}

function alias(id: string, address: string, status: MailAlias['status'], extra: Partial<MailAlias> = {}): MailAlias {
    return { id, address, status, requestedAt: '2026-11-09T08:00:00+00:00', ...extra };
}

const CONFIRMED = alias('a-1', 'sales@example.test', 'confirmed', { confirmedAt: '2026-11-09T09:00:00+00:00' });
const PENDING = alias('a-2', 'help@example.test', 'pending', { expiresAt: '2026-11-10T08:00:00+00:00' });
const EXPIRED = alias('a-3', 'old@example.test', 'expired', { expiresAt: '2026-11-08T08:00:00+00:00' });
const DECLINED = alias('a-4', 'notmine@example.test', 'declined');

const refused = (status: number, reason: string, retryAfter?: string): HttpErrorResponse => new HttpErrorResponse({
    status,
    error: { type: `/errors/email/alias/${reason}`, title: 'The address was refused', status },
    headers: retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
});

/**
 * "Addresses you send from": the mailbox's own address and its provider's, read-only, then the typed aliases with their
 * status; Add mails a link and shows the row waiting; each refusal in its own words, a 429 with its wait; Withdraw asks
 * first; Send again sends a fresh link; a caller the list says may not manage reads only; and `mail.aliases.changed`
 * for the mailbox reads the list again.
 */
describe('MailboxAliasesSectionComponent -- the addresses a mailbox sends from', () => {
    let email: jasmine.SpyObj<EmailService>;
    let channel: FakeChannel;
    let toast: jasmine.SpyObj<ToastService>;
    let confirmed: boolean;
    let asked: { title?: string; message?: string; confirmLabel?: string } | null;
    let served: MailAliasesDto;

    async function render(list: MailAliasesDto, sendAs: readonly string[] = [OWN, 'team@example.test', CONFIRMED.address]):
        Promise<ComponentFixture<MailboxAliasesSectionComponent>> {
        served = list;
        email.listAliases.and.callFake(() => of(served));
        email.getSendAs.and.returnValue(of({ id: MAILBOX, addresses: [...sendAs], unreadable: null }));
        const fixture = TestBed.createComponent(MailboxAliasesSectionComponent);
        fixture.componentRef.setInput('mailboxId', MAILBOX);
        fixture.componentRef.setInput('ownAddress', OWN);
        fixture.detectChanges();
        // The realtime client connects on a promise: the channel's handler is on it after it settles.
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture;
    }

    const rows = (host: HTMLElement): string[] =>
        Array.from(host.querySelectorAll('.sfa__row')).map(r => (r.textContent ?? '').replace(/\s+/g, ' ').trim());
    const row = (host: HTMLElement, address: string): HTMLElement =>
        Array.from(host.querySelectorAll<HTMLElement>('.sfa__row')).find(r => r.querySelector('.sfa__address')?.textContent?.trim() === address)!;
    const buttonsOf = (el: HTMLElement): string[] =>
        Array.from(el.querySelectorAll('button')).map(b => (b.textContent ?? '').trim());
    const button = (el: HTMLElement, label: string): HTMLButtonElement =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(b => (b.textContent ?? '').trim() === label)!;
    const notice = (host: HTMLElement): string => (host.querySelector('.sfa__notice')?.textContent ?? '').trim();

    function type(fixture: ComponentFixture<MailboxAliasesSectionComponent>, value: string): void {
        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[name=address]')!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    }

    function submit(fixture: ComponentFixture<MailboxAliasesSectionComponent>): void {
        button(fixture.nativeElement as HTMLElement, 'Send confirmation').click();
        fixture.detectChanges();
    }

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', ['listAliases', 'getSendAs', 'askAlias', 'withdrawAlias']);
        email.withdrawAlias.and.returnValue(of(null));
        channel = new FakeChannel();
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'show']);
        confirmed = true;
        asked = null;
        TestBed.configureTestingModule({
            imports: [MailboxAliasesSectionComponent],
            providers: [
                EmailLiveEventsService,
                { provide: CentrifugoClientService, useValue: channel.client() },
                { provide: EmailService, useValue: email },
                { provide: ToastService, useValue: toast },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                {
                    provide: ConfirmDialogService,
                    useValue: { open: (o: { title?: string; message?: string }): Observable<boolean> => { asked = o; return of(confirmed); } },
                },
                { provide: Store, useValue: { selectSnapshot: (s: unknown) => (s === AuthState.currentUser ? { id: 'user-1' } : { apiBase: '/api/v1' }) } },
            ],
        });
    });

    it('lists the own and provider addresses read-only, then each alias with its status and its actions', async () => {
        const host = (await render({ canManage: true, aliases: [CONFIRMED, PENDING, EXPIRED, DECLINED] })).nativeElement as HTMLElement;

        expect(email.listAliases).toHaveBeenCalledOnceWith(MAILBOX);
        expect(email.getSendAs).toHaveBeenCalledOnceWith(MAILBOX);
        // The confirmed alias is in send-as too: it is shown once, as an alias.
        expect(Array.from(host.querySelectorAll('.sfa__address')).map(a => a.textContent?.trim()))
            .toEqual([OWN, 'team@example.test', CONFIRMED.address, PENDING.address, EXPIRED.address, DECLINED.address]);
        expect(rows(host)[0]).toContain('This mailbox\'s address');
        expect(rows(host)[0]).toContain('Always offered; not changed here.');
        expect(rows(host)[1]).toContain('Verified by the provider');
        expect(rows(host)[1]).toContain('Verified at the mail provider; not changed here.');
        expect(buttonsOf(row(host, OWN))).toEqual([]);
        expect(buttonsOf(row(host, 'team@example.test'))).toEqual([]);

        expect(row(host, CONFIRMED.address).textContent).toContain('Confirmed');
        expect(buttonsOf(row(host, CONFIRMED.address))).toEqual(['Withdraw']);
        expect(row(host, PENDING.address).textContent).toContain('Waiting for confirmation');
        expect(row(host, PENDING.address).textContent).toContain('Expires at');
        expect(buttonsOf(row(host, PENDING.address))).toEqual(['Send again', 'Withdraw']);
        expect(row(host, EXPIRED.address).textContent).toContain('Link expired');
        expect(buttonsOf(row(host, EXPIRED.address))).toEqual(['Send again', 'Withdraw']);
        expect(row(host, DECLINED.address).textContent).toContain('Declined');
        expect(buttonsOf(row(host, DECLINED.address))).toEqual(['Withdraw']);
        expect(host.querySelector('input[name=address]')).not.toBeNull();
    });

    it('Add mails the link: the row waits for confirmation, with the line that names the address and the 24 hours', async () => {
        const fixture = await render({ canManage: true, aliases: [] });
        const host = fixture.nativeElement as HTMLElement;
        email.askAlias.and.returnValue(of({ id: 'a-9', address: 'new@example.test', status: 'pending', expiresAt: '2026-11-10T10:00:00+00:00' }));

        type(fixture, '  new@example.test ');
        submit(fixture);

        expect(email.askAlias).toHaveBeenCalledOnceWith(MAILBOX, 'new@example.test');
        expect(row(host, 'new@example.test').textContent).toContain('Waiting for confirmation');
        expect(buttonsOf(row(host, 'new@example.test'))).toEqual(['Send again', 'Withdraw']);
        expect(notice(host)).toBe('We sent a link to new@example.test. It works for 24 hours.');
        expect(host.querySelector('.sfa__notice')?.getAttribute('role')).toBe('status');
        // The form's model writes the emptied field on the next microtask.
        await fixture.whenStable();
        expect(host.querySelector<HTMLInputElement>('input[name=address]')!.value).toBe('');
    });

    it('shows each refusal in its own words, a 429 with the wait Retry-After gives, and keeps the typed address', async () => {
        const fixture = await render({ canManage: true, aliases: [] }, [OWN, 'team@example.test']);
        const host = fixture.nativeElement as HTMLElement;
        const cases: [HttpErrorResponse, string][] = [
            [refused(422, 'own-address'), 'That is this mailbox\'s own address: it already sends from it.'],
            [refused(422, 'already-listed'), 'This mailbox already sends from that address.'],
            [refused(422, 'malformed'), 'That is not an email address.'],
            [refused(422, 'too-many-pending'), 'Ten addresses are already waiting for confirmation. Withdraw one, or wait until its link is answered or expires.'],
            [refused(429, 'rate-limited', '5400'), 'Too many links were asked for this address or this mailbox, or the address\'s owner declined it lately. You can ask again in 90 minutes.'],
            [refused(429, 'rate-limited', '2592000'), 'Too many links were asked for this address or this mailbox, or the address\'s owner declined it lately. You can ask again in 30 days.'],
            [refused(429, 'rate-limited'), 'Too many links were asked for this address or this mailbox, or the address\'s owner declined it lately. You can ask again later.'],
            [new HttpErrorResponse({ status: 403 }), 'failed'],
        ];
        for (const [err, words] of cases) {
            email.askAlias.and.returnValue(throwError(() => err));
            type(fixture, 'x@example.test');
            submit(fixture);

            expect(notice(host)).withContext(`${err.status} ${JSON.stringify(err.error)}`).toBe(words);
            expect(host.querySelector('.sfa__notice')?.getAttribute('role')).toBe('alert');
            expect(host.querySelector<HTMLInputElement>('input[name=address]')!.value).toBe('x@example.test');
        }
        expect(rows(host).length).withContext('no row is added for a refusal').toBe(2);
    });

    it('Withdraw asks first: a No sends nothing; a Yes withdraws the alias and its row goes', async () => {
        const fixture = await render({ canManage: true, aliases: [CONFIRMED, PENDING] });
        const host = fixture.nativeElement as HTMLElement;

        confirmed = false;
        button(row(host, CONFIRMED.address), 'Withdraw').click();
        fixture.detectChanges();
        expect(asked?.title).toBe(`Withdraw ${CONFIRMED.address}?`);
        expect(asked?.message).toContain('stops sending from this address');
        expect(email.withdrawAlias).not.toHaveBeenCalled();
        expect(row(host, CONFIRMED.address)).toBeDefined();

        confirmed = true;
        button(row(host, PENDING.address), 'Withdraw').click();
        fixture.detectChanges();
        expect(asked?.message).toContain('a link already sent to it stops working');
        expect(email.withdrawAlias).toHaveBeenCalledOnceWith(MAILBOX, PENDING.id);
        expect(row(host, PENDING.address)).toBeUndefined();
        expect(row(host, CONFIRMED.address)).toBeDefined();
        expect(toast.success).toHaveBeenCalledWith(`${PENDING.address} withdrawn`);
    });

    it('Send again asks for the same address: the row takes the fresh link\'s expiry and the line is shown', async () => {
        const fixture = await render({ canManage: true, aliases: [PENDING] });
        const host = fixture.nativeElement as HTMLElement;
        email.askAlias.and.returnValue(of({ id: PENDING.id, address: PENDING.address, status: 'pending', expiresAt: '2026-11-11T12:00:00+00:00' }));

        button(row(host, PENDING.address), 'Send again').click();
        fixture.detectChanges();

        expect(email.askAlias).toHaveBeenCalledOnceWith(MAILBOX, PENDING.address);
        expect(fixture.componentInstance.aliases().map(a => [a.id, a.expiresAt])).toEqual([[PENDING.id, '2026-11-11T12:00:00+00:00']]);
        expect(rows(host).filter(r => r.includes(PENDING.address)).length).toBe(1);
        expect(notice(host)).toBe(`We sent a link to ${PENDING.address}. It works for 24 hours.`);
    });

    it('a caller the list says may not manage reads the list only: no Add, no Send again, no Withdraw', async () => {
        const fixture = await render({ canManage: false, aliases: [CONFIRMED, PENDING] });
        const host = fixture.nativeElement as HTMLElement;

        expect(rows(host).length).toBe(4);
        expect(host.querySelectorAll('button').length).toBe(0);
        expect(host.querySelector('form')).toBeNull();
        expect(host.querySelector('.sfa__hint')?.textContent).toContain('Only who may change this mailbox\'s settings');

        fixture.componentInstance.address.set('x@example.test');
        fixture.componentInstance.add();
        fixture.componentInstance.sendAgain(PENDING);
        fixture.componentInstance.withdraw(PENDING);
        expect(email.askAlias).not.toHaveBeenCalled();
        expect(asked).toBeNull();
        expect(email.withdrawAlias).not.toHaveBeenCalled();
    });

    it('mail.aliases.changed for this mailbox reads the list again in place; another mailbox\'s, or a malformed one, does not', async () => {
        const fixture = await render({ canManage: true, aliases: [PENDING] });
        const host = fixture.nativeElement as HTMLElement;
        expect(channel.handlers.length).withContext('the subject: the section listens on the person\'s channel').toBe(1);
        expect(row(host, PENDING.address).textContent).toContain('Waiting for confirmation');

        served = { canManage: true, aliases: [{ ...PENDING, status: 'confirmed', confirmedAt: '2026-11-09T10:00:00+00:00', expiresAt: null }] };
        channel.publish({ type: 'mail.aliases.changed', mailboxId: 'mb-other' });
        channel.publish({ type: 'mail.aliases.changed' });
        fixture.detectChanges();
        expect(email.listAliases).toHaveBeenCalledTimes(1);

        channel.publish({ type: 'mail.aliases.changed', mailboxId: MAILBOX });
        fixture.detectChanges();
        expect(email.listAliases).toHaveBeenCalledTimes(2);
        expect(row(host, PENDING.address).textContent).toContain('Confirmed');
        expect(buttonsOf(row(host, PENDING.address))).toEqual(['Withdraw']);
    });

    it('two watchers of the person\'s channel share it: one that stops leaves the other listening', async () => {
        const live = TestBed.inject(EmailLiveEventsService);
        const a: string[] = [];
        const b: string[] = [];
        const first = live.watch('user-1').subscribe(evt => a.push(evt.type));
        const second = live.watch('user-1').subscribe(evt => b.push(evt.type));
        await Promise.resolve();
        await Promise.resolve();
        expect(channel.handlers.length).withContext('the subject: one handler on the channel').toBe(1);

        second.unsubscribe();
        channel.publish({ type: 'mail.aliases.changed', mailboxId: MAILBOX });
        expect(a).toEqual(['mail.aliases.changed']);
        expect(b).toEqual([]);
        first.unsubscribe();
        expect(channel.handlers.length).toBe(0);
    });
});
