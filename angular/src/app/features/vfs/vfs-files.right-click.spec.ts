import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { ContextMenuService, DrawerService, FileEditorRegistry, ToastService, type VfsNodeDto } from '@coolms/ui-angular';
import { ElevationService } from '@coolms/core-angular';

import { VfsFilesComponent } from './vfs-files.component';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsIconService } from './vfs-icon.service';
import { VfsLiveEventsService, type VfsNodeChangeEvent } from './vfs-live-events.service';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsUploadService } from './vfs-upload.service';

/**
 * A right-click on a row, through the rendered list: the row's item-interactions directive and this component's
 * handlers together, as a person meets them (decided 2026-10-14).
 *
 *  - A right-click on a file OUTSIDE the selection selects that file alone, and what is chosen from the menu acts
 *    on it alone.
 *  - A right-click on a file INSIDE the selection keeps the selection, and what is chosen acts on all of it.
 *
 * The specs beside this one call `onContextMenu` directly, so they never see the selection the directive sets
 * before the menu opens. Here the `contextmenu` event is dispatched on the row element, and the selection, the
 * menu's record and the nodes the action runs on are read afterwards.
 */
describe('VfsFilesComponent -- a right-click on a row', () => {
    const API = '/api/v1';
    const deleteNode = { path: '/delete', meta: { action: 'VfsDelete', capability: 'vfs.node.delete' } };

    function node(name: string): VfsNodeDto {
        return {
            id: `${name}-id`, name, type: 'file', path: `/docs/${name}`, mode: '0644', modeString: '-rw-r--r--',
            size: 1, humanSize: '1 B', mimeType: 'text/plain', extension: 'txt', uid: 'u1', gid: 'g1',
            uname: 'admin', gname: 'admin', createdAt: '2026-10-14T09:00:00+00:00', updatedAt: '2026-10-14T09:00:00+00:00',
            isRendered: false, isMaterialized: true, isSystem: false, isHidden: false, isContainer: false,
            title: null, description: null, permissions: { read: true, write: true, execute: false },
            capabilities: { 'vfs.node.delete': 'allowed' },
        };
    }

    interface Built {
        fixture: ComponentFixture<VfsFilesComponent>;
        selected: WritableSignal<VfsNodeDto[]>;
        openFromNodes: jasmine.Spy;
        whenAllowed: jasmine.Spy;
        executeOn: jasmine.Spy;
    }

    function render(nodes: VfsNodeDto[], selection: VfsNodeDto[]): Built {
        // As the real service does (ui-angular ContextMenuService.openFromNodes): the event goes no further, so the
        // list's own background menu, one element up, does not open over the row's.
        const openFromNodes = jasmine.createSpy('openFromNodes').and.callFake((event: MouseEvent) => event.stopPropagation());
        const whenAllowed = jasmine.createSpy('whenAllowed');
        const executeOn = jasmine.createSpy('executeOn');
        const selected = signal<VfsNodeDto[]>(selection);
        const state = {
            currentPath:     signal('/docs'),
            nodes:           signal<VfsNodeDto[]>(nodes),
            loading:         signal(false),
            error:           signal<string | null>(null),
            viewMode:        signal('grid'),
            selectedNodes:   selected,
            setSelection:    (next: VfsNodeDto[]) => selected.set(next),
            selectNode:      jasmine.createSpy('selectNode'),
            hasMore:         signal(false),
            vfsToolbarNodes: signal([deleteNode]),
            uploads:         signal([]),
            clearUploads:    jasmine.createSpy('clearUploads'),
            uploadRequested$: new Subject<void>(),
            reload:          jasmine.createSpy('reload'),
            loadMore:        jasmine.createSpy('loadMore'),
            navigateTo:      jasmine.createSpy('navigateTo'),
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [VfsFilesComponent],
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: API }) } },
                { provide: VfsPageStateService, useValue: state },
                { provide: VfsLiveEventsService, useValue: { watch: () => new Subject<VfsNodeChangeEvent>() } },
                { provide: ContextMenuService,   useValue: { openFromNodes } },
                { provide: DrawerService,        useValue: { close: jasmine.createSpy('close') } },
                { provide: Dialog,               useValue: {} },
                { provide: FileEditorRegistry,   useValue: { resolve: () => null } },
                { provide: ToastService,         useValue: {} },
                { provide: VfsUploadService,     useValue: {} },
                { provide: VfsClipboardService,  useValue: { hasAny: () => false, hasCut: () => false, clipboard: () => null } },
                { provide: VfsHomeLabelService,  useValue: { labelFor: () => () => '' } },
                {
                    provide: VfsIconService,
                    useValue: { nodeIcon: () => 'bi-file-earmark', nodeIconClass: () => '', nodeIconBadge: () => null },
                },
                { provide: VfsActionsService,    useValue: { whenAllowed, executeOn } },
                { provide: ElevationService,     useValue: {} },
            ],
        });

        const fixture = TestBed.createComponent(VfsFilesComponent);
        fixture.detectChanges();
        // The folder stat the live channel waits for; its answer does not matter here.
        TestBed.inject(HttpTestingController).match(() => true).forEach(r => r.flush({ id: 'folder-id' }));
        fixture.detectChanges();
        return { fixture, selected, openFromNodes, whenAllowed, executeOn };
    }

    function rightClick(fixture: ComponentFixture<VfsFilesComponent>, target: VfsNodeDto): void {
        const row = (fixture.nativeElement as HTMLElement).querySelector(`[data-node-id="${target.id}"]`);
        expect(row).withContext(`the row of ${target.name} is rendered`).not.toBeNull();
        row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        fixture.detectChanges();
    }

    /** Choose Delete from the menu that opened; returns the nodes it runs on once whenAllowed lets it. */
    function chooseDelete(built: Built): VfsNodeDto[] {
        expect(built.openFromNodes).toHaveBeenCalledTimes(1);
        (built.openFromNodes.calls.mostRecent().args[3] as (id: string) => void)('VfsDelete');
        expect(built.whenAllowed).toHaveBeenCalledTimes(1);
        const [chosen, subjects, act] = built.whenAllowed.calls.mostRecent().args as [unknown, VfsNodeDto[], () => void];
        expect(chosen).toBe(deleteNode);
        act();
        expect(built.executeOn).toHaveBeenCalledOnceWith(deleteNode, subjects);
        return subjects;
    }

    it('selects a file outside the selection alone, and acts on it alone', () => {
        const [a, b, c] = [node('a.txt'), node('b.txt'), node('c.txt')];
        const built = render([a, b, c], [a, b]);

        rightClick(built.fixture, c);

        expect(built.selected()).withContext('the selection is the clicked file alone').toEqual([c]);
        const record = built.openFromNodes.calls.mostRecent().args[2] as Record<string, unknown>;
        expect(record['path']).toBe(c.path);
        expect(record['_single']).withContext('the menu is drawn for one node').toBe(true);
        expect(chooseDelete(built)).withContext('Delete runs on the clicked file alone').toEqual([c]);
    });

    it('keeps the selection when the file is inside it, and acts on the whole selection', () => {
        const [a, b, c] = [node('a.txt'), node('b.txt'), node('c.txt')];
        const built = render([a, b, c], [a, b]);

        rightClick(built.fixture, a);

        expect(built.selected()).withContext('the selection is kept').toEqual([a, b]);
        const record = built.openFromNodes.calls.mostRecent().args[2] as Record<string, unknown>;
        expect(record['path']).toBe(a.path);
        expect(record['_single']).withContext('the menu is drawn for several nodes').toBe(false);
        expect(chooseDelete(built)).withContext('Delete runs on every selected file').toEqual([a, b]);
    });
});
