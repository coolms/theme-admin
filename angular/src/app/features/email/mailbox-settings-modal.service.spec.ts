import { Component, OnInit, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, of } from 'rxjs';
import { ConfirmDialogService } from '@coolms/ui-angular';

import { EMAIL_ROUTES } from './email.routes';
import { type MailboxSettingsDialogData } from './mailbox-settings-dialog.component';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

/** The Email page as far as the modal sees it: it provides the modal and lets it follow its URL. */
@Component({ selector: 'app-email-host', standalone: true, template: '', providers: [MailboxSettingsModal] })
class EmailHostComponent implements OnInit {
    readonly modal = inject(MailboxSettingsModal);

    ngOnInit(): void {
        this.modal.attach();
    }
}

/**
 * A mailbox's settings as a modal over the Email page (decided 2026-10-24): the URL is the truth -- a link opens the
 * modal on its pane, a pane pick replaces the URL so Back closes the modal, Esc / close ask when a pane is dirty, and
 * the old settings address redirects to the modal.
 */
describe('MailboxSettingsModal -- a mailbox\'s settings, a modal named in the URL', () => {
    let router: RouterTestingHarness;
    let appRouter: Router;
    let location: Location;
    let opened: { data: MailboxSettingsDialogData; close: jasmine.Spy; backdrop: Subject<MouseEvent> }[];
    let dirty: boolean;
    let discard: boolean;
    let asked: number;

    const url = () => location.path();
    const open = () => opened.filter(d => d.close.calls.count() === 0);
    /** The router answers a popstate (Back) on a later turn: let it, then let the app settle. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => setTimeout(resolve));
            await router.fixture.whenStable();
        }
        router.detectChanges();
    }

    beforeEach(async () => {
        opened = [];
        dirty = false;
        discard = true;
        asked = 0;
        TestBed.configureTestingModule({
            providers: [
                provideRouter([
                    // The email routes as the app has them: the page, and the old settings address beside it.
                    { path: 'email', children: [{ path: '', component: EmailHostComponent }, ...EMAIL_ROUTES.slice(1)] },
                    { path: 'home', children: [] },
                ]),
                provideLocationMocks(),
                {
                    provide: Dialog, useValue: {
                        open: (_c: unknown, config: { data: MailboxSettingsDialogData }) => {
                            const ref = {
                                data: config.data, close: jasmine.createSpy('close'), backdrop: new Subject<MouseEvent>(),
                            };
                            opened.push(ref);
                            return {
                                close: ref.close,
                                backdropClick: ref.backdrop,
                                componentInstance: { settings: () => ({ dirty: () => dirty }) },
                            };
                        },
                    },
                },
                { provide: ConfirmDialogService, useValue: { confirmDiscard: () => { asked++; return of(discard); } } },
            ],
        });
        router = await RouterTestingHarness.create();
        appRouter = TestBed.inject(Router);
        location = TestBed.inject(Location);
        // The router hears Back (a popstate) only once its location listener is set up, as the app's start does.
        appRouter.initialNavigation();
    });

    it('a link opens the modal on its pane, over that mailbox\'s page', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1?settings=connection');
        await settle();

        expect(open().length).toBe(1);
        expect(open()[0].data.mailboxId()).toBe('mb-1');
        expect(open()[0].data.pane()).toBe('connection');
    });

    it('the old settings address redirects to the modal, on the same pane (or the first)', async () => {
        await router.navigateByUrl('/email/mailboxes/mb-1/settings/sync');
        await settle();
        expect(url()).toBe('/email;mailbox=mb-1?settings=sync');
        expect(open()[0].data.pane()).toBe('sync');

        await router.navigateByUrl('/email/mailboxes/mb-2/settings');
        await settle();
        expect(url()).toBe('/email;mailbox=mb-2?settings=general');
    });

    it('a pane pick replaces the URL: Back then closes the modal, it does not walk the panes', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();
        open()[0].data.onPane({ pane: 'rules', replace: false });
        await settle();
        expect(url()).toBe('/email;mailbox=mb-1?settings=rules');
        expect(open()[0].data.pane()).toBe('rules');

        location.back();
        await settle();
        expect(url()).toBe('/email;mailbox=mb-1');
        expect(open().length).toBe(0);
    });

    it('the close button closes it: back to the page when the entry before is the page', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();

        open()[0].data.onCloseRequested();
        await settle();
        expect(url()).toBe('/email;mailbox=mb-1');
        expect(open().length).toBe(0);
        expect(asked).toBe(0);
    });

    it('opened straight from a link: closing replaces the URL with the page\'s own, Back does not reopen it', async () => {
        await router.navigateByUrl('/home');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();

        open()[0].data.onCloseRequested();
        await settle();
        expect(url()).toBe('/email;mailbox=mb-1');
        expect(open().length).toBe(0);

        location.back();
        await settle();
        expect(url()).toBe('/home');
    });

    it('with unsaved changes, closing asks: Keep editing keeps it open, Discard changes closes it', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();
        dirty = true;

        discard = false;
        open()[0].data.onCloseRequested();
        await settle();
        expect(asked).toBe(1);
        expect(url()).toBe('/email;mailbox=mb-1?settings=general');
        expect(open().length).toBe(1);

        discard = true;
        open()[0].data.onCloseRequested();
        await settle();
        expect(asked).toBe(2);
        expect(url()).toBe('/email;mailbox=mb-1');
        expect(open().length).toBe(0);
    });

    it('Esc and the scrim are close requests too (the dialog itself is told not to close)', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();

        open()[0].backdrop.next(new MouseEvent('click'));
        await settle();
        expect(open().length).toBe(0);
        expect(url()).toBe('/email;mailbox=mb-1');
    });

    it('Back with unsaved changes: the modal stays, and the question is asked', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1');
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();
        dirty = true;
        discard = false;

        location.back();
        await settle();
        expect(asked).toBe(1);
        expect(open().length).toBe(1);
        expect(url()).toBe('/email;mailbox=mb-1?settings=general');
    });

    it('a pane pick with unsaved changes asks first', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();
        dirty = true;
        discard = false;

        open()[0].data.onPane({ pane: 'sync', replace: false });
        await settle();
        expect(asked).toBe(1);
        expect(url()).toBe('/email;mailbox=mb-1?settings=general');
    });

    it('the mailbox deleted: the modal closes and the page is the Email page', async () => {
        await router.navigateByUrl('/email;mailbox=mb-1?settings=general');
        await settle();

        open()[0].data.onDeleted();
        await settle();
        expect(url()).toBe('/email');
        expect(open().length).toBe(0);
        expect(appRouter.url).toBe('/email');
    });
});
