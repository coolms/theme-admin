import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '@coolms/ui-angular';
import { DocumentFontService } from './document-font.service';

/**
 * The installed-fonts admin surface — the two decisions worth testing.
 *
 * ⚠️ The SERVICE, not the page component. Rendering the page pulls
 * `<coolms-datagrid>`, which wants a config endpoint, a store snapshot and a
 * toolbar tree; a spec that stubbed all three would be testing the stubs. What
 * this file asserts is what the page cannot get wrong quietly: the shape of the
 * upload, and that a family with a space in it survives the URL.
 */
describe('installed document fonts', () => {
    let api: DocumentFontService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                DocumentFontService,
                { provide: ToastService, useValue: { success: (): void => {}, error: (): void => {} } },
            ],
        });

        api = TestBed.inject(DocumentFontService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('uploads the file and NOTHING else', () => {
        // ⚠️ The whole point of the surface. The family and the face are read
        // from the font's own tables on the server; a form field naming either
        // would be the client stating something the bytes could contradict.
        api.install(new File([new Uint8Array([0, 1, 0, 0])], 'Brandish.ttf')).subscribe();

        const request = http.expectOne('/api/v1/document/fonts');
        expect(request.request.method).toBe('POST');

        const body = request.request.body as FormData;
        expect(body instanceof FormData).toBeTrue();
        expect([...body.keys()]).toEqual(['file']);

        request.flush({ family: 'Brandish', face: 'regular', fileName: 'Brandish.ttf', bytes: 4 });
    });

    it('encodes a family name on the way into the URL', () => {
        // A family is whatever a font's name table says -- spaces at least, and
        // in principle a slash. Interpolating it would make "Brandish Display"
        // a request for a path that does not exist, and the operator would see
        // a remove that silently did nothing.
        api.remove('Brandish Display').subscribe();

        const request = http.expectOne('/api/v1/document/fonts/Brandish%20Display');
        expect(request.request.method).toBe('DELETE');

        request.flush({ family: 'Brandish Display', removed: 1 });
    });

    it('reads the list as families, each holding its faces', () => {
        let seen: readonly { family: string; faces: readonly unknown[] }[] = [];
        api.list().subscribe((result) => (seen = result.families));

        http.expectOne('/api/v1/document/fonts').flush({
            families: [{ family: 'Brandish', faces: [{ face: 'regular' }, { face: 'bold' }] }],
        });

        expect(seen.length).toBe(1);
        expect(seen[0]?.faces.length).toBe(2);
    });
});
