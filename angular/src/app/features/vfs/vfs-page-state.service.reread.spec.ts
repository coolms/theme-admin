import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import type { CapabilityState, VfsNodeDto } from '@coolms/ui-angular';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsPageStateService } from './vfs-page-state.service';

/**
 * The listing is read again on every elevation change, and the selection must follow it (2026-10-14): the bar and
 * the menus read the SELECTED node objects, so a selection still holding the objects from before the read answered
 * for the session as it was -- after an elevation ended, a still-selected node's Delete stayed unlocked until it was
 * clicked again.
 */
describe('VfsPageStateService -- the selection follows a listing read again', () => {
    const LIST = '/api/v1/vfs/directories/list';
    let http: HttpTestingController;
    let elevationChanges: Subject<unknown>;

    function node(id: string, del: CapabilityState): VfsNodeDto {
        return { id, name: id + '.txt', path: '/docs/' + id + '.txt', type: 'file', capabilities: { 'vfs.node.delete': del } } as unknown as VfsNodeDto;
    }

    function setUp(): VfsPageStateService {
        elevationChanges = new Subject<unknown>();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                VfsPageStateService,
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: VfsHomeLabelService, useValue: { register: () => undefined } },
                { provide: ElevationService, useValue: { changes$: elevationChanges.asObservable() } },
            ],
        });
        http = TestBed.inject(HttpTestingController);

        return TestBed.inject(VfsPageStateService);
    }

    function answer(nodes: VfsNodeDto[]): void {
        http.expectOne(req => req.url.startsWith(LIST)).flush({ member: nodes, hasMore: false, nextCursor: null });
    }

    it('takes the fresh objects when the listing is read again after an elevation change', () => {
        const state = setUp();
        state.navigateTo('/docs');
        answer([node('own', 'allowed'), node('other', 'allowed')]);
        const byId = (id: string) => state.nodes().find(n => n.id === id) as VfsNodeDto;
        state.setSelection([byId('other')]);

        elevationChanges.next({ kind: 'dropped' });
        answer([node('own', 'allowed'), node('other', 'elevate')]);

        const [selected] = state.selectedNodes();
        expect(selected.id).toBe('other');
        expect(selected).toBe(byId('other'));
        expect((selected.capabilities as Record<string, string>)['vfs.node.delete']).toBe('elevate');
        http.verify();
    });

    it('keeps every selected node it still lists, in the selection\'s order, and drops one it no longer lists', () => {
        const state = setUp();
        state.navigateTo('/docs');
        answer([node('a', 'allowed'), node('b', 'allowed'), node('c', 'allowed')]);
        state.setSelection([state.nodes()[2], state.nodes()[0], state.nodes()[1]]);

        state.reload();
        answer([node('a', 'denied'), node('c', 'denied')]);

        expect(state.selectedNodes().map(n => n.id)).toEqual(['c', 'a']);
        expect(state.selectedNodes().every(n => (n.capabilities as Record<string, string>)['vfs.node.delete'] === 'denied')).toBe(true);
        http.verify();
    });

    it('leaves an empty selection empty', () => {
        const state = setUp();
        state.navigateTo('/docs');
        answer([node('a', 'allowed')]);

        state.reload();
        answer([node('a', 'denied')]);

        expect(state.selectedNodes()).toEqual([]);
        http.verify();
    });
});
