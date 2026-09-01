import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DocumentAggregatorService } from './document-aggregator.service';

/**
 * The upload call's multipart body.
 *
 * What can go wrong here is WIRING, and it fails silently: a `convert` flag
 * that never reaches the request produces an ordinary upload and a perfectly
 * normal-looking template — just not an editable one. Nothing throws, so only
 * inspecting the body catches it.
 */
describe('DocumentAggregatorService upload', () => {
    let service: DocumentAggregatorService;
    let httpMock: HttpTestingController;

    const UPLOAD_URL = '/api/v1/document/templates/upload';

    function upload(convert?: boolean, target?: 'template' | 'document'): FormData {
        const file = new File(['x'], 'invoice.xlsx');
        service.uploadTemplate(file, '/docs/', convert, target).subscribe();

        const request = httpMock.expectOne(UPLOAD_URL);
        const body: unknown = request.request.body;
        request.flush({});
        if (!(body instanceof FormData)) throw new Error('the upload must be multipart');

        return body;
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [DocumentAggregatorService],
        });
        service = TestBed.inject(DocumentAggregatorService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('sends the file and folder', () => {
        const body = upload();

        expect(body.get('file')).toBeInstanceOf(File);
        expect(body.get('folderPath')).toBe('/docs/');
    });

    /**
     * Absent rather than `"0"`. The backend reads it as a boolean either way,
     * but not sending it keeps the ordinary upload's body exactly what it was
     * before conversion existed — so nothing about the common path changed.
     */
    it('omits convert entirely unless it was asked for', () => {
        expect(upload().has('convert')).toBeFalse();
        expect(upload(false).has('convert')).toBeFalse();
    });

    it('sends convert when the caller asks to make the upload editable', () => {
        expect(upload(true).get('convert')).toBe('1');
    });

    /**
     *  The stage where a trailing parameter goes missing.
     *
     * `target` travels dialog -> service -> FormData -> processor -> provider,
     * and a value that silently stops arriving at any hop lands the operator's
     * file in the wrong place with no error. This pins the hop the browser
     * owns; the backend's is pinned by ConvertedUploadTargetTest.
     */
    it('sends the target the caller chose, not a default of its own', () => {
        expect(upload(true, 'document').get('target')).toBe('document');
        expect(upload(true, 'template').get('target')).toBe('template');
    });

    /** Meaningless without a conversion, so it is not sent at all. */
    it('omits the target when nothing is being converted', () => {
        expect(upload(false, 'document').has('target')).toBeFalse();
        expect(upload().has('target')).toBeFalse();
    });

    /** The service does not invent one either -- an unasked-for call still says template. */
    it('defaults to a template when the caller names no target', () => {
        expect(upload(true).get('target')).toBe('template');
    });
});
