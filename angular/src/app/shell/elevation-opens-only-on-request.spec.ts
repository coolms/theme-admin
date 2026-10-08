import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import {
    ConsoleAccessService, elevationInterceptor, NaviGraphService, RealtimeTokenClient,
} from '@coolms/core-angular';
import { ContextMenuService, ExplorerLayoutComponent, ToastService } from '@coolms/ui-angular';
import { provideElevationPrompt } from './elevation-prompt.provider';
import { EmailService } from '../features/email/email.service';
import { MediaGridSlotComponent } from '../features/media/media-grid-slot.component';
import { MediaPageStateService } from '../features/media/media-page-state.service';
import type { MediaAssetDto } from '../features/media/media.types';

/**
 * The elevation prompt opens only when a person asks for it: on an explicit action that needs
 * elevation, such as clicking Elevate. A request made on page load or in the background that gets a
 * 403 never opens it.
 *
 * Measured before this change, as an administrator who had not elevated: the prompt opened on 13
 * of 15 console pages by a menu click and on 15 of 15 by a reload, and on a Mail reload EITHER of two
 * refused requests opened it on its own -- the workflow definitions the mailbox editor offers, and a
 * realtime subscription token. The Media Library drew no tile under "All 25 files loaded".
 *
 * Built from the admin's own pieces: the interceptor as app.config chains it, the admin's prompt and
 * notice bindings, the services the pages call. Only the CDK dialog is a spy: whether it opens is the
 * subject. Every refusal below carries the server's stamp, `X-Elevation-Required`.
 */
const ELEVATION = '/api/v1/auth/elevation';
const MANIFEST  = { apiBase: '/api/v1', configBase: '/api/v1/config', identity: { elevationUrl: ELEVATION } };

const unelevated = {
    elevated: false, ended: { reason: 'closed', at: null },
    lifetimeSeconds: 900, lifetimeCeilingSeconds: 3600, mfaRequired: false, warnings: [],
};

function refuseForElevation(req: TestRequest): void {
    req.flush({ detail: 'Access Denied.' }, {
        status: 403, statusText: 'Forbidden', headers: { 'X-Elevation-Required': 'identity.administrator_role' },
    });
}

describe('The elevation prompt opens only on a person\'s request', () => {
    let http: HttpTestingController;
    let dialogOpen: jasmine.Spy;

    beforeEach(() => {
        dialogOpen = jasmine.createSpy('Dialog.open').and.returnValue({ closed: of(false) });
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor])),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST, select: () => of(null), dispatch: () => of(null) } },
                { provide: Dialog, useValue: { open: dialogOpen } },
                { provide: ConsoleAccessService, useValue: { ensure: () => Promise.resolve('granted') } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), loadAdminNav: () => of([]) } },
                provideElevationPrompt(),
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    it('opens no modal and shows no notice when reloading Mail unelevated', () => {
        // What a Mail reload sends that an unelevated administrator is refused: the mailbox editor's
        // workflow options (a read) and the realtime subscription token (a background write).
        TestBed.inject(EmailService).listInboundWorkflowOptions().subscribe({ error: () => undefined });
        TestBed.inject(RealtimeTokenClient).subscriptionToken('calls.broadcast').subscribe({ error: () => undefined });

        refuseForElevation(http.expectOne(r => r.url.endsWith('/api/v1/definitions')));
        refuseForElevation(http.expectOne(r => r.url.endsWith('/api/v1/centrifugo/subscription-token')));

        expect(dialogOpen).not.toHaveBeenCalled();
        expect(TestBed.inject(ToastService).toasts()).toEqual([]);
        http.expectNone(ELEVATION);
        http.verify();
    });

    it('shows a section that needs elevation inline, and opens the modal only after Elevate is clicked', () => {
        @Component({
            standalone: true,
            imports: [ExplorerLayoutComponent],
            template: '<app-explorer-layout layoutId="media:library" />',
        })
        class HostComponent {}

        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        refuseForElevation(http.expectOne('/api/v1/config/layout/media:library'));
        fixture.detectChanges();

        const inline = fixture.nativeElement.querySelector('[data-test="explorer-elevation-required"]') as HTMLElement | null;
        expect(inline).withContext('the inline state, not an empty page').not.toBeNull();
        expect(inline!.textContent).toContain('This section needs an elevated session');
        expect(dialogOpen).not.toHaveBeenCalled();
        http.expectNone(ELEVATION);

        (inline!.querySelector('[data-test="elevate"]') as HTMLButtonElement).click();
        http.expectOne(ELEVATION).flush(unelevated);

        expect(dialogOpen).toHaveBeenCalledTimes(1);
        http.verify();
    });
});

describe('The Media Library shows what its list holds', () => {
    let state: MediaPageStateService;

    const asset = (i: number): MediaAssetDto => ({
        id: `0199a1b2-0000-7000-8000-${String(i).padStart(12, '0')}`,
        originalFilename: `file-${i}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024 + i,
        thumbnailUrl: null,
    } as unknown as MediaAssetDto);

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                MediaPageStateService,
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST, select: () => of(null), dispatch: () => of(null) } },
                { provide: Dialog, useValue: { open: jasmine.createSpy('Dialog.open').and.returnValue({ closed: of(false) }) } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), loadAdminNav: () => of([]) } },
                { provide: ContextMenuService, useValue: { open: () => undefined, close: () => undefined } },
            ],
        });
        state = TestBed.inject(MediaPageStateService);
    });

    const render = () => {
        const fixture = TestBed.createComponent(MediaGridSlotComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

    it('shows the 25 items a media_library member\'s list returns', () => {
        state.assets.set(Array.from({ length: 25 }, (_, i) => asset(i + 1)));
        state.totalItems.set(25);
        state.loading.set(false);

        const el = render();

        expect(el.querySelectorAll('.media-tile').length).toBe(25);
    });

    it('shows that the list needs elevation, with an Elevate button, instead of nothing', () => {
        state.listError.set({ kind: 'elevation', message: 'This needs an elevated session.' });

        const el = render();

        expect(el.querySelector('[data-test="media-elevation-required"]')).not.toBeNull();
        expect(el.querySelectorAll('.media-tile').length).toBe(0);
    });

    it('shows an empty state for an empty list', () => {
        state.assets.set([]);
        state.totalItems.set(0);
        state.loading.set(false);

        const el = render();

        expect(el.querySelector('[data-test="media-empty"]')?.textContent).toContain('No files here yet');
    });

    it('shows access denied for a refusal that elevation would not change', () => {
        state.listError.set({ kind: 'denied', message: 'You don\'t have access to this.' });

        const el = render();

        expect(el.querySelector('[data-test="media-access-denied"]')).not.toBeNull();
    });
});
