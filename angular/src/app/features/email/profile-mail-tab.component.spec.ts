import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import {
    MAIL_PREFERENCE_DEFAULTS,
    MailPreferences,
    MailPreferencesChangedError,
    MailPreferencesService,
} from './mail-preferences.service';
import { ProfileMailTabComponent, mailPreferencesPatch } from './profile-mail-tab.component';

/**
 * The Mail pane of My Profile: the default mailbox (only one the person may send from) and remote images, read with
 * the section's version and saved naming it. A section saved elsewhere since is said with Reload and not saved over; a
 * change the server did not keep is said; a section that could not be read shows no form to save over it.
 */
describe('ProfileMailTabComponent -- the mail settings, saved over the version read', () => {
    const MAILBOXES: EmailMailboxDto[] = [
        { id: 'own', label: 'Mine', access: 'owner' },
        { id: 'sends', label: 'Shared, read and send', access: 'read_and_send' },
        { id: 'reads', label: 'Shared, read only', access: 'read_only' },
        { id: 'managed', label: 'Managed', access: 'manager' },
    ];
    let prefs: { read: jasmine.Spy; save: jasmine.Spy };
    let toast: jasmine.SpyObj<ToastService>;

    function render(read = of({ prefs: MAIL_PREFERENCE_DEFAULTS, version: 's1' })): ComponentFixture<ProfileMailTabComponent> {
        prefs.read.and.returnValue(read);
        const f = TestBed.createComponent(ProfileMailTabComponent);
        f.detectChanges();
        return f;
    }

    beforeEach(() => {
        prefs = { read: jasmine.createSpy('read'), save: jasmine.createSpy('save') };
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
        TestBed.configureTestingModule({
            imports: [ProfileMailTabComponent],
            providers: [
                { provide: MailPreferencesService, useValue: prefs },
                { provide: EmailService, useValue: { listReadableMailboxes: () => of(MAILBOXES) } },
                { provide: ToastService, useValue: toast },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
            ],
        });
    });

    it('offers as default only a mailbox the person may send from', () => {
        const f = render();
        const options = Array.from((f.nativeElement as HTMLElement).querySelectorAll('#mail-default option')).map(o => o.textContent?.trim());

        expect(options).toEqual(['None', 'Mine', 'Shared, read and send']);
    });

    it('saves only what changed, naming the version read; the answer becomes the read', () => {
        const stood: MailPreferences = { ...MAIL_PREFERENCE_DEFAULTS, defaultMailboxId: 'own' };
        prefs.save.and.returnValue(of({ prefs: stood, version: 's2' }));
        const tab = render().componentInstance;

        tab.set('defaultMailboxId', 'own');
        tab.save();

        expect(prefs.save).toHaveBeenCalledOnceWith({ defaultMailboxId: 'own' }, 's1');
        expect(tab.read()).toEqual(stood);
        expect(tab.dirty()).toBeFalse();
        expect(toast.success).toHaveBeenCalled();
    });

    it('saved elsewhere since: said, Save off, nothing sent again; Reload reads it again', () => {
        prefs.save.and.returnValue(throwError(() => new MailPreferencesChangedError()));
        const f = render();
        const tab = f.componentInstance;

        tab.set('remoteImages', 'block');
        tab.save();
        f.detectChanges();

        expect(tab.changedElsewhere()).toBeTrue();
        expect((f.nativeElement as HTMLElement).textContent).toContain('saved somewhere else since you opened them');
        tab.save();
        expect(prefs.save).withContext('a refused save is not sent again, even when asked').toHaveBeenCalledTimes(1);
        const saveButton = Array.from((f.nativeElement as HTMLElement).querySelectorAll('button'))
            .find(b => b.textContent?.includes('Save changes')) as HTMLButtonElement;
        expect(saveButton.disabled).toBeTrue();

        prefs.read.calls.reset();
        tab.load();
        expect(prefs.read).toHaveBeenCalledTimes(1);
        expect(tab.changedElsewhere()).toBeFalse();
    });

    it('a change the server did not keep is said, not shown as saved', () => {
        prefs.save.and.returnValue(of({ prefs: MAIL_PREFERENCE_DEFAULTS, version: 's2' }));
        const f = render();
        const tab = f.componentInstance;

        tab.set('defaultMailboxId', 'sends');
        tab.save();
        f.detectChanges();

        expect(tab.notStored()).toEqual(['The default mailbox was not stored: it is not one you may send from.']);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('a section that could not be read shows no form to save over it', () => {
        const f = render(throwError(() => new Error('down')));
        const host = f.nativeElement as HTMLElement;

        expect(f.componentInstance.unreadable()).toBeTrue();
        expect(host.querySelector('#mail-default')).toBeNull();
        expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.includes('Save changes'))).toBeFalse();
    });

    it('the patch holds only the fields that differ from the read', () => {
        expect(mailPreferencesPatch(MAIL_PREFERENCE_DEFAULTS, MAIL_PREFERENCE_DEFAULTS)).toEqual({});
        expect(mailPreferencesPatch(MAIL_PREFERENCE_DEFAULTS, { ...MAIL_PREFERENCE_DEFAULTS, remoteImages: 'allow' }))
            .toEqual({ remoteImages: 'allow' });
    });
});
