import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';

import { EmailService } from './email.service';
import { SystemMailDto } from './email.types';
import { SystemMailTestPaneComponent, systemMailStateText } from './system-mail-test-pane.component';

const SENDING: SystemMailDto = {
    mailboxId: 'm-1', fromAddress: 'notifications@example.org', fromName: null, state: 'sending', stopReason: null, held: 0,
};

/**
 * Send test under the System mail setting: to the address given, or to the administrator's own when the field is
 * empty; what was done is said with where it went, and a refusal (a malformed address, too many tests) in the
 * server's words, on the pane.
 */
describe('SystemMailTestPaneComponent -- a test to any address, or to one\'s own', () => {
    let testSystemMail: jasmine.Spy;
    let getSystemMail: jasmine.Spy;

    function render(): ComponentFixture<SystemMailTestPaneComponent> {
        const f = TestBed.createComponent(SystemMailTestPaneComponent);
        f.componentRef.setInput('settingKey', 'email.system_mail');
        f.detectChanges();
        return f;
    }

    function text(f: ComponentFixture<SystemMailTestPaneComponent>): string {
        return (f.nativeElement as HTMLElement).textContent ?? '';
    }

    beforeEach(() => {
        testSystemMail = jasmine.createSpy('testSystemMail').and.returnValue(of(null));
        getSystemMail = jasmine.createSpy('getSystemMail').and.returnValue(of(SENDING));
        TestBed.configureTestingModule({
            imports: [SystemMailTestPaneComponent],
            providers: [
                { provide: EmailService, useValue: { testSystemMail, getSystemMail } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'Too many tests: try again in 41 minutes.' } },
            ],
        });
    });

    it('sends to the address given, trimmed, and says where it went', () => {
        const f = render();
        f.componentInstance.to.set('  check@mail-tester.example ');

        f.componentInstance.send();
        f.detectChanges();

        expect(testSystemMail).toHaveBeenCalledOnceWith('check@mail-tester.example');
        expect(text(f)).toContain('The test was sent to check@mail-tester.example.');
    });

    it('with the field empty, sends to the administrator\'s own address and says so', () => {
        const f = render();

        f.componentInstance.send();
        f.detectChanges();

        expect(testSystemMail).toHaveBeenCalledOnceWith('');
        expect(text(f)).toContain('The test was sent to your own address.');
    });

    it('shows a refusal in the server\'s words, and no success', () => {
        testSystemMail.and.returnValue(throwError(() => new Error('429')));
        const f = render();
        f.componentInstance.to.set('check@mail-tester.example');

        f.componentInstance.send();
        f.detectChanges();

        expect(text(f)).toContain('Too many tests: try again in 41 minutes.');
        expect(text(f)).not.toContain('The test was sent');
        expect(f.componentInstance.busy()).toBeFalse();
    });
    it('shows the state on open, and the held count only when something is held', () => {
        getSystemMail.and.returnValue(of({ ...SENDING, state: 'stopped', stopReason: 'mailbox-needs-reconnect', held: 3 }));
        const f = render();

        expect(text(f)).toContain('Stopped: the mailbox needs to be connected again.');
        expect(text(f)).toContain('Held, waiting for the mailbox: 3');

        getSystemMail.and.returnValue(of(SENDING));
        f.componentInstance.readState();
        f.detectChanges();
        expect(text(f)).toContain('Sending through the chosen mailbox.');
        expect(text(f)).not.toContain('Held, waiting');
    });

    it('reads the state again after a test, sent or refused', () => {
        const f = render();
        expect(getSystemMail).toHaveBeenCalledTimes(1);

        f.componentInstance.send();
        expect(getSystemMail).toHaveBeenCalledTimes(2);

        testSystemMail.and.returnValue(throwError(() => new Error('422')));
        f.componentInstance.send();
        expect(getSystemMail).toHaveBeenCalledTimes(3);
    });

    it('says when the state could not be read, never a state it did not read', () => {
        getSystemMail.and.returnValue(throwError(() => new Error('403')));
        const f = render();

        expect(text(f)).toContain('The state could not be read:');
        expect(text(f)).not.toContain('Sending');
        expect(text(f)).not.toContain('Stopped');
    });

    it('words every state and stop reason', () => {
        expect(systemMailStateText({ ...SENDING, state: 'none', mailboxId: null }))
            .toBe('No mailbox chosen: system mail goes out through the server\'s configured mail transport.');
        expect(systemMailStateText({ ...SENDING, state: 'stopped', stopReason: 'mailbox-gone' }))
            .toBe('Stopped: the mailbox no longer exists.');
        expect(systemMailStateText({ ...SENDING, state: 'stopped', stopReason: 'mailbox-disabled' }))
            .toBe('Stopped: the mailbox is disabled.');
        expect(systemMailStateText({ ...SENDING, state: 'stopped', stopReason: null }))
            .toBe('Stopped: no reason was given.');
    });

    it('reads the state again when the setting above is saved or reset (the revision rises)', () => {
        const f = render();
        expect(getSystemMail).toHaveBeenCalledTimes(1);

        f.componentRef.setInput('revision', 1);
        f.detectChanges();

        expect(getSystemMail).toHaveBeenCalledTimes(2);
    });
});
