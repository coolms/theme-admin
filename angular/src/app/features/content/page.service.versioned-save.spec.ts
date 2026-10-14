import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { PageService } from './page.service';
import { VfsApiService } from '../vfs/vfs-api.service';

/**
 * A page's body save names the version it read (2026-10-14): a body saved or deleted elsewhere meanwhile answers
 * 412 / 404 and is neither overwritten nor made again. The service keeps each variant's version from its read and
 * from each save.
 */
describe('PageService -- a body save names the version it read', () => {
    const PAGE = '/api/v1/content/pages';
    const BODY = '/api/v1/vfs/files/content?path=%2Fcontent%2Fdefault%2Fabout%2Fen.dtmpl';
    let http: HttpTestingController;
    let pages: PageService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: VfsApiService, useValue: {} },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => ({ apiBase: '/api/v1', vfs: { fileContentUrl: '/api/v1/vfs/files/content?path={path}' } }),
                    },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        pages = TestBed.inject(PageService);
    });

    afterEach(() => http.verify());

    function page(): void {
        http.expectOne(r => r.url === PAGE && r.params.get('id') === 'p1').flush({ member: [{ id: 'p1', vfsPath: '/content/default/about' }] });
    }

    it('sends the version it read as If-Match, then the version each save answered', () => {
        pages.getContent('p1', 'en').subscribe();
        page();
        http.expectOne(BODY).flush({ content: 'hello', contentHash: 'h1' });

        pages.saveContent('p1', 'en', 'hello!').subscribe();
        page();
        const first = http.expectOne(r => r.method === 'PUT' && r.urlWithParams === BODY);
        expect(first.request.headers.get('If-Match')).toBe('"h1"');
        first.flush({ contentHash: 'h2' });

        pages.saveContent('p1', 'en', 'hello!!').subscribe();
        page();
        const second = http.expectOne(r => r.method === 'PUT' && r.urlWithParams === BODY);
        expect(second.request.headers.get('If-Match')).toBe('"h2"');
        second.flush({ contentHash: 'h3' });
    });

    it('sends no If-Match for a body it never read, as before', () => {
        pages.saveContent('p1', 'en', 'new').subscribe();
        page();
        const put = http.expectOne(r => r.method === 'PUT' && r.urlWithParams === BODY);
        expect(put.request.headers.has('If-Match')).toBeFalse();
        put.flush({ contentHash: 'h1' });
    });
});
