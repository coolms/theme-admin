import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { PageBodyNotReadError, PageService } from './page.service';
import { PageDto } from './page.types';
import { VfsApiService } from '../vfs/vfs-api.service';

/**
 * A page's body save names the version it read (2026-10-14): a body saved or deleted elsewhere meanwhile answers
 * 412 / 404 and is neither overwritten nor made again. The service keeps each variant's version from its read, from
 * the variant's creation and from each save -- and writes no body it holds no version of (2026-10-15).
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

    it('writes no body it never read: no PUT, an error that says so', () => {
        let failed: unknown = null;
        pages.saveContent('p1', 'en', 'new').subscribe({ error: e => (failed = e) });
        page();

        http.expectNone(r => r.method === 'PUT');
        expect(failed instanceof PageBodyNotReadError).toBeTrue();
    });

    it('writes no body whose read failed: a failed read is not a read of an empty body', () => {
        pages.getContent('p1', 'en').subscribe({ error: () => undefined });
        page();
        http.expectOne(BODY).flush('boom', { status: 500, statusText: 'Server Error' });

        let failed: unknown = null;
        pages.saveContent('p1', 'en', '').subscribe({ error: e => (failed = e) });
        page();

        http.expectNone(r => r.method === 'PUT');
        expect(failed instanceof PageBodyNotReadError).toBeTrue();
    });

    it('saves a variant it created with the version its creation answered', () => {
        const created: PageDto = { id: 'p1', vfsPath: '/content/default/about' } as PageDto;
        pages.createVariant(created, { locale: 'en' }).subscribe();
        http.expectOne(r => r.method === 'POST' && r.url === '/api/v1/vfs/files')
            .flush({ id: 'v1', path: '/content/default/about/en.dtmpl', name: 'en.dtmpl', contentHash: 'h0' });

        // A refused save is caught here, so a regression fails this case alone instead of aborting the run.
        let failed: unknown = null;
        pages.saveContent('p1', 'en', 'first words').subscribe({ error: e => (failed = e) });
        page();
        const put = http.expectOne(r => r.method === 'PUT' && r.urlWithParams === BODY);
        expect(put.request.headers.get('If-Match')).toBe('"h0"');
        put.flush({ contentHash: 'h1' });
        expect(failed).toBeNull();
    });
});
