import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import type { VfsNodeDto } from '@coolms/ui-angular';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsPageStateService } from './vfs-page-state.service';

/**
 * A next page the server refuses because its page link is no longer valid (/errors/page-link-invalid, 409) reads the
 * folder again from its first page, once, the selection kept by id; a second one before a next page is read is the
 * error; any other refusal is the error at once.
 */
describe('VfsPageStateService -- a page link no longer valid starts the folder again', () => {
    const LIST = '/api/v1/vfs/directories/list';
    let http: HttpTestingController;

    function node(id: string): VfsNodeDto {
        return { id, name: id + '.txt', path: '/docs/' + id + '.txt', type: 'file', capabilities: {} } as unknown as VfsNodeDto;
    }

    function setUp(): VfsPageStateService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                VfsPageStateService,
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: VfsHomeLabelService, useValue: { register: () => undefined } },
                { provide: ElevationService, useValue: { changes$: new Subject<unknown>().asObservable() } },
            ],
        });
        http = TestBed.inject(HttpTestingController);

        return TestBed.inject(VfsPageStateService);
    }

    const first = (cursor: string | null) => http.expectOne(r => r.url.startsWith(LIST) && !r.url.includes('cursor='))
        .flush({ member: [node('a'), node('b')], hasMore: cursor !== null, nextCursor: cursor });
    const next = (cursor: string) => http.expectOne(r => r.url.startsWith(LIST) && r.url.includes('cursor=' + cursor));
    const pageLinkInvalid = { type: '/errors/page-link-invalid', title: 'This page link is no longer valid', status: 409 };

    it('reads the first page again, once, the selection kept by id, and pages on with the fresh link', () => {
        const state = setUp();
        state.navigateTo('/docs');
        first('p2');
        state.loadMore();
        next('p2').flush({ member: [node('c')], hasMore: true, nextCursor: 'stale' });
        state.setSelection([state.nodes().find(n => n.id === 'c') as VfsNodeDto]);

        state.loadMore();
        next('stale').flush(pageLinkInvalid, { status: 409, statusText: 'Conflict' });
        first('fresh');
        expect(state.error()).toBeNull();
        expect(state.nodes().map(n => n.id)).toEqual(['a', 'b']);
        expect(state.selectedNodes().map(n => n.id)).withContext('a pick from a later page stays').toEqual(['c']);

        state.loadMore();
        next('fresh').flush({ member: [node('c')], hasMore: false, nextCursor: null });
        expect(state.nodes().map(n => n.id)).toEqual(['a', 'b', 'c']);
        http.verify();
    });

    it('a second page-link refusal before a next page is read is the error, never a loop', () => {
        const state = setUp();
        state.navigateTo('/docs');
        first('stale');
        state.loadMore();
        next('stale').flush(pageLinkInvalid, { status: 409, statusText: 'Conflict' });
        first('stale');
        state.loadMore();
        next('stale').flush(pageLinkInvalid, { status: 409, statusText: 'Conflict' });
        expect(state.error()).toBe('failed');
        http.verify();
    });

    it('any other refusal of a next page is the error at once, the first page not read again', () => {
        const state = setUp();
        state.navigateTo('/docs');
        first('c2');
        state.loadMore();
        next('c2').flush({ type: '/errors/vfs/something-else', status: 409 }, { status: 409, statusText: 'Conflict' });
        expect(state.error()).toBe('failed');
        http.verify();
    });
});
