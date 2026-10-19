import { Component, createEnvironmentInjector, ElementRef, EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog, type DialogConfig } from '@angular/cdk/dialog';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { NaviGraphService, UserPreferencesService } from '@coolms/core-angular';
import {
    ContextMenuComponent,
    ContextMenuService,
    FileEditorRegistry,
    PageFooterService,
    type VfsNodeDto,
} from '@coolms/ui-angular';
import { VfsManagerComponent } from './vfs-manager.component';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsUploadService } from './vfs-upload.service';
import { RtcCallOverlayComponent } from '../rtc/rtc-call-overlay.component';
import { RtcCallService, type ActiveCall } from '../rtc/rtc-call.service';
import { RtcMediaController } from '../rtc/rtc-media-controller';
import { RtcSfuMediaController } from '../rtc/rtc-sfu-media-controller';

/**
 * The topmost overlay owns the keyboard (2026-10-14: Del in the image editor deleted the file under it). For every
 * surface that opens over the file manager -- each editor, the viewer, every dialog, the context menu -- no file
 * manager shortcut fires while it is open, whether the key starts inside it or on the page; and they all fire again
 * once it has closed. Each dialog is opened through the CDK Dialog service with the options its call site passes
 * (the scope sees every dialog by that service); the context menu is the real component.
 */

@Component({ standalone: true, template: '<button type="button" class="inside">inside</button>' })
class SurfaceComponent {}

/** Every surface the file manager opens, with the options its call site passes. */
type SurfaceOptions = Pick<DialogConfig, 'backdropClass' | 'disableClose' | 'hasBackdrop' | 'panelClass'>;
const DIALOGS: ReadonlyArray<{ name: string; config: SurfaceOptions }> = [
    { name: 'the image editor (vfs-files openImageEditor)', config: { backdropClass: 'cdk-overlay-dark-backdrop', disableClose: true } },
    { name: 'the document viewer (ViewerModalComponent)', config: { hasBackdrop: true } },
    { name: 'the code editor (FileEditorRegistry, text/*)', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the sheet editor (FileEditorRegistry)', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the page editor (FileEditorRegistry, package)', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the template editor (FileEditorRegistry, dtmpl / ddoc)', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the designer (FileEditorRegistry, workflow)', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the resource metadata dialog', config: { panelClass: 'cms-editor-dialog' } },
    { name: 'the delete confirmation (DeleteNodeDialogComponent)', config: {} },
    { name: 'the chmod dialog', config: {} },
    { name: 'the chown dialog', config: {} },
    { name: 'the paste conflict dialog', config: { backdropClass: 'cdk-overlay-dark-backdrop' } },
    { name: 'the name input (new file / folder, rename)', config: {} },
    { name: 'the input with a choice (new page)', config: {} },
    { name: 'the confirm and error dialogs (NativeDialogService.confirm)', config: {} },
];

/** Every file manager shortcut, and the keys Dmitry named that are none of its own. */
const KEYS: ReadonlyArray<KeyboardEventInit> = [
    { key: 'Delete' }, { key: 'Backspace' }, { key: 'F2' }, { key: 'Escape' },
    { key: 'a', ctrlKey: true }, { key: 'c', ctrlKey: true }, { key: 'x', ctrlKey: true }, { key: 'v', ctrlKey: true },
];

describe('VfsManagerComponent -- no shortcut reaches it while a surface is open over it', () => {
    let host: HTMLElement;
    let whenAllowed: jasmine.Spy;
    let clipboard: { hasAny: () => boolean; cut: jasmine.Spy; copy: jasmine.Spy; paste: jasmine.Spy; clear: jasmine.Spy };

    const selected = [{
        id: '/docs/a.png', name: 'a.png', path: '/docs/a.png', type: 'file', isSystem: false, isHidden: false,
        isContainer: false, permissions: { read: true, write: true, execute: false }, capabilities: {},
    } as unknown as VfsNodeDto];

    beforeEach(() => {
        host = document.createElement('div');
        host.tabIndex = -1; // as the component's host binding does
        document.body.appendChild(host);
        whenAllowed = jasmine.createSpy('whenAllowed');
        clipboard = {
            hasAny: () => true,
            cut: jasmine.createSpy('cut'), copy: jasmine.createSpy('copy'),
            paste: jasmine.createSpy('paste').and.resolveTo(undefined), clear: jasmine.createSpy('clear'),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: ElementRef, useValue: new ElementRef(host) },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ActivatedRoute, useValue: {} },
                { provide: NaviGraphService, useValue: {} },
                { provide: UserPreferencesService, useValue: { setPageState: (): void => {} } },
                { provide: VfsActionsService, useValue: { whenAllowed } },
                { provide: VfsClipboardService, useValue: clipboard },
                { provide: VfsUploadService, useValue: {} },
                { provide: PageFooterService, useValue: { set: (): void => {} } },
                { provide: FileEditorRegistry, useValue: { resolve: () => null } },
                {
                    provide: VfsPageStateService,
                    useValue: {
                        viewMode: signal('grid'), selectedNodes: signal(selected), showHidden: signal(false),
                        currentPath: signal('/docs'), vfsToolbarNodes: signal([]), panelOpen: signal(false),
                        activeItem: signal(null), nodes: signal(selected), loading: signal(false),
                    },
                },
            ],
        });
        TestBed.runInInjectionContext(() => new VfsManagerComponent());
    });

    afterEach(() => {
        TestBed.inject(Dialog).closeAll();
        host.remove();
    });

    function press(target: Element, init: KeyboardEventInit): void {
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    }

    function reached(): string[] {
        return [
            ...(whenAllowed.calls.count() ? ['Delete'] : []),
            ...(clipboard.cut.calls.count() ? ['Ctrl+X'] : []),
            ...(clipboard.copy.calls.count() ? ['Ctrl+C'] : []),
            ...(clipboard.paste.calls.count() ? ['Ctrl+V'] : []),
            ...(clipboard.clear.calls.count() ? ['Escape'] : []),
        ];
    }

    function resetSpies(): void {
        for (const s of [whenAllowed, clipboard.cut, clipboard.copy, clipboard.paste, clipboard.clear]) s.calls.reset();
    }

    it('takes every one of its shortcuts with nothing open over it (the control)', () => {
        for (const init of KEYS) press(host, init);
        expect(reached()).toEqual(['Delete', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Escape']);
    });

    it('takes none while focus is in another panel of the same page, wherever the mouse is', () => {
        const panel = document.createElement('div');
        panel.tabIndex = 0;
        document.body.appendChild(panel);
        for (const init of KEYS) {
            press(panel, init);
            press(document.body, init);
        }
        panel.remove();
        expect(reached()).toEqual([]);
    });

    for (const surface of DIALOGS) {
        it(`takes no key while ${surface.name} is open, and all again once it has closed`, () => {
            const ref = TestBed.inject(Dialog).open(SurfaceComponent, { ...surface.config, disableClose: true });
            const inside = ref.overlayRef.hostElement.querySelector('.inside')!;
            expect(inside).withContext('the surface rendered').not.toBeNull();
            for (const init of KEYS) {
                press(inside, init);
                press(document.body, init);
                press(host, init);
            }
            expect(reached()).withContext(`reached the file manager while ${surface.name} was open`).toEqual([]);

            ref.close();
            resetSpies();
            press(host, { key: 'Delete' });
            expect(reached()).withContext('once it has closed').toEqual(['Delete']);
        });
    }

    it('takes no key while the context menu is open, and all again once it has closed', () => {
        const menuFixture = TestBed.createComponent(ContextMenuComponent);
        const menu = TestBed.inject(ContextMenuService);
        menu.open(new MouseEvent('contextmenu', { clientX: 10, clientY: 10, cancelable: true }), [
            { id: 'delete', label: 'Delete' },
        ], () => undefined);
        menuFixture.detectChanges();
        menuFixture.detectChanges();

        for (const init of KEYS) {
            if (init.key === 'Escape') continue; // ESC closes the menu itself, pressed last below
            press(menuFixture.nativeElement as Element, init);
            press(host, init);
        }
        expect(reached()).withContext('reached the file manager while the context menu was open').toEqual([]);

        menu.close();
        menuFixture.detectChanges();
        menuFixture.detectChanges();
        press(host, { key: 'Delete' });
        expect(reached()).withContext('once it has closed').toEqual(['Delete']);
        menuFixture.destroy();
    });

    it('a press where the press moves no focus (a thumbnail\'s image) puts the keyboard here: Del then reaches it', () => {
        const image = document.createElement('img');
        const rename = document.createElement('input');
        host.append(image, rename);
        (document.activeElement as HTMLElement | null)?.blur();

        image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        expect(host.contains(document.activeElement)).withContext('focus is in the file manager').toBeTrue();
        press(document.activeElement!, { key: 'Delete' });
        expect(reached()).toEqual(['Delete']);

        rename.focus();
        image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        expect(document.activeElement).withContext('a field of its own keeps its focus').toBe(rename);
    });

    it('takes every one of its shortcuts during a connected video or group call: the call screen is a card, no layer', () => {
        const card = document.createElement('div');
        document.body.appendChild(card);
        const call = { ui: 'connected', mediaKind: 'video', topology: 'sfu', connectedAtMs: 0 } as unknown as ActiveCall;
        const callInjector = createEnvironmentInjector([
            { provide: ElementRef, useValue: new ElementRef(card) },
            { provide: RtcCallService, useValue: { activeCall: signal(call) } },
            { provide: RtcMediaController, useValue: { screenSharing: signal(true) } },
            { provide: RtcSfuMediaController, useValue: {} },
        ], TestBed.inject(EnvironmentInjector));
        callInjector.runInContext(() => new RtcCallOverlayComponent());
        TestBed.tick();

        for (const init of KEYS) press(host, init);
        expect(reached()).toEqual(['Delete', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Escape']);
        callInjector.destroy();
        card.remove();
    });
});
