import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WordTemplateService } from './word-template.service';

/**
 * `createNative()` sends the format it was ASKED for.
 *
 * It hard-coded `'word'` from #1680 until the admin gained a format choice,
 * which stranded the native spreadsheet path end to end: the backend could
 * mint a `.dsheet` (#1987), render it (#1990) and edit it in the grid
 * (#1991), and nothing could ask for one. Asserting the request BODY rather
 * than a 2xx, because a service that quietly re-hard-codes the format would
 * still return a template — just always the wrong kind.
 */
describe('WordTemplateService', () => {
    const ENDPOINT = '/api/v1/document/templates';

    let svc: WordTemplateService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
        svc = TestBed.inject(WordTemplateService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('posts the requested format, not a hard-coded one', () => {
        svc.createNative('Invoice', 'spreadsheet').subscribe();

        const req = http.expectOne(ENDPOINT);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ name: 'Invoice', format: 'spreadsheet' });
        req.flush({});
    });

    it('still posts word when word is what was asked for', () => {
        svc.createNative('Invoice', 'word').subscribe();

        const req = http.expectOne(ENDPOINT);
        expect(req.request.body).toEqual({ name: 'Invoice', format: 'word' });
        req.flush({});
    });

    it('sends the NAME only — the slug is derived server-side (#1687)', () => {
        svc.createNative('Счета', 'word').subscribe();

        const req = http.expectOne(ENDPOINT);
        expect(req.request.body.slug).toBeUndefined();
        expect(req.request.body.name).toBe('Счета');
        req.flush({});
    });
});
