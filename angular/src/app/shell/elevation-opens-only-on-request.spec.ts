import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import {
    ComponentRegistry, ConsoleAccessService, elevationInterceptor, NaviGraphService, RealtimeTokenClient,
} from '@coolms/core-angular';
import { ContextMenuService, ExplorerLayoutComponent, PageFooterService, ToastService } from '@coolms/ui-angular';
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

    it('answers a refused write with one notice, and opens the modal only when its Elevate is clicked', () => {
        const http2 = TestBed.inject(HttpClient);
        // The same refusal twice, as a debounced request repeats it: one notice.
        for (let i = 0; i < 2; i++) {
            http2.put('/api/v1/themes/site', {}).subscribe({ error: () => undefined });
            refuseForElevation(http.expectOne('/api/v1/themes/site'));
        }

        const toasts = TestBed.inject(ToastService).toasts();
        expect(toasts.length).toBe(1);
        expect(toasts[0].message).toBe('This needs an elevated session.');
        expect(dialogOpen).not.toHaveBeenCalled();
        http.expectNone(ELEVATION);

        toasts[0].action!.run();
        http.expectOne(ELEVATION).flush(unelevated);

        expect(dialogOpen).toHaveBeenCalledTimes(1);
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
    let http: HttpTestingController;
    let state: MediaPageStateService;
    let dialogOpen: jasmine.Spy;

    const asset = (i: number): MediaAssetDto => ({
        id: `0199a1b2-0000-7000-8000-${String(i).padStart(12, '0')}`,
        originalFilename: `file-${i}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024 + i,
        thumbnailUrl: null,
    } as unknown as MediaAssetDto);

    /** The layout the Media Library reads: its main area is the MediaGrid slot, where the tiles are. */
    const MEDIA_LAYOUT = { data: { slots: { 'content.main': { component: 'MediaGrid' } } } };

    @Component({
        standalone: true,
        imports: [ExplorerLayoutComponent],
        template: '<app-explorer-layout layoutId="media:library" />',
    })
    class MediaLibraryHost {}

    beforeEach(() => {
        // The page's own binding: the layout names the slot, the registry turns the name into the component.
        ComponentRegistry.register('MediaGrid', MediaGridSlotComponent);
        dialogOpen = jasmine.createSpy('Dialog.open').and.returnValue({ closed: of(false) });
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor])),
                provideHttpClientTesting(),
                // What the Media Library page provides to its layout and its slots.
                MediaPageStateService,
                PageFooterService,
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST, select: () => of(null), dispatch: () => of(null) } },
                { provide: Dialog, useValue: { open: dialogOpen } },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), loadAdminNav: () => of([]) } },
                { provide: ContextMenuService, useValue: { open: () => undefined, close: () => undefined } },
                provideElevationPrompt(),
            ],
        });
        http  = TestBed.inject(HttpTestingController);
        state = TestBed.inject(MediaPageStateService);
        // What a media_library member's list returns: 25 files, all loaded.
        state.assets.set(Array.from({ length: 25 }, (_, i) => asset(i + 1)));
        state.totalItems.set(25);
        state.loading.set(false);
    });

    const open = (answer: (req: TestRequest) => void): HTMLElement => {
        const fixture = TestBed.createComponent(MediaLibraryHost);
        fixture.detectChanges();
        answer(http.expectOne('/api/v1/config/layout/media:library'));
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

    it('shows the 25 items a media_library member\'s list returns once the page\'s layout is read', () => {
        const el = open(req => req.flush(MEDIA_LAYOUT));

        expect(el.querySelectorAll('.media-tile').length).toBe(25);
        expect(el.querySelector('.explorer-footer')).not.toBeNull();
    });

    it('shows that the page needs elevation, not nothing under a file count, when its layout is refused', () => {
        // The report of 2026-10-08: the layout read was refused, no slot was made, 0 tiles were drawn, and the
        // footer said "All 25 files loaded".
        const el = open(refuseForElevation);

        expect(el.querySelector('[data-test="explorer-elevation-required"]'))
            .withContext('the inline state in place of the grid').not.toBeNull();
        expect(el.querySelectorAll('.media-tile').length).toBe(0);
        expect(el.querySelector('.explorer-footer')).withContext('no count over a grid that is not there').toBeNull();
        expect(dialogOpen).not.toHaveBeenCalled();
    });
});

describe('The Media grid\'s own states', () => {
    let state: MediaPageStateService;

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

    const render = (): HTMLElement => {
        const fixture = TestBed.createComponent(MediaGridSlotComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

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

        expect(render().querySelector('[data-test="media-empty"]')?.textContent).toContain('No files here yet');
    });

    it('shows access denied for a refusal that elevation would not change', () => {
        state.listError.set({ kind: 'denied', message: 'You don\'t have access to this.' });

        expect(render().querySelector('[data-test="media-access-denied"]')).not.toBeNull();
    });
});

describe('On an installation that cannot elevate', () => {
    it('says so when Elevate is clicked, instead of doing nothing', () => {
        const dialogOpen = jasmine.createSpy('Dialog.open').and.returnValue({ closed: of(false) });
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor])),
                provideHttpClientTesting(),
                // No elevation URL in the manifest: the installation offers no elevation.
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', configBase: '/api/v1/config' }), select: () => of(null), dispatch: () => of(null) } },
                { provide: Dialog, useValue: { open: dialogOpen } },
                provideElevationPrompt(),
            ],
        });
        const http = TestBed.inject(HttpTestingController);

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
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('[data-test="elevation-unavailable"]')).toBeNull();

        (el.querySelector('[data-test="elevate"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(el.querySelector('[data-test="elevation-unavailable"]')?.textContent).toContain('Ask an administrator');
        expect(dialogOpen).not.toHaveBeenCalled();
        http.verify();
    });
});
