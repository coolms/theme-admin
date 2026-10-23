import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { clientHeaderInterceptor } from './client-header.interceptor';

/** Every API call names the admin and its version; nothing else carries the header. */
describe('clientHeaderInterceptor', () => {
    let http: HttpClient;
    let backend: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(withInterceptors([clientHeaderInterceptor])), provideHttpClientTesting()],
        });
        http = TestBed.inject(HttpClient);
        backend = TestBed.inject(HttpTestingController);
    });

    afterEach(() => backend.verify());

    it('names the admin and its x.y.z version on an API call', () => {
        http.get('/api/v1/calendar/items').subscribe();

        const req = backend.expectOne('/api/v1/calendar/items');
        expect(req.request.headers.get('X-CoolMS-Client')).toMatch(/^com\.coolms\.admin\/\d+\.\d+\.\d+/);
        req.flush([]);
    });

    it('leaves assets and other origins without it', () => {
        http.get('assets/document-fonts/fonts.manifest.json').subscribe();
        http.get('https://example.org/api/v1/x').subscribe();

        const asset = backend.expectOne('assets/document-fonts/fonts.manifest.json');
        const other = backend.expectOne('https://example.org/api/v1/x');
        expect(asset.request.headers.has('X-CoolMS-Client')).toBeFalse();
        expect(other.request.headers.has('X-CoolMS-Client')).toBeFalse();
        asset.flush({});
        other.flush({});
    });
});
