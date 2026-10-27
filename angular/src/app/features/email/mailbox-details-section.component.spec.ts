import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxDetailsSectionComponent, kindOf } from './mailbox-details-section.component';

/**
 * General holds whose a mailbox is next to its name and address. Making a personal mailbox shared is how it is handed
 * to the organisation; the save sends the kind only when it changed, at the version the settings were read.
 */
describe('MailboxDetailsSectionComponent -- whose the mailbox is', () => {
    const MAILBOX: EmailMailboxDto = {
        id: 'mb-1', label: 'Notifications', emailAddress: 'notifications@example.test', kind: 'personal', version: 'v3',
    };
    let email: jasmine.SpyObj<EmailService>;

    function render(mailbox: EmailMailboxDto) {
        const fixture = TestBed.createComponent(MailboxDetailsSectionComponent);
        fixture.componentRef.setInput('mailbox', mailbox);
        fixture.componentRef.setInput('access', 'allowed');
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', ['saveMailboxSection']);
        TestBed.configureTestingModule({
            imports: [MailboxDetailsSectionComponent],
            providers: [
                { provide: EmailService, useValue: email },
                { provide: ToastService, useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'show']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ElevationService, useValue: { elevated: () => false, offerFor: () => of(true) } },
            ],
        });
    });

    it('a read without a kind is personal, as the server defaults it', () => {
        expect(kindOf({ id: 'mb-2' })).toBe('personal');
        expect(kindOf({ id: 'mb-2', kind: 'shared' })).toBe('shared');
    });

    it('shows the kind as read, and an untouched pane sends nothing', () => {
        const fixture = render({ ...MAILBOX, kind: 'shared' });
        const select = (fixture.nativeElement as HTMLElement).querySelector('select[name="kind"]') as HTMLSelectElement;

        expect(fixture.componentInstance.kind()).toBe('shared');
        expect(select).withContext('the pane draws the kind').not.toBeNull();
        expect(fixture.componentInstance.dirty()).toBeFalse();
    });

    it('handing a personal mailbox over sends only the kind, at the version it was read', () => {
        const answer = { ...MAILBOX, kind: 'shared', version: 'v4' };
        email.saveMailboxSection.and.returnValue(of(answer));
        const fixture = render(MAILBOX);
        const section = fixture.componentInstance;
        const saved = jasmine.createSpy('saved');
        section.saved.subscribe(saved);

        section.kind.set('shared');
        section.save();

        expect(email.saveMailboxSection).toHaveBeenCalledOnceWith('mb-1', { kind: 'shared' }, 'v3');
        expect(saved).toHaveBeenCalledOnceWith(answer);
    });

    it('Discard puts the kind back as read', () => {
        const fixture = render(MAILBOX);
        const section = fixture.componentInstance;

        section.kind.set('shared');
        expect(section.dirty()).toBeTrue();
        section.discard();

        expect(section.kind()).toBe('personal');
        expect(section.dirty()).toBeFalse();
    });

    it('another section\'s save keeps a kind chosen here and not saved', () => {
        const fixture = render(MAILBOX);
        const section = fixture.componentInstance;

        section.kind.set('shared');
        fixture.componentRef.setInput('mailbox', { ...MAILBOX, label: 'Renamed elsewhere', version: 'v4' });
        fixture.detectChanges();

        expect(section.kind()).toBe('shared');
        expect(section.label()).toBe('Renamed elsewhere');
    });
});
