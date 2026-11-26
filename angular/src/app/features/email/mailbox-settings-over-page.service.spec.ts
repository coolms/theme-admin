import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, of, throwError } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailLiveEventsService } from './email-live-events.service';
import { EmailService } from './email.service';
import type { EmailMailboxDto } from './email.types';
import { MailboxSettingsOverPage } from './mailbox-settings-over-page.service';

@Component({ selector: 'app-over-page-host', standalone: true, template: '', providers: [MailboxSettingsOverPage] })
class HostComponent {
    readonly settings = inject(MailboxSettingsOverPage);
}

/** The system mailbox as an administrator who does not own it reads it, by its id. */
const MAILBOX: EmailMailboxDto = {
    id: 'm-1', label: 'Notifications', emailAddress: 'notifications@example.test', kind: 'shared', access: 'manager',
    imapHost: 'imap.example.test', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.example.test', smtpPort: 465,
    smtpSecurity: 'ssl', enabled: true, authMethod: 'oauth', oauthProvider: 'google', oauthConnected: false, version: 'v7',
};
const REFUSED = new HttpErrorResponse({ status: 403, error: { type: 'about:blank', detail: 'Access Denied.' } });

/**
 * A mailbox's settings opened over a page by the mailbox's id: the real dialog. The mailbox is in no list, and what
 * reads its mail (its addresses, its folders) is refused: those are not offered, nothing is said of them, and the rest
 * works, Reconnect included. It closes cleanly, asking first while a pane is dirty, and never touches the address.
 */
describe('MailboxSettingsOverPage -- a mailbox\'s settings over another page', () => {
    let email: jasmine.SpyObj<EmailService>;
    let toast: jasmine.SpyObj<ToastService>;
    let discard: boolean;
    let asked: number;
    let closed: number;
    let host: ComponentFixture<HostComponent>;

    const dialog = (): HTMLElement | null => document.querySelector('app-mailbox-settings-dialog');
    const panes = (): string[] =>
        Array.from(dialog()?.querySelectorAll('.cms-settings-shell__item') ?? []).map(b => (b.textContent ?? '').trim());
    const pick = async (name: string): Promise<void> => {
        Array.from(dialog()!.querySelectorAll<HTMLElement>('.cms-settings-shell__item')).find(b => b.textContent?.trim() === name)!.click();
        await settle();
    };
    const press = (text: string): HTMLButtonElement | undefined =>
        Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('cms-settings-pane button')).find(b => b.textContent?.trim() === text);
    async function settle(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            host.detectChanges();
            await host.whenStable();
            await new Promise(resolve => setTimeout(resolve));
        }
    }
    async function open(pane = 'general'): Promise<void> {
        await host.componentInstance.settings.open('m-1', pane, () => closed++);
        await settle();
    }

    beforeEach(() => {
        discard = true;
        asked = 0;
        closed = 0;
        // No call that lists mailboxes, folders or messages is there to be made, but the filters' folders, refused.
        email = jasmine.createSpyObj<EmailService>('EmailService', [
            'getMailbox', 'mailboxCapabilities', 'listInboundWorkflowOptions', 'listDelegations', 'listAliases', 'getSendAs',
            'listFilters', 'listFilterFolders', 'listFolders', 'authorizeMailbox', 'deleteMailbox',
        ]);
        email.getMailbox.and.returnValue(of(MAILBOX));
        email.mailboxCapabilities.and.returnValue(of({ 'email.mailbox.update': 'allowed', 'email.mailbox.authorize': 'allowed' }));
        email.listInboundWorkflowOptions.and.returnValue(of([]));
        email.listDelegations.and.returnValue(of([]));
        email.listFilters.and.returnValue(of([]));
        email.listAliases.and.returnValue(throwError(() => REFUSED));
        email.getSendAs.and.returnValue(throwError(() => REFUSED));
        email.listFilterFolders.and.returnValue(throwError(() => REFUSED));
        email.listFolders.and.returnValue(throwError(() => REFUSED));
        email.authorizeMailbox.and.returnValue(of({ authorizationUrl: '' }));
        email.deleteMailbox.and.returnValue(of({}));
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'show']);
        TestBed.configureTestingModule({
            imports: [HostComponent],
            providers: [
                provideRouter([]),
                provideLocationMocks(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: EmailService, useValue: email },
                { provide: ToastService, useValue: toast },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'Access Denied.' } },
                { provide: ElevationService, useValue: { elevated: () => true, offerFor: () => of(true) } },
                { provide: ConfirmDialogService, useValue: { confirmDiscard: () => { asked++; return of(discard); }, open: () => of(true) } },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        host = TestBed.createComponent(HostComponent);
    });
    afterEach(() => host.destroy());

    it('opens on the pane asked, by the id alone, with every pane but the addresses; nothing is said of what is refused', async () => {
        await open('connection');

        expect(email.getMailbox).toHaveBeenCalledOnceWith('m-1');
        expect(panes()).toEqual(['General', 'Connection', 'Sync', 'Filters', 'Rules', 'Access', 'Delete this mailbox']);
        expect(dialog()!.textContent).toContain('Incoming (IMAP)');
        expect(dialog()!.textContent).not.toContain('Access Denied.');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('a refused pane asked for is the first one; an unknown pane too', async () => {
        await open('addresses');
        expect(dialog()!.querySelector('app-mailbox-aliases-section')).toBeNull();
        expect(dialog()!.querySelector('app-mailbox-details-section')).not.toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
        await host.componentInstance.settings.open('m-1', 'nonsense');
        await settle();
        expect(dialog()!.querySelector('app-mailbox-details-section')).not.toBeNull();
    });

    it('the rest works: Reconnect starts the sign-in, filters and access are read, and no folder is spoken of', async () => {
        await open('connection');
        press('Connect')!.click();
        expect(email.authorizeMailbox).toHaveBeenCalledOnceWith('m-1');

        await pick('Filters');
        expect(email.listFilters).toHaveBeenCalledOnceWith('m-1');
        press('Add a filter')!.click();
        await settle();
        expect(dialog()!.textContent).not.toContain('could not be read');
        expect(dialog()!.textContent).not.toContain('Access Denied.');

        discard = true;
        await pick('Access');
        expect(dialog()!.querySelector('app-email-delegations-card')).not.toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('whoever may read the addresses is offered them', async () => {
        email.listAliases.and.returnValue(of({ canManage: true, aliases: [] }));
        await open('addresses');
        expect(panes()).toContain('Addresses you send from');
        expect(dialog()!.querySelector('app-mailbox-aliases-section')).not.toBeNull();
    });

    it('closes from its button, saying so, with the address as it was', async () => {
        const before = TestBed.inject(Location).path();
        await open();
        dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
        await settle();

        expect(dialog()).toBeNull();
        expect(closed).toBe(1);
        expect(asked).withContext('a clean pane closes without a question').toBe(0);
        expect(TestBed.inject(Location).path()).toBe(before);

        await open();
        expect(dialog()).withContext('and opens again').not.toBeNull();
    });

    it('unsaved changes: closing, the scrim and another pane ask; Keep editing keeps them, Discard goes', async () => {
        await open('sync');
        dialog()!.querySelector<HTMLInputElement>('[name=enabled]')!.click();
        await settle();
        discard = false;
        dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
        await settle();
        document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
        await settle();
        await pick('Rules');
        expect(asked).toBe(3);
        expect(dialog()!.querySelector('[name=enabled]')).withContext('still on Sync').not.toBeNull();

        discard = true;
        dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
        await settle();
        expect(dialog()).toBeNull();
        expect(closed).toBe(1);
    });

    it('a mailbox deleted closes them; so does the page that opened them going away', async () => {
        await open('delete');
        press('Delete this mailbox')!.click();
        await settle();
        expect(email.deleteMailbox).toHaveBeenCalledOnceWith('m-1');
        expect(dialog()).toBeNull();
        expect(closed).toBe(1);

        await open();
        expect(dialog()).not.toBeNull();
        host.destroy();
        await new Promise(resolve => setTimeout(resolve));
        expect(dialog()).toBeNull();
    });
});
