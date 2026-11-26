import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_HEADER, ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { SystemMailDto } from './email.types';
import { MailboxSettingsOverPage } from './mailbox-settings-over-page.service';
import { SystemMailTestPaneComponent, systemMailStateText } from './system-mail-test-pane.component';

const SENDING: SystemMailDto = {
    mailboxId: 'm-1', fromAddress: 'notifications@example.org', fromName: null, state: 'sending', stopReason: null, held: 0,
};

@Component({ selector: 'app-blank', standalone: true, template: '' })
class BlankComponent {}

/** The System mail settings page's address. */
const PAGE = '/email/settings/email.system_mail';

/**
 * Send test under the System mail setting: to the address given, or to the administrator's own when the field is
 * empty; what was done is said with where it went, and a refusal (a malformed address, too many tests) in the
 * server's words, on the pane. Mailbox settings, once the state is read and names a mailbox, opens its settings; so
 * does an address that names that mailbox, which also says a sign-in's outcome and is cleared.
 */
describe('SystemMailTestPaneComponent -- a test to any address, or to one\'s own', () => {
    let testSystemMail: jasmine.Spy;
    let getSystemMail: jasmine.Spy;
    let offerFor: jasmine.Spy;
    let open: jasmine.Spy;
    let toast: jasmine.SpyObj<ToastService>;

    function render(): ComponentFixture<SystemMailTestPaneComponent> {
        const f = TestBed.createComponent(SystemMailTestPaneComponent);
        f.componentRef.setInput('settingKey', 'email.system_mail');
        f.detectChanges();
        return f;
    }

    function text(f: ComponentFixture<SystemMailTestPaneComponent>): string {
        return (f.nativeElement as HTMLElement).textContent ?? '';
    }

    function elevateButton(f: ComponentFixture<SystemMailTestPaneComponent>): HTMLButtonElement | null {
        return (f.nativeElement as HTMLElement)
            .querySelector<HTMLButtonElement>('[data-test="system-mail-elevation-required"] [data-test="elevate"]');
    }

    beforeEach(() => {
        testSystemMail = jasmine.createSpy('testSystemMail').and.returnValue(of(null));
        getSystemMail = jasmine.createSpy('getSystemMail').and.returnValue(of(SENDING));
        offerFor = jasmine.createSpy('offerFor').and.returnValue(of(true));
        open = jasmine.createSpy('open').and.returnValue(Promise.resolve());
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
        TestBed.configureTestingModule({
            imports: [SystemMailTestPaneComponent],
            providers: [
                provideRouter([{ path: '**', component: BlankComponent }]),
                provideLocationMocks(),
                { provide: ToastService, useValue: toast },
                { provide: EmailService, useValue: { testSystemMail, getSystemMail } },
                { provide: ElevationService, useValue: { offerFor, elevated: () => false, available: true } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'Too many tests: try again in 41 minutes.' } },
            ],
        });
        TestBed.overrideComponent(SystemMailTestPaneComponent, {
            set: { providers: [{ provide: MailboxSettingsOverPage, useValue: { open } }] },
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
        expect(elevateButton(f)).toBeNull();
    });

    it('offers Elevate when the read is refused for want of elevation, and reads the state again once elevated', () => {
        const stamped = new HttpErrorResponse({
            status: 403, headers: new HttpHeaders({ [ELEVATION_REQUIRED_HEADER]: '1' }),
        });
        getSystemMail.and.returnValue(throwError(() => stamped));
        const f = render();

        expect(elevateButton(f)).not.toBeNull();
        expect(text(f)).not.toContain('The state could not be read:');
        expect(text(f)).not.toContain('Sending');

        getSystemMail.and.returnValue(of(SENDING));
        elevateButton(f)!.click();
        f.detectChanges();

        expect(offerFor).toHaveBeenCalledTimes(1);
        expect(getSystemMail).toHaveBeenCalledTimes(2);
        expect(text(f)).toContain('Sending through the chosen mailbox.');
        expect(elevateButton(f)).toBeNull();
    });

    it('a declined prompt reads nothing again and keeps Elevate on offer', () => {
        offerFor.and.returnValue(of(false));
        const stamped = new HttpErrorResponse({
            status: 403, headers: new HttpHeaders({ [ELEVATION_REQUIRED_HEADER]: '1' }),
        });
        getSystemMail.and.returnValue(throwError(() => stamped));
        const f = render();

        elevateButton(f)!.click();
        f.detectChanges();

        expect(getSystemMail).toHaveBeenCalledTimes(1);
        expect(elevateButton(f)).not.toBeNull();
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

    describe('Mailbox settings', () => {
        const button = (f: ComponentFixture<SystemMailTestPaneComponent>): HTMLButtonElement | null =>
            (f.nativeElement as HTMLElement).querySelector('[data-test="system-mail-mailbox-settings"]');

        it('opens the settings of the mailbox the state names, and reads the state again as they close', () => {
            const f = render();
            expect(button(f)?.textContent?.trim()).toBe('Mailbox settings');
            button(f)!.click();

            expect(open).toHaveBeenCalledTimes(1);
            expect(open.calls.mostRecent().args.slice(0, 2)).toEqual(['m-1', 'general']);
            expect(getSystemMail).toHaveBeenCalledTimes(1);
            (open.calls.mostRecent().args[2] as () => void)();
            expect(getSystemMail).toHaveBeenCalledTimes(2);
            expect(toast.success).not.toHaveBeenCalled();
        });

        it('is there for a stopped mailbox, and not when no mailbox is chosen', () => {
            getSystemMail.and.returnValue(of({ ...SENDING, state: 'stopped', stopReason: 'mailbox-needs-reconnect' }));
            expect(button(render())).not.toBeNull();

            getSystemMail.and.returnValue(of({ ...SENDING, state: 'none', mailboxId: null }));
            expect(button(render())).toBeNull();
        });

        it('is not there when the state was not read: refused for want of elevation, or not read at all', () => {
            const stamped = new HttpErrorResponse({ status: 403, headers: new HttpHeaders({ [ELEVATION_REQUIRED_HEADER]: '1' }) });
            getSystemMail.and.returnValue(throwError(() => stamped));
            const f = render();
            expect(elevateButton(f)).not.toBeNull();
            expect(button(f)).toBeNull();

            getSystemMail.and.returnValue(throwError(() => new Error('500')));
            expect(button(render())).toBeNull();

            getSystemMail.and.returnValue(of(SENDING));
            const read = render();
            expect(button(read)).not.toBeNull();
            getSystemMail.and.returnValue(throwError(() => stamped));
            read.componentInstance.readState();
            read.detectChanges();
            expect(button(read)).withContext('gone once a later read is refused').toBeNull();
        });
    });

    describe('an address that names a mailbox', () => {
        /** Lets the address's own change be made. */
        const settle = async (): Promise<void> => {
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve));
            }
        };
        const visit = async (query: string): Promise<ComponentFixture<SystemMailTestPaneComponent>> => {
            await TestBed.inject(Router).navigateByUrl(`${PAGE}${query}`);
            const f = render();
            await settle();
            return f;
        };
        const address = (): string => TestBed.inject(Location).path();
        const opened = (): unknown[][] => open.calls.allArgs().map(a => a.slice(0, 2));

        it('connected: the system mailbox\'s settings open, the sign-in is said, and the address is cleared', async () => {
            await visit('?oauth=connected&mailbox=m-1');

            expect(opened()).toEqual([['m-1', 'general']]);
            expect(toast.success).toHaveBeenCalledOnceWith('Mailbox connected.');
            expect(toast.error).not.toHaveBeenCalled();
            expect(address()).toBe(PAGE);
        });

        for (const outcome of ['denied', 'error', 'auth_failed', 'unreachable']) {
            it(`${outcome}: the settings open, and the sign-in is said not to have been made`, async () => {
                await visit(`?oauth=${outcome}&mailbox=m-1`);

                expect(opened()).toEqual([['m-1', 'general']]);
                expect(toast.error).toHaveBeenCalledOnceWith('The account was not connected — nothing was saved. Please try again.');
                expect(toast.success).not.toHaveBeenCalled();
                expect(address()).toBe(PAGE);
            });
        }

        it('a pane named opens on it, nothing said; an unknown one is the dialog\'s to put right', async () => {
            await visit('?mailbox=m-1&settings=connection');
            expect(opened()).toEqual([['m-1', 'connection']]);
            expect(toast.success).not.toHaveBeenCalled();
            expect(toast.error).not.toHaveBeenCalled();
            expect(address()).toBe(PAGE);
        });

        it('only what was asked leaves the address', async () => {
            await visit('?mailbox=m-1&settings=sync&oauth=connected&other=kept');
            expect(address()).toBe(`${PAGE}?other=kept`);
        });

        it('a reload after that asks nothing again', async () => {
            await visit('?oauth=connected&mailbox=m-1');
            const again = render();
            await settle();
            again.componentInstance.readState();

            expect(open).toHaveBeenCalledTimes(1);
            expect(toast.success).toHaveBeenCalledTimes(1);
        });

        it('another mailbox\'s id does nothing, now or when the state is read again', async () => {
            const f = await visit('?oauth=connected&mailbox=m-2');
            expect(open).not.toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();
            expect(address()).toBe(`${PAGE}?oauth=connected&mailbox=m-2`);

            getSystemMail.and.returnValue(of({ ...SENDING, mailboxId: 'm-2' }));
            f.componentInstance.readState();
            expect(open).not.toHaveBeenCalled();
        });

        it('no query, an outcome with no mailbox, or no system mailbox: nothing', async () => {
            (await visit('')).destroy();
            (await visit('?oauth=connected')).destroy();
            getSystemMail.and.returnValue(of({ ...SENDING, state: 'none', mailboxId: null }));
            await visit('?mailbox=m-1&settings=sync');

            expect(open).not.toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();
            expect(toast.error).not.toHaveBeenCalled();
        });

        it('waits for an elevated session where the state needs one, then does it once', async () => {
            const stamped = new HttpErrorResponse({ status: 403, headers: new HttpHeaders({ [ELEVATION_REQUIRED_HEADER]: '1' }) });
            getSystemMail.and.returnValue(throwError(() => stamped));
            const f = await visit('?oauth=connected&mailbox=m-1');
            expect(open).not.toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();
            expect(address()).withContext('kept until it is used').toBe(`${PAGE}?oauth=connected&mailbox=m-1`);

            getSystemMail.and.returnValue(of(SENDING));
            elevateButton(f)!.click();
            await settle();
            expect(opened()).toEqual([['m-1', 'general']]);
            expect(toast.success).toHaveBeenCalledTimes(1);
            expect(address()).toBe(PAGE);
        });

        it('one gone to while the page is open, as a notification\'s link, does the same', async () => {
            await visit('');
            await TestBed.inject(Router).navigateByUrl(`${PAGE}?mailbox=m-1&settings=connection`);
            await settle();

            expect(opened()).toEqual([['m-1', 'connection']]);
            expect(address()).toBe(PAGE);
        });
    });
});
