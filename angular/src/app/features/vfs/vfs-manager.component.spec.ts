import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { NaviGraphService, UserPreferencesService } from '@coolms/core-angular';
import { FileEditorRegistry, PageFooterService, type VfsNodeDto } from '@coolms/ui-angular';
import { VfsManagerComponent } from './vfs-manager.component';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsUploadService } from './vfs-upload.service';

/**
 * The page side of the capability answer: the bar's context carries the LEAST answer across the selection
 * (the toolbar draws `denied` disabled and `elevate` locked from it), and a click on the bar -- or the
 * Delete key, the same button by another route -- goes through VfsActionsService.whenAllowed before it runs.
 * Built directly, not rendered: only what the context and the handlers read is stubbed.
 */
describe('VfsManagerComponent -- the bar reads the selection\'s capability answer', () => {
    const chmodNode = { path: '/chmod', meta: { action: 'VfsChmod', capability: 'vfs.node.chmod' } };
    const deleteNode = { path: '/delete', meta: { action: 'VfsDelete', capability: 'vfs.node.delete' } };

    function file(path: string, capabilities: Record<string, string>): VfsNodeDto {
        return { id: path, name: path, path, type: 'file', isSystem: false, isHidden: false, isContainer: false,
            permissions: { read: true, write: true, execute: false }, capabilities } as unknown as VfsNodeDto;
    }

    function build(selected: VfsNodeDto[]): { component: VfsManagerComponent; whenAllowed: jasmine.Spy } {
        const whenAllowed = jasmine.createSpy('whenAllowed');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: ActivatedRoute, useValue: {} },
                { provide: NaviGraphService, useValue: {} },
                { provide: UserPreferencesService, useValue: { setPageState: (): void => {} } },
                { provide: VfsActionsService, useValue: { whenAllowed } },
                { provide: VfsClipboardService, useValue: { hasAny: () => false } },
                { provide: VfsUploadService, useValue: {} },
                { provide: PageFooterService, useValue: { set: (): void => {} } },
                { provide: FileEditorRegistry, useValue: { resolve: () => null } },
                {
                    provide: VfsPageStateService,
                    useValue: {
                        viewMode:        signal('grid'),
                        selectedNodes:   signal(selected),
                        showHidden:      signal(false),
                        currentPath:     signal('/docs'),
                        vfsToolbarNodes: signal([chmodNode, deleteNode]),
                        panelOpen:       signal(false),
                        activeItem:      signal(null),
                        nodes:           signal(selected),
                        loading:         signal(false),
                    },
                },
            ],
        });

        return { component: TestBed.runInInjectionContext(() => new VfsManagerComponent()), whenAllowed };
    }

    it('publishes the least answer across the selection', () => {
        const { component } = build([
            file('/docs/a', { 'vfs.node.chmod': 'allowed', 'vfs.node.delete': 'allowed' }),
            file('/docs/b', { 'vfs.node.chmod': 'elevate', 'vfs.node.delete': 'denied' }),
        ]);

        expect(component.toolbarContext()['_capabilities'])
            .toEqual({ 'vfs.node.chmod': 'elevate', 'vfs.node.delete': 'denied' });
    });

    it('publishes no answer with nothing selected', () => {
        const { component } = build([]);

        expect(component.toolbarContext()['_capabilities']).toBeUndefined();
    });

    it('sends a click on the bar through whenAllowed, with the selection as its subjects', () => {
        const selected = [file('/docs/a', { 'vfs.node.chmod': 'elevate' })];
        const { component, whenAllowed } = build(selected);

        component.onVfsToolbarAction('VfsChmod');

        expect(whenAllowed).toHaveBeenCalledTimes(1);
        const [node, subjects] = whenAllowed.calls.mostRecent().args as [unknown, VfsNodeDto[]];
        expect(node).toBe(chmodNode);
        expect(subjects).toEqual(selected);
    });

    it('sends the Delete key through whenAllowed with the Delete button\'s node', () => {
        const selected = [file('/docs/a', { 'vfs.node.delete': 'denied' })];
        const { component, whenAllowed } = build(selected);
        component.isActive.set(true);

        component.onKeydown(new KeyboardEvent('keydown', { key: 'Delete' }));

        expect(whenAllowed).toHaveBeenCalledTimes(1);
        const [node, subjects] = whenAllowed.calls.mostRecent().args as [unknown, VfsNodeDto[]];
        expect(node).toBe(deleteNode);
        expect(subjects).toEqual(selected);
    });
});
