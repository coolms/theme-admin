import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import type { EmailMailboxDto, SystemMailDto } from './email.types';
import { SystemMailPageComponent } from './system-mail.page';

/**
 * The System mail page over the served API: it reads the choice, offers the shared and enabled mailboxes, saves the
 * choice as the server takes it, and shows every refusal -- a save, a test -- in the server's words. A read refused
 * for want of elevation offers Elevate, and reads again once granted.
 */
describe('SystemMailPageComponent -- choosing the mailbox system mail goes out through', () => {
    const NONE: SystemMailDto = { mailboxId: null, fromAddress: null, fromName: null, state: 'none', stopReason: null, held: 0 };
    const MAILBOXES: EmailMailboxDto[] = [
        { id: 'mb-shared', label: 'Notifications', emailAddress: 'notifications@example.test', kind: 'shared', enabled: true },
        { id: 'mb-personal', label: 'Mine', emailAddress: 'me@example.test', kind: 'personal', enabled: true },
    ];
    const problem = (status: number, detail: string) => new HttpErrorResponse({
        status,
        error: { type: '/errors/email/system-mail/x', title: 'System mail was not changed', detail },
    });
    let email: jasmine.SpyObj<EmailService>;
    let elevation: { elevated: jasmine.Spy; offerFor: jasmine.Spy };

    function render() {
        const fixture = TestBed.createComponent(SystemMailPageComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', [
            'getSystemMail', 'listMailboxes', 'getSystemMailSendAs', 'chooseSystemMail', 'clearSystemMail', 'testSystemMail',
        ]);
        email.getSystemMail.and.returnValue(of(NONE));
        email.listMailboxes.and.returnValue(of(MAILBOXES));
        email.getSystemMailSendAs.and.returnValue(of({
            mailboxId: 'mb-shared', addresses: ['notifications@example.test', 'notifications@example.org'], unreadable: null,
        }));
        elevation = { elevated: jasmine.createSpy('elevated').and.returnValue(false), offerFor: jasmine.createSpy('offerFor').and.returnValue(of(true)) };
        TestBed.configureTestingModule({
            imports: [SystemMailPageComponent],
            providers: [
                { provide: EmailService, useValue: email },
                { provide: ToastService, useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'show']) },
                { provide: ErrorHandlerService, useValue: new ErrorHandlerService() },
                { provide: ElevationService, useValue: elevation },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
            ],
        });
    });

    it('offers only the shared, enabled mailboxes', () => {
        const host = render().nativeElement as HTMLElement;
        const options = Array.from(host.querySelectorAll('select[name="mailbox"] option')).map(o => (o as HTMLOptionElement).value);

        expect(options).toEqual(['', 'mb-shared']);
    });

    it('saves the mailbox, the From picked and the display name, and shows the answer as the new state', () => {
        const answer: SystemMailDto = { ...NONE, mailboxId: 'mb-shared', fromAddress: 'notifications@example.org', fromName: 'CoolMS', state: 'sending' };
        email.chooseSystemMail.and.returnValue(of(answer));
        const fixture = render();
        const page = fixture.componentInstance;

        page.pickMailbox('mb-shared');
        expect(page.fromAddress()).withContext('the own address first').toBe('notifications@example.test');
        page.fromAddress.set('notifications@example.org');
        page.fromName.set(' CoolMS ');
        page.save();

        expect(email.chooseSystemMail).toHaveBeenCalledOnceWith({
            mailboxId: 'mb-shared', fromAddress: 'notifications@example.org', fromName: 'CoolMS',
        });
        expect(page.view()).toEqual(answer);
        expect(page.stateText()).toBe('Sending through the chosen mailbox.');
    });

    it('opens on what is chosen: the stored From, not the list\'s first', () => {
        email.getSystemMail.and.returnValue(of({ ...NONE, mailboxId: 'mb-shared', fromAddress: 'notifications@example.org', state: 'sending' }));
        const page = render().componentInstance;

        expect(page.mailboxId()).toBe('mb-shared');
        expect(page.fromAddress()).toBe('notifications@example.org');
    });

    it('a stored From the mailbox no longer offers is shown, named, and saved unchanged', () => {
        email.getSystemMail.and.returnValue(of({ ...NONE, mailboxId: 'mb-shared', fromAddress: 'old@example.org', state: 'sending' }));
        email.chooseSystemMail.and.returnValue(of(NONE));
        const fixture = render();
        const page = fixture.componentInstance;
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;

        expect(page.fromAddress()).toBe('old@example.org');
        expect(host.querySelector('select[name="fromAddress"] option')?.textContent?.trim()).toBe('old@example.org (not offered now)');
        expect(host.textContent).toContain('Saving keeps it');

        page.save();
        expect(email.chooseSystemMail).toHaveBeenCalledOnceWith({ mailboxId: 'mb-shared', fromAddress: 'old@example.org', fromName: null });
    });

    it('a quick switch: the first mailbox\'s late answer does not fill in the second one\'s addresses', () => {
        const first = new Subject<{ mailboxId: string; addresses: string[]; unreadable: string | null }>();
        const second = new Subject<{ mailboxId: string; addresses: string[]; unreadable: string | null }>();
        email.listMailboxes.and.returnValue(of([...MAILBOXES, { id: 'mb-two', emailAddress: 'two@example.test', kind: 'shared', enabled: true }]));
        const page = render().componentInstance;
        email.getSystemMailSendAs.and.callFake((id: string) => ('mb-shared' === id ? first : second).asObservable());

        page.pickMailbox('mb-shared');
        page.pickMailbox('mb-two');
        second.next({ mailboxId: 'mb-two', addresses: ['two@example.test'], unreadable: null });
        first.next({ mailboxId: 'mb-shared', addresses: ['notifications@example.test'], unreadable: null });

        expect(page.mailboxId()).toBe('mb-two');
        expect(page.addresses()).toEqual(['two@example.test']);
        expect(page.fromAddress()).toBe('two@example.test');
    });

    it('the send-as list cannot be read: the stored From is still shown and kept, and the reason is said', () => {
        email.getSystemMail.and.returnValue(of({ ...NONE, mailboxId: 'mb-shared', fromAddress: 'notifications@example.org', state: 'sending' }));
        email.getSystemMailSendAs.and.returnValue(throwError(() => problem(502, 'The provider could not be asked.')));
        const page = render().componentInstance;

        expect(page.fromAddress()).toBe('notifications@example.org');
        expect(page.notOffered()).toBe('notifications@example.org');
        expect(page.refusal()).toBe('The provider could not be asked.');
    });

    it('a quick switch: the first mailbox\'s late refusal says nothing about the second', () => {
        const first = new Subject<{ mailboxId: string; addresses: string[]; unreadable: string | null }>();
        email.listMailboxes.and.returnValue(of([...MAILBOXES, { id: 'mb-two', emailAddress: 'two@example.test', kind: 'shared', enabled: true }]));
        const page = render().componentInstance;
        email.getSystemMailSendAs.and.callFake((id: string) => ('mb-shared' === id
            ? first.asObservable()
            : of({ mailboxId: 'mb-two', addresses: ['two@example.test'], unreadable: null })));

        page.pickMailbox('mb-shared');
        page.pickMailbox('mb-two');
        first.error(problem(502, 'The provider could not be asked.'));

        expect(page.addresses()).toEqual(['two@example.test']);
        expect(page.fromAddress()).toBe('two@example.test');
        expect(page.refusal()).toBeNull();
    });

    it('a refused send-as read for one mailbox is not shown once another, read fine, is picked', () => {
        email.listMailboxes.and.returnValue(of([...MAILBOXES, { id: 'mb-two', emailAddress: 'two@example.test', kind: 'shared', enabled: true }]));
        const page = render().componentInstance;
        email.getSystemMailSendAs.and.callFake((id: string) => ('mb-shared' === id
            ? throwError(() => problem(502, 'The provider could not be asked.'))
            : of({ mailboxId: 'mb-two', addresses: ['two@example.test'], unreadable: null })));

        page.pickMailbox('mb-shared');
        expect(page.refusal()).withContext('control: the first read is refused').toBe('The provider could not be asked.');
        page.pickMailbox('mb-two');

        expect(page.refusal()).toBeNull();
        expect(page.fromAddress()).toBe('two@example.test');
    });

    it('a refused save is shown in the server\'s words, on the page', () => {
        email.chooseSystemMail.and.returnValue(throwError(() => problem(422, 'The mailbox cannot send as other@example.test.')));
        const fixture = render();
        const page = fixture.componentInstance;

        page.pickMailbox('mb-shared');
        page.save();
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('.alert-danger')?.textContent?.trim())
            .toBe('The mailbox cannot send as other@example.test.');
    });

    it('a test: sent says so; refused says the provider\'s words', () => {
        email.getSystemMail.and.returnValue(of({ ...NONE, mailboxId: 'mb-shared', fromAddress: 'notifications@example.test', state: 'sending' }));
        const fixture = render();
        const page = fixture.componentInstance;

        email.testSystemMail.and.returnValue(of(null));
        page.sendTest();
        expect(page.testSent()).toBeTrue();
        expect(page.refusal()).toBeNull();

        email.testSystemMail.and.returnValue(throwError(() => problem(502, 'The provider answered: 535 authentication failed.')));
        page.sendTest();
        expect(page.testSent()).toBeFalse();
        expect(page.refusal()).toBe('The provider answered: 535 authentication failed.');
    });

    it('a read refused for want of elevation offers Elevate, and reads again once granted', () => {
        const refused = new HttpErrorResponse({ status: 403, headers: new HttpHeaders({ 'X-Elevation-Required': '1' }), error: { detail: 'Access Denied.' } });
        email.getSystemMail.and.returnValues(throwError(() => refused), of(NONE));
        const fixture = render();
        const page = fixture.componentInstance;

        expect(page.loadError()?.elevation).toBeTrue();
        fixture.detectChanges();
        const button = (fixture.nativeElement as HTMLElement).querySelector('.alert button') as HTMLButtonElement;
        expect(button.textContent?.trim()).toBe('Elevate');

        button.click();
        expect(elevation.offerFor).toHaveBeenCalledTimes(1);
        expect(email.getSystemMail).toHaveBeenCalledTimes(2);
        expect(page.loadError()).toBeNull();
        expect(page.view()).toEqual(NONE);
    });

    it('Clear, once confirmed, clears and reads the state again', () => {
        email.clearSystemMail.and.returnValue(of(null));
        const fixture = render();

        fixture.componentInstance.clear();

        expect(email.clearSystemMail).toHaveBeenCalledTimes(1);
        expect(email.getSystemMail).toHaveBeenCalledTimes(2);
    });
});
