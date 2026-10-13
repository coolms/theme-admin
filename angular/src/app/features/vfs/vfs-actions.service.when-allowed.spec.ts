import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, ErrorHandlerService, NaviGraphNode } from '@coolms/core-angular';
import { FileEditorRegistry, NativeDialogService, VfsNodeDto } from '@coolms/ui-angular';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsPageStateService } from './vfs-page-state.service';

/**
 * The one place a VFS action meets the server's capability answer before it runs -- the toolbar, both
 * right-click menus and the Delete key all call it. `denied` never runs, `elevate` runs after a grant
 * (or when the session is elevated already), `allowed` and no answer run at once.
 */
describe('VfsActionsService.whenAllowed', () => {
    const chmodNode = { path: '/chmod', meta: { action: 'VfsChmod', capability: 'vfs.node.chmod' } } as unknown as NaviGraphNode;
    const plainNode = { path: '/download', meta: { action: 'VfsDownload' } } as unknown as NaviGraphNode;

    function subject(state?: string): VfsNodeDto {
        return { path: '/docs/a', capabilities: state ? { 'vfs.node.chmod': state } : [] } as unknown as VfsNodeDto;
    }

    function serviceWith(offer: boolean, elevatedAfter: boolean): { svc: VfsActionsService; offerFor: jasmine.Spy } {
        const offerFor = jasmine.createSpy('offerFor').and.returnValue(of(offer));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                VfsActionsService,
                { provide: HttpClient, useValue: {} },
                { provide: Store, useValue: {} },
                { provide: VfsPageStateService, useValue: {} },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: NativeDialogService, useValue: {} },
                { provide: Dialog, useValue: {} },
                { provide: FileEditorRegistry, useValue: {} },
                { provide: VfsClipboardService, useValue: {} },
                { provide: ElevationService, useValue: { offerFor, elevated: () => elevatedAfter } },
            ],
        });

        return { svc: TestBed.inject(VfsActionsService), offerFor };
    }

    it('runs at once an action whose node names no capability', () => {
        const { svc, offerFor } = serviceWith(false, false);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(plainNode, [subject('denied')], act);

        expect(act).toHaveBeenCalledTimes(1);
        expect(offerFor).not.toHaveBeenCalled();
    });

    it('runs at once an allowed action, and one the server sent no answer for', () => {
        const { svc, offerFor } = serviceWith(false, false);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('allowed')], act);
        svc.whenAllowed(chmodNode, [subject()], act);
        svc.whenAllowed(undefined, [subject('denied')], act);

        expect(act).toHaveBeenCalledTimes(3);
        expect(offerFor).not.toHaveBeenCalled();
    });

    it('never runs a denied action, and asks for no elevation', () => {
        const { svc, offerFor } = serviceWith(true, true);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('denied')], act);

        expect(act).not.toHaveBeenCalled();
        expect(offerFor).not.toHaveBeenCalled();
    });

    it('decides a selection by its least answer', () => {
        const { svc } = serviceWith(true, true);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('allowed'), subject('denied')], act);

        expect(act).not.toHaveBeenCalled();
    });

    it('runs a locked action after the person elevates', () => {
        const { svc, offerFor } = serviceWith(true, true);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('elevate')], act);

        expect(offerFor).toHaveBeenCalledTimes(1);
        expect(act).toHaveBeenCalledTimes(1);
    });

    it('runs nothing when the person cancels the elevation', () => {
        const { svc, offerFor } = serviceWith(false, false);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('elevate')], act);

        expect(offerFor).toHaveBeenCalledTimes(1);
        expect(act).not.toHaveBeenCalled();
    });

    it('runs a locked action at once when the session was elevated already', () => {
        // offerFor answers false without a prompt when the session is elevated (another tab did it, after
        // this listing was fetched): the answer was older than the session, not a refusal.
        const { svc } = serviceWith(false, true);
        const act = jasmine.createSpy('act');

        svc.whenAllowed(chmodNode, [subject('elevate')], act);

        expect(act).toHaveBeenCalledTimes(1);
    });
});
