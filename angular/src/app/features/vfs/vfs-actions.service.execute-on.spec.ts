import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { ElevationService, ErrorHandlerService, NaviGraphNode } from '@coolms/core-angular';
import { FileEditorRegistry, NativeDialogService, VfsNodeDto } from '@coolms/ui-angular';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsPageStateService } from './vfs-page-state.service';

/**
 * What the right-click menu runs on a multi-selection: Delete, Cut and Copy act on every selected node, as the
 * toolbar's do -- the menu used to act on the clicked node alone while the selection showed many.
 */
describe('VfsActionsService.executeOn', () => {
    const action = (name: string) => ({ path: '/' + name, meta: { action: name } }) as unknown as NaviGraphNode;
    const node = (path: string, isSystem = false) => ({ path, name: path.slice(1), isSystem }) as unknown as VfsNodeDto;

    function service(): { svc: VfsActionsService; cut: jasmine.Spy; copy: jasmine.Spy } {
        const cut = jasmine.createSpy('cut');
        const copy = jasmine.createSpy('copy');
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
                { provide: VfsClipboardService, useValue: { cut, copy } },
                { provide: ElevationService, useValue: {} },
            ],
        });

        return { svc: TestBed.inject(VfsActionsService), cut, copy };
    }

    it('deletes every selected node but a system one, each asked for as the toolbar does', () => {
        const { svc } = service();
        const confirmDelete = spyOn(svc, 'confirmDelete').and.resolveTo();
        const [a, sys, b] = [node('/a'), node('/sys', true), node('/b')];

        svc.executeOn(action('VfsDelete'), [a, sys, b]);

        expect(confirmDelete.calls.allArgs()).toEqual([[a], [b]]);
    });

    it('cuts and copies the whole selection', () => {
        const { svc, cut, copy } = service();
        const selection = [node('/a'), node('/b'), node('/c')];

        svc.executeOn(action('VfsCut'), selection);
        svc.executeOn(action('VfsCopy'), selection);

        expect(cut).toHaveBeenCalledOnceWith(selection);
        expect(copy).toHaveBeenCalledOnceWith(selection);
    });

    it('hands one node, or none, to execute as before', () => {
        const { svc } = service();
        const execute = spyOn(svc, 'execute');
        const a = node('/a');

        svc.executeOn(action('VfsChmod'), [a]);
        svc.executeOn(action('VfsNewFolder'), []);

        expect(execute.calls.allArgs()).toEqual([[action('VfsChmod'), a], [action('VfsNewFolder'), null]]);
    });
});
