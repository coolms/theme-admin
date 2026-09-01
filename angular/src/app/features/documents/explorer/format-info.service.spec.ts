import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { FormatInfoService } from './format-info.service';
import { type FormatDisplayInfo } from '../shared/format-info.types';

/**
 * `nativeAuthoringFormats()` — the list behind the "New Template" format
 * choice.
 *
 * It is a FILTER over what the backend advertises, never a literal pair, so
 * that a format module gaining native authoring appears in the admin with no
 * frontend edit. The specs below pin that property rather than the current
 * Word/Spreadsheet answer: a filter replaced by a hard-coded list would still
 * satisfy "returns word and spreadsheet".
 */
describe('FormatInfoService', () => {
    let svc: FormatInfoService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
        svc = TestBed.inject(FormatInfoService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function payload(formats: Partial<FormatDisplayInfo>[], acceptString = ''): Record<string, unknown> {
        return {
            formats: formats.map(f => ({
                format: 'x',
                label: 'X',
                icon: 'bi-file',
                color: '#000',
                mimeTypes: [],
                extensions: [],
                ...f,
            })),
            acceptMimeTypes: [],
            acceptExtensions: [],
            acceptString,
        };
    }

    function load(formats: Partial<FormatDisplayInfo>[], acceptString = ''): void {
        svc.loadFormatInfo().subscribe();
        http.expectOne(r => r.url === '/api/v1/document/format-info').flush(payload(formats, acceptString));
    }

 it('offers exactly the formats the backend flags as natively authorable', () => {
        load([
            { format: 'word', label: 'Word Document', supportsNativeAuthoring: true },
            { format: 'spreadsheet', label: 'Spreadsheet', supportsNativeAuthoring: true },
            { format: 'presentation', label: 'Presentation', supportsNativeAuthoring: false },
        ]);

        expect(svc.nativeAuthoringFormats().map(f => f.format)).toEqual(['word', 'spreadsheet']);
    });

 it('picks up a NEW native format without a code change here', () => {
 // The whole point of driving the list off the endpoint: a format this
 // spec has never heard of shows up because the backend said so.
        load([
            { format: 'word', label: 'Word Document', supportsNativeAuthoring: true },
            { format: 'markdown', label: 'Markdown', supportsNativeAuthoring: true },
        ]);

        expect(svc.nativeAuthoringFormats().map(f => f.format)).toEqual(['word', 'markdown']);
    });

 it('treats a missing flag as NOT authorable', () => {
 // An older backend omits the field. Offering the format anyway would
 // send the operator into a 422; offering none falls back to the
 // single-format prompt, which is what they had before.
        load([{ format: 'word', label: 'Word Document' }]);

        expect(svc.nativeAuthoringFormats()).toEqual([]);
    });

 it('offers nothing before the payload arrives', () => {
        expect(svc.nativeAuthoringFormats()).toEqual([]);
    });

    /**
     * `extensionForMime()` — how the Document Library names a template's
     * source download.
     *
     * Each format publishes its mimes and extensions in the same order, so
     * the extension is read out of the payload by index. Driving it off the
     * endpoint is the point: a `.dtmpl` and a `.dsheet` are spelled by the
     * modules that own them, and a frontend map is what made both download
     * named `.docx`.
     */
 describe('extensionForMime', () => {
        const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const DTMPL = 'text/x-dtmpl';
        const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const DSHEET = 'application/x-coolms-sheet+json';

        function loadRealShape(): void {
            load([
                {
                    format: 'word',
                    label: 'Word Document',
                    mimeTypes: [DOCX, DTMPL],
                    extensions: ['.docx', '.dtmpl'],
                },
                {
                    format: 'spreadsheet',
                    label: 'Spreadsheet',
                    mimeTypes: [XLSX, DSHEET],
                    extensions: ['.xlsx', '.dsheet'],
                },
            ]);
        }

 it('pairs each mime with the extension at the same index', () => {
            loadRealShape();

 // The NATIVE half is the half that was missing: a template whose
 // source mime is the second entry must not take the first
 // extension.
            expect(svc.extensionForMime(DTMPL)).toBe('.dtmpl');
            expect(svc.extensionForMime(DSHEET)).toBe('.dsheet');
            expect(svc.extensionForMime(DOCX)).toBe('.docx');
            expect(svc.extensionForMime(XLSX)).toBe('.xlsx');
        });

 it('answers for a format it has never heard of', () => {
            load([{ format: 'markdown', mimeTypes: ['text/markdown'], extensions: ['.md'] }]);

            expect(svc.extensionForMime('text/markdown')).toBe('.md');
        });

 it('returns null for an unadvertised mime', () => {
            loadRealShape();

            expect(svc.extensionForMime('application/x-unheard-of')).toBeNull();
        });

 it('returns null before the payload arrives', () => {
            expect(svc.extensionForMime(DTMPL)).toBeNull();
        });

 it('returns null when a format advertises a mime with no extension', () => {
 // A short `extensions` list means the pairing does not hold for
 // that entry. Answering with SOME extension would be worse than
 // answering with none — the caller's fallback is at least honest
 // about being a guess.
            load([{ format: 'word', mimeTypes: [DOCX, DTMPL], extensions: ['.docx'] }]);

            expect(svc.extensionForMime(DTMPL)).toBeNull();
        });
    });

    /**
     * `loadFormatInfo('word')` — the `?format=` narrowing the Replace dialog
     * asks for, since it already knows the format it is replacing.
     *
     * The cache is SHARED and root-scoped: the document grid reads an icon, a
     * colour and a label off it for every row, and every source download is
     * named from it. A one-format answer stored there would outlive the dialog
     * that asked for it, so the narrowing must reach the caller and stop.
     */
 describe('a filtered load', () => {
        const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        const WORD: Partial<FormatDisplayInfo> =
            { format: 'word', label: 'Word Document', mimeTypes: [DOCX_MIME], extensions: ['.docx'] };
        const SPREADSHEET: Partial<FormatDisplayInfo> =
            { format: 'spreadsheet', label: 'Spreadsheet', mimeTypes: [XLSX_MIME], extensions: ['.xlsx'] };

        function loadFiltered(format: string, formats: Partial<FormatDisplayInfo>[]): FormatDisplayInfo[] {
            let received: FormatDisplayInfo[] = [];
            svc.loadFormatInfo(format).subscribe(info => (received = info.formats));
            http.expectOne(r => r.params.get('format') === format).flush(payload(formats));

            return received;
        }

 it('asks the backend for that format alone', () => {
            svc.loadFormatInfo('spreadsheet').subscribe();

            const request = http.expectOne(r => r.url === '/api/v1/document/format-info');
            expect(request.request.params.get('format')).toBe('spreadsheet');
            request.flush(payload([SPREADSHEET]));
        });

 it('hands the narrowed payload to its caller', () => {
            const received = loadFiltered('spreadsheet', [SPREADSHEET]);

            expect(received.map(f => f.format)).toEqual(['spreadsheet']);
        });

 it('leaves the cached registry whole', () => {
            load([WORD, SPREADSHEET], '.docx,.xlsx');
            loadFiltered('word', [WORD]);

 // The grid behind the dialog still knows every format it did
 // before — including the one nobody asked about.
            expect(svc.getAllFormats().map(f => f.format)).toEqual(['word', 'spreadsheet']);
            expect(svc.label('spreadsheet')).toBe('Spreadsheet');
            expect(svc.extensionForMime(XLSX_MIME)).toBe('.xlsx');
            expect(svc.acceptString()).toBe('.docx,.xlsx');
        });

 it('does not seed an empty cache with one format either', () => {
 // Before the page's own load lands, a cache holding one format
 // reads as the whole registry: every other row loses its icon and
 // the upload dialog's accept string shrinks to this one format.
            loadFiltered('word', [WORD]);

            expect(svc.getAllFormats()).toEqual([]);
            expect(svc.acceptString()).toBe('');
        });

 it('clears the loading flag like any other load', () => {
            loadFiltered('word', [WORD]);

            expect(svc.loading()).toBe(false);
        });
    });
});
