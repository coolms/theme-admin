import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { BehaviorSubject, of } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxSettingsPageComponent } from './mailbox-settings.page';

/**
 * A mailbox's settings, in the settings shell's object scope: the mailbox and what the caller may do to it are read
 * together; the URL chooses the pane and each pane saves on its own; someone who may only read the settings sees them
 * so, with no Save and no Delete; Access is a shared mailbox's; Delete is the last pane, asks first and returns to
 * Mail.
 */
describe('MailboxSettingsPageComponent -- one mailbox\'s settings, a pane at a time', () => {
    const MAILBOX: EmailMailboxDto = {
        id: 'mb-1', label: 'Support', emailAddress: 'support@example.test', kind: 'personal',
        imapHost: 'imap.example.test', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.example.test',
        smtpPort: 465, smtpSecurity: 'ssl', enabled: true, authMethod: 'password', version: 'v7',
    };
    let email: jasmine.SpyObj<EmailService>;
    let router: Router;
    let navigate: jasmine.Spy;
    let params: BehaviorSubject<ParamMap>;
    let confirmed: boolean;
    let asked: { title?: string; message?: string } | null;

    function render(mailbox: EmailMailboxDto, update: 'allowed' | 'elevate' | 'denied', pane: string | null = null) {
        email.getMailbox.and.returnValue(of(mailbox));
        email.mailboxCapabilities.and.returnValue(of({ 'email.mailbox.update': update, 'email.mailbox.authorize': update }));
        params.next(convertToParamMap(null === pane ? { id: 'mb-1' } : { id: 'mb-1', pane }));
        const fixture = TestBed.createComponent(MailboxSettingsPageComponent);
        fixture.detectChanges();
        return fixture;
    }

    const panes = (host: HTMLElement) =>
        Array.from(host.querySelectorAll('.cms-settings-shell__item')).map(b => (b.textContent ?? '').trim());
    const buttons = (host: HTMLElement) =>
        Array.from(host.querySelectorAll('cms-settings-pane button')).map(b => (b.textContent ?? '').trim());

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', [
            'getMailbox', 'mailboxCapabilities', 'deleteMailbox', 'listInboundWorkflowOptions', 'listDelegations',
            'saveMailboxSection', 'authorizeMailbox', 'testMailbox',
        ]);
        email.listInboundWorkflowOptions.and.returnValue(of([]));
        email.listDelegations.and.returnValue(of([]));
        email.deleteMailbox.and.returnValue(of({}));
        email.testMailbox.and.returnValue(of({ imap: { ok: true }, smtp: { ok: true } }));
        params = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'mb-1' }));
        confirmed = true;
        asked = null;
        TestBed.configureTestingModule({
            imports: [MailboxSettingsPageComponent],
            providers: [
                provideRouter([]),
                { provide: EmailService, useValue: email },
                { provide: ActivatedRoute, useValue: { paramMap: params } },
                { provide: ConfirmDialogService, useValue: { open: (o: { title?: string; message?: string }) => { asked = o; return of(confirmed); } } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'show']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ElevationService, useValue: { elevated: () => false, offerFor: () => of(true) } },
                // The delegations card reads the API base from the manifest.
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        router = TestBed.inject(Router);
        navigate = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    });

    it('reads the mailbox and the caller\'s answer for it together, and lists its panes, Delete last', () => {
        const host = render(MAILBOX, 'allowed').nativeElement as HTMLElement;

        expect(email.getMailbox).toHaveBeenCalledOnceWith('mb-1');
        expect(email.mailboxCapabilities).toHaveBeenCalledOnceWith('mb-1');
        expect(panes(host)).toEqual(['General', 'Connection', 'Sync', 'Rules', 'Delete this mailbox']);
    });

    it('the URL chooses the pane; picking one changes the URL, and an unknown pane goes to the first', () => {
        const fixture = render(MAILBOX, 'allowed', 'sync');
        const host = fixture.nativeElement as HTMLElement;
        expect(host.querySelector('[name=enabled]')).not.toBeNull();
        expect(host.querySelector('[name=imapHost]')).toBeNull();

        fixture.componentInstance.open('rules');
        expect(navigate).toHaveBeenCalledWith(['/email/mailboxes', 'mb-1', 'settings', 'rules']);

        params.next(convertToParamMap({ id: 'mb-1', pane: 'nonsense' }));
        expect(navigate).toHaveBeenCalledWith(['/email/mailboxes', 'mb-1', 'settings'], { replaceUrl: true });
    });

    it('settings the caller may only read: said at the top, fields disabled, no Save, no Delete', () => {
        const host = render(MAILBOX, 'denied').nativeElement as HTMLElement;

        expect(host.textContent).toContain('You can read these settings; only the mailbox\'s owners can change them.');
        expect(panes(host)).not.toContain('Delete this mailbox');
        expect(Array.from(host.querySelectorAll('fieldset')).every(f => (f as HTMLFieldSetElement).disabled)).toBeTrue();
        expect(buttons(host)).not.toContain('Save');
    });

    it('Access is a shared mailbox\'s, and only for someone who may change it', () => {
        expect(panes(render(MAILBOX, 'allowed').nativeElement)).not.toContain('Access');
        expect(panes(render({ ...MAILBOX, kind: 'shared' }, 'allowed').nativeElement)).toContain('Access');
        expect(panes(render({ ...MAILBOX, kind: 'shared' }, 'denied').nativeElement)).not.toContain('Access');
    });

    it('a delegate reads the settings, told it reads them as a delegate', () => {
        const host = render({ ...MAILBOX, access: 'read_only' }, 'denied').nativeElement as HTMLElement;

        expect(host.textContent).toContain('You read this mailbox as a delegate (read only)');
        expect(panes(host)).not.toContain('Delete this mailbox');
    });

    it('a pane saves on its own: Save is off until it changes, and saves only that pane\'s fields', async () => {
        const fixture = render(MAILBOX, 'allowed', 'sync');
        // ngModel writes the read into the controls asynchronously: click only once the box shows it.
        await fixture.whenStable();
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        const save = () => Array.from(host.querySelectorAll('cms-settings-pane button'))
            .find(b => 'Save' === (b.textContent ?? '').trim()) as HTMLButtonElement;
        expect(save().disabled).toBeTrue();

        email.saveMailboxSection.and.returnValue(of({ ...MAILBOX, enabled: false, version: 'v8' }));
        const box = host.querySelector('[name=enabled]') as HTMLInputElement;
        box.click();
        fixture.detectChanges();
        expect(save().disabled).toBeFalse();
        save().click();

        expect(email.saveMailboxSection).toHaveBeenCalledOnceWith('mb-1', { enabled: false }, 'v7');
    });

    it('Test connection is the Connection pane\'s, in its footer, and saves nothing', () => {
        const fixture = render(MAILBOX, 'allowed', 'connection');
        const host = fixture.nativeElement as HTMLElement;
        const test = Array.from(host.querySelectorAll('cms-settings-pane button'))
            .find(b => 'Test connection' === (b.textContent ?? '').trim()) as HTMLButtonElement;

        test.click();
        fixture.detectChanges();

        expect(email.testMailbox).toHaveBeenCalledTimes(1);
        expect(email.saveMailboxSection).not.toHaveBeenCalled();
        expect(host.textContent).toContain('Incoming (IMAP): connected');
    });

    it('deleting is the last pane, a danger one, and its question names what goes and what stays', () => {
        const fixture = render(MAILBOX, 'allowed', 'delete');
        const host = fixture.nativeElement as HTMLElement;
        expect(buttons(host)).toEqual(['Delete this mailbox']);

        confirmed = false;
        fixture.componentInstance.remove(MAILBOX);
        expect(asked?.title).toBe('Delete "Support"?');
        expect(asked?.message).toContain("CoolMS's copies of its mail, its rules and its settings are deleted.");
        expect(asked?.message).toContain('The account at the mail provider is not touched');
    });

    it('removing asks first; confirmed, the mailbox is deleted and the page returns to Mail', () => {
        const page = render(MAILBOX, 'allowed').componentInstance;

        confirmed = false;
        page.remove(MAILBOX);
        expect(email.deleteMailbox).not.toHaveBeenCalled();

        confirmed = true;
        page.remove(MAILBOX);
        expect(email.deleteMailbox).toHaveBeenCalledOnceWith('mb-1');
        expect(navigate).toHaveBeenCalledWith(['/email']);
    });
});
