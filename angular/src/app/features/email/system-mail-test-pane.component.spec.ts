import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';

import { EmailService } from './email.service';
import { SystemMailTestPaneComponent } from './system-mail-test-pane.component';

/**
 * Send test under the System mail setting: to the address given, or to the administrator's own when the field is
 * empty; what was done is said with where it went, and a refusal (a malformed address, too many tests) in the
 * server's words, on the pane.
 */
describe('SystemMailTestPaneComponent -- a test to any address, or to one\'s own', () => {
    let testSystemMail: jasmine.Spy;

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
        TestBed.configureTestingModule({
            imports: [SystemMailTestPaneComponent],
            providers: [
                { provide: EmailService, useValue: { testSystemMail } },
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
});
