import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import {
    MailboxConnectionSectionComponent,
    connectionDraftOf,
    connectionPatch,
    connectionStatusOf,
} from './mailbox-connection-section.component';

/**
 * A mailbox's Connection settings are saved on their own, naming the version they were read at, and only the fields
 * the person changed: a field someone else changed meanwhile is never written back from this read. Settings changed
 * since are refused (412), said, and Reload offered; a read without a version saves nothing. What the caller may do is
 * the server's answer: `denied` shows them read-only.
 */
describe('MailboxConnectionSectionComponent -- a section saved on its own, at the version it was read', () => {
    const MAILBOX: EmailMailboxDto = {
        id: 'mb-1', label: 'Support', emailAddress: 'support@example.test',
        imapHost: 'imap.example.test', imapPort: 993, imapSecurity: 'ssl', imapUsername: 'support@example.test',
        smtpHost: 'smtp.example.test', smtpPort: 465, smtpSecurity: 'ssl', smtpUsername: 'support@example.test',
        enabled: true, authMethod: 'password', hasCredential: true, connectionKind: 'ok', version: 'v7',
    };

    describe('what a save sends', () => {
        it('nothing changed: an empty patch', () => {
            expect(connectionPatch(MAILBOX, connectionDraftOf(MAILBOX), '')).toEqual({});
        });

        it('only the changed fields, and a password only when one was typed', () => {
            const draft = { ...connectionDraftOf(MAILBOX), imapPort: 143, imapSecurity: 'starttls' as const };

            expect(connectionPatch(MAILBOX, draft, '')).toEqual({ imapPort: 143, imapSecurity: 'starttls' });
            expect(connectionPatch(MAILBOX, draft, 'new secret')).toEqual({
                imapPort: 143, imapSecurity: 'starttls', password: 'new secret',
            });
            expect(connectionPatch(MAILBOX, connectionDraftOf(MAILBOX), '   ')).toEqual({});
        });
    });

    it('says the last fetch in words, a stopped mailbox with its reason', () => {
        expect(connectionStatusOf(MAILBOX).text).toBe('Connected');
        expect(connectionStatusOf({ ...MAILBOX, connectionKind: 'permanent', connectionErrorKind: 'auth_refused' }))
            .toEqual({ tone: 'stop', text: 'Stopped: the server refused the sign-in' });
        expect(connectionStatusOf({ ...MAILBOX, connectionKind: null }).text).toBe('Not fetched yet');
    });

    describe('saving', () => {
        let email: jasmine.SpyObj<EmailService>;
        let toast: jasmine.SpyObj<ToastService>;

        function render(mailbox: EmailMailboxDto, access: 'allowed' | 'elevate' | 'denied' = 'allowed') {
            const fixture = TestBed.createComponent(MailboxConnectionSectionComponent);
            fixture.componentRef.setInput('mailbox', mailbox);
            fixture.componentRef.setInput('access', access);
            fixture.detectChanges();
            return fixture;
        }

        beforeEach(() => {
            email = jasmine.createSpyObj<EmailService>('EmailService', ['saveMailboxSection', 'authorizeMailbox']);
            toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'show']);
            TestBed.configureTestingModule({
                imports: [MailboxConnectionSectionComponent],
                providers: [
                    { provide: EmailService, useValue: email },
                    { provide: ToastService, useValue: toast },
                    { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                    { provide: ElevationService, useValue: { elevated: () => false, offerFor: () => of(true) } },
                ],
            });
        });

        it('names the version it was read at, sends only the change, and hands the answer back as the new read', () => {
            const answer = { ...MAILBOX, imapPort: 143, version: 'v8' };
            email.saveMailboxSection.and.returnValue(of(answer));
            const fixture = render(MAILBOX);
            const section = fixture.componentInstance;
            const saved = jasmine.createSpy('saved');
            section.saved.subscribe(saved);

            section.set('imapPort', 143);
            section.save();

            expect(email.saveMailboxSection).toHaveBeenCalledOnceWith('mb-1', { imapPort: 143 }, 'v7');
            expect(saved).toHaveBeenCalledOnceWith(answer);
        });

        it('settings changed since they were read: refused, said, Reload offered, nothing sent again', () => {
            email.saveMailboxSection.and.returnValue(throwError(() => new HttpErrorResponse({ status: 412 })));
            const fixture = render(MAILBOX);
            const section = fixture.componentInstance;
            const reload = jasmine.createSpy('reload');
            section.reload.subscribe(reload);

            section.set('smtpHost', 'mail.example.test');
            section.save();

            expect(email.saveMailboxSection).toHaveBeenCalledTimes(1);
            const shown = toast.show.calls.mostRecent().args[0] as { title: string; action: { run: () => void } };
            expect(shown.title).toBe('These settings were changed since they were read');
            shown.action.run();
            expect(reload).toHaveBeenCalledTimes(1);
        });

        it('a read without a version: no Save, and it says why', () => {
            const fixture = render({ ...MAILBOX, version: undefined });
            const host = fixture.nativeElement as HTMLElement;

            expect(host.textContent).toContain('read without a version, so they cannot be saved here');
            expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.includes('Save connection'))).toBeFalse();
        });

        it('settings the caller may only read: every field disabled, no Save, and it says who can change them', () => {
            const fixture = render(MAILBOX, 'denied');
            const host = fixture.nativeElement as HTMLElement;

            expect((host.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBeTrue();
            expect(host.textContent).toContain('Only the mailbox\'s owners can change these settings.');
            expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.includes('Save connection'))).toBeFalse();
        });

        it('a save the server answers "elevate" for asks for an elevated session first, then saves', () => {
            email.saveMailboxSection.and.returnValue(of(MAILBOX));
            const fixture = render(MAILBOX, 'elevate');
            const section = fixture.componentInstance;

            section.set('enabled', false);
            section.save();

            expect(email.saveMailboxSection).toHaveBeenCalledOnceWith('mb-1', { enabled: false }, 'v7');
        });

        it('the sync depth appears only when the read carries it', () => {
            expect((render(MAILBOX).nativeElement as HTMLElement).querySelector('[name=backfillDepthMonths]')).toBeNull();
            expect((render({ ...MAILBOX, backfillDepthMonths: 6 } as EmailMailboxDto).nativeElement as HTMLElement)
                .querySelector('[name=backfillDepthMonths]')).not.toBeNull();
        });
    });
});
