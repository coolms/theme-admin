import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
