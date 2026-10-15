import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxSettingsPageComponent } from './mailbox-settings.page';

/**
 * A mailbox's settings page: the mailbox and what the caller may do to it are read together; its sections save on
 * their own; someone who may only read the settings sees them so; Access is a shared mailbox's; removing a mailbox
 * asks first and returns to Mail.
 */
describe('MailboxSettingsPageComponent -- one mailbox\'s settings, a page of sections', () => {
    const MAILBOX: EmailMailboxDto = {
        id: 'mb-1', label: 'Support', emailAddress: 'support@example.test', kind: 'personal',
        imapHost: 'imap.example.test', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.example.test',
        smtpPort: 465, smtpSecurity: 'ssl', enabled: true, authMethod: 'password', version: 'v7',
    };
    let email: jasmine.SpyObj<EmailService>;
    let router: jasmine.SpyObj<Router>;
    let confirmed: boolean;

    function render(mailbox: EmailMailboxDto, update: 'allowed' | 'elevate' | 'denied') {
        email.getMailbox.and.returnValue(of(mailbox));
        email.mailboxCapabilities.and.returnValue(of({ 'email.mailbox.update': update, 'email.mailbox.authorize': update }));
        const fixture = TestBed.createComponent(MailboxSettingsPageComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', [
            'getMailbox', 'mailboxCapabilities', 'deleteMailbox', 'listInboundWorkflowOptions', 'listDelegations',
            'saveMailboxSection', 'authorizeMailbox',
        ]);
        email.listInboundWorkflowOptions.and.returnValue(of([]));
        email.listDelegations.and.returnValue(of([]));
        email.deleteMailbox.and.returnValue(of({}));
        confirmed = true;
        TestBed.configureTestingModule({
            imports: [MailboxSettingsPageComponent],
            providers: [
                provideRouter([]),
                { provide: EmailService, useValue: email },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'mb-1' }) } } },
                { provide: ConfirmDialogService, useValue: { open: () => of(confirmed) } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'show']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ElevationService, useValue: { elevated: () => false, offerFor: () => of(true) } },
                // The delegations card reads the API base from the manifest.
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
        spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    });

    it('reads the mailbox and the caller\'s answer for it together, and shows its sections', () => {
        const host = render(MAILBOX, 'allowed').nativeElement as HTMLElement;

        expect(email.getMailbox).toHaveBeenCalledOnceWith('mb-1');
        expect(email.mailboxCapabilities).toHaveBeenCalledOnceWith('mb-1');
        expect(Array.from(host.querySelectorAll('h2')).map(h => h.textContent?.trim()))
            .toEqual(['Mailbox', 'Connection', 'When mail arrives']);
    });

    it('settings the caller may only read: said once at the top, no section saves, no removal', () => {
        const host = render(MAILBOX, 'denied').nativeElement as HTMLElement;

        expect(host.textContent).toContain('You can read these settings; only the mailbox\'s owners can change them.');
        expect(host.textContent).not.toContain('Remove this mailbox');
        expect(Array.from(host.querySelectorAll('fieldset')).every(f => (f as HTMLFieldSetElement).disabled)).toBeTrue();
    });

    it('Access is a shared mailbox\'s, and only for someone who may change it', () => {
        expect((render(MAILBOX, 'allowed').nativeElement as HTMLElement).textContent).not.toContain('Access');
        expect((render({ ...MAILBOX, kind: 'shared' }, 'allowed').nativeElement as HTMLElement).textContent).toContain('Access');
        expect((render({ ...MAILBOX, kind: 'shared' }, 'denied').nativeElement as HTMLElement).textContent).not.toContain('Access');
    });

    it('removing asks first; confirmed, the mailbox is deleted and the page returns to Mail', () => {
        const page = render(MAILBOX, 'allowed').componentInstance;

        confirmed = false;
        page.remove(MAILBOX);
        expect(email.deleteMailbox).not.toHaveBeenCalled();

        confirmed = true;
        page.remove(MAILBOX);
        expect(email.deleteMailbox).toHaveBeenCalledOnceWith('mb-1');
        expect(router.navigate).toHaveBeenCalledOnceWith(['/email']);
    });
});
