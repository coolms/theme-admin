import {
    DTMPL_EXT,
    DTMPL_MIME,
    extensionForMimeIn,
    extensionForSourceMime,
    importedSourceMime,
    inferTemplateSourceMime,
    templateSourceFilename,
    type TemplateSourceIdentity,
} from './template-source.helpers';
import { type FormatDisplayInfo } from '../shared/format-info.types';
import { SHEET_DOCUMENT_EXT, SHEET_DOCUMENT_MIME } from '../shared/sheet-document.constants';

/**
 * Naming a template's SOURCE download.
 *
 * The bug these pin: the Document Library named every source download
 * `<slug>.docx`, whatever the template's format or source half. A native Word
 * template's source is a `.dtmpl` and a native spreadsheet's is a `.dsheet` —
 * neither is a Word document, and calling them one hands the operator a file
 * Word refuses to open.
 *
 * The extension comes from the backend's `format-info` payload, so the specs
 * below drive `advertisedExtension` rather than asserting a map here: the
 * point is that a format module names its own extension. The fallback maps
 * are exercised separately, through a lookup that answers `null` — the state
 * the page is in before the payload lands.
 */
describe('template-source helpers', () => {
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    /** A lookup standing in for a loaded `format-info` payload. */
    function advertising(pairs: Record<string, string | undefined>): (mime: string) => string | null {
        return (mime) => pairs[mime] ?? null;
    }

    /** The lookup the page has before the payload arrives, or after it fails. */
    const nothingAdvertised = (): string | null => null;

    function template(overrides: Partial<TemplateSourceIdentity> = {}): TemplateSourceIdentity {
        return {
            slug: 'invoice',
            format: 'word',
            native: false,
            sourceMimeType: DOCX_MIME,
            ...overrides,
        };
    }

 describe('templateSourceFilename', () => {
 it('names a native WORD source .dtmpl, not .docx', () => {
            const name = templateSourceFilename(
                template({ native: true, sourceMimeType: DTMPL_MIME }),
                advertising({ [DTMPL_MIME]: DTMPL_EXT }),
            );

            expect(name).toBe('invoice.dtmpl');
        });

 it('names a native SPREADSHEET source .dsheet, not .docx', () => {
            const name = templateSourceFilename(
                template({ format: 'spreadsheet', native: true, sourceMimeType: SHEET_DOCUMENT_MIME }),
                advertising({ [SHEET_DOCUMENT_MIME]: SHEET_DOCUMENT_EXT }),
            );

            expect(name).toBe('invoice.dsheet');
        });

 it('keeps each imported format on its own Office extension', () => {
            const advertised = advertising({
                [DOCX_MIME]: '.docx',
                [XLSX_MIME]: '.xlsx',
                [PPTX_MIME]: '.pptx',
            });

            expect(templateSourceFilename(template(), advertised)).toBe('invoice.docx');
            expect(
                templateSourceFilename(template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME }), advertised),
            ).toBe('invoice.xlsx');
            expect(
                templateSourceFilename(template({ format: 'presentation', sourceMimeType: PPTX_MIME }), advertised),
            ).toBe('invoice.pptx');
        });

 it('takes the extension a NEW format advertises, with no change here', () => {
 // The whole reason the lookup is injected: a format this spec has
 // never heard of is named correctly because the backend said so.
            const name = templateSourceFilename(
                template({ format: 'markdown', native: true, sourceMimeType: 'text/markdown' }),
                advertising({ 'text/markdown': '.md' }),
            );

            expect(name).toBe('invoice.md');
        });

 it('falls back to the local map when nothing is advertised yet', () => {
            expect(
                templateSourceFilename(
                    template({ native: true, sourceMimeType: DTMPL_MIME }),
                    nothingAdvertised,
                ),
            ).toBe('invoice.dtmpl');
            expect(
                templateSourceFilename(
                    template({ format: 'spreadsheet', native: true, sourceMimeType: SHEET_DOCUMENT_MIME }),
                    nothingAdvertised,
                ),
            ).toBe('invoice.dsheet');
            expect(templateSourceFilename(template(), nothingAdvertised)).toBe('invoice.docx');
        });

 it('infers the right HALF of the axis when the row carries no mime', () => {
 // `sourceMimeType` is the Node's mime and is null only when the
 // Node has none. Guessing the imported mime for a native template
 // is how a `.dtmpl` got called a `.docx` in the first place.
            expect(
                templateSourceFilename(
                    template({ native: true, sourceMimeType: null }),
                    nothingAdvertised,
                ),
            ).toBe('invoice.dtmpl');
            expect(
                templateSourceFilename(
                    template({ format: 'spreadsheet', native: true, sourceMimeType: null }),
                    nothingAdvertised,
                ),
            ).toBe('invoice.dsheet');
            expect(
                templateSourceFilename(
                    template({ format: 'spreadsheet', sourceMimeType: null }),
                    nothingAdvertised,
                ),
            ).toBe('invoice.xlsx');
        });

 it('leaves the name bare rather than claim a format it cannot resolve', () => {
            const name = templateSourceFilename(
                template({ format: 'markdown', native: true, sourceMimeType: null }),
                nothingAdvertised,
            );

            expect(name).toBe('invoice');
        });
    });

 describe('inferTemplateSourceMime', () => {
 it('answers the native mime for a native template', () => {
            expect(inferTemplateSourceMime('word', true)).toBe(DTMPL_MIME);
            expect(inferTemplateSourceMime('spreadsheet', true)).toBe(SHEET_DOCUMENT_MIME);
        });

 it('answers the imported Office mime otherwise', () => {
            expect(inferTemplateSourceMime('word', false)).toBe(DOCX_MIME);
            expect(inferTemplateSourceMime('spreadsheet', false)).toBe(XLSX_MIME);
            expect(inferTemplateSourceMime('presentation', false)).toBe(PPTX_MIME);
        });

 it('has no native answer for a format with no native authoring', () => {
 // Presentation's provider returns no native source mime — there is
 // nothing to author, so there is nothing to name.
            expect(inferTemplateSourceMime('presentation', true)).toBeNull();
        });

 it('has no answer for an unknown format', () => {
            expect(inferTemplateSourceMime('markdown', false)).toBeNull();
        });
    });

 describe('extensionForSourceMime', () => {
 it('prefers what the backend advertises over the local map', () => {
 // Not a hypothetical: the local map is a frozen snapshot, and the
 // endpoint is the format module speaking for itself.
            expect(extensionForSourceMime(DOCX_MIME, '.docm')).toBe('.docm');
        });

 it('returns an empty extension for a mime nobody knows', () => {
            expect(extensionForSourceMime('application/x-unheard-of', null)).toBe('');
        });
    });

    /**
     * The mime the Replace dialog filters its picker to.
     *
     * `replaceSource()` runs the bytes through `validateUpload()`, which opens
     * them as an Office file in every provider — so the NATIVE half of the
     * axis is not replaceable source, however loudly `format-info` advertises
     * it beside the imported half.
     */
 describe('importedSourceMime', () => {
 it('takes an imported template’s own mime, consulting no map', () => {
            expect(importedSourceMime(template())).toBe(DOCX_MIME);
            expect(
                importedSourceMime(template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME })),
            ).toBe(XLSX_MIME);
            expect(
                importedSourceMime(template({ format: 'presentation', sourceMimeType: PPTX_MIME })),
            ).toBe(PPTX_MIME);
        });

 it('answers the IMPORTED half for a native template, not its own mime', () => {
 // The bug this guards: a native spreadsheet's source mime is the
 // `.dsheet`, and offering that in the picker would filter the
 // chooser to the one file `replaceSource()` refuses.
            expect(importedSourceMime(template({ native: true, sourceMimeType: DTMPL_MIME })))
                .toBe(DOCX_MIME);
            expect(
                importedSourceMime(
                    template({ format: 'spreadsheet', native: true, sourceMimeType: SHEET_DOCUMENT_MIME }),
                ),
            ).toBe(XLSX_MIME);
        });

 it('infers from the format when the row carries no mime at all', () => {
            expect(importedSourceMime(template({ sourceMimeType: null }))).toBe(DOCX_MIME);
            expect(
                importedSourceMime(template({ format: 'presentation', sourceMimeType: null })),
            ).toBe(PPTX_MIME);
        });

 it('has no answer for a format nothing here has heard of', () => {
 // Leaves the picker unfiltered rather than filtered to a guess —
 // the backend still rejects a file it cannot read.
            expect(
                importedSourceMime(template({ format: 'markdown', native: true, sourceMimeType: null })),
            ).toBeNull();
        });
    });

    /**
     * The index pairing `format-info` publishes, shared by the service (whole
     * cached registry) and the Replace dialog (one filtered entry).
     */
 describe('extensionForMimeIn', () => {
        const entry = (over: Partial<FormatDisplayInfo>): FormatDisplayInfo => ({
            format: 'word',
            label: 'Word Document',
            icon: 'bi-file-earmark-word',
            color: '#2B579A',
            mimeTypes: [DOCX_MIME, DTMPL_MIME],
            extensions: ['.docx', DTMPL_EXT],
            ...over,
        });

 it('pairs a mime with the extension at the same index', () => {
            const formats = [
                entry({}),
                entry({
                    format: 'spreadsheet',
                    mimeTypes: [XLSX_MIME, SHEET_DOCUMENT_MIME],
                    extensions: ['.xlsx', SHEET_DOCUMENT_EXT],
                }),
            ];

            expect(extensionForMimeIn(formats, DOCX_MIME)).toBe('.docx');
            expect(extensionForMimeIn(formats, DTMPL_MIME)).toBe(DTMPL_EXT);
            expect(extensionForMimeIn(formats, SHEET_DOCUMENT_MIME)).toBe(SHEET_DOCUMENT_EXT);
        });

 it('answers null for an unadvertised mime and for an empty list', () => {
            expect(extensionForMimeIn([entry({})], 'application/x-unheard-of')).toBeNull();
            expect(extensionForMimeIn([], DOCX_MIME)).toBeNull();
        });

 it('answers null when the pairing does not hold for that entry', () => {
 // A short `extensions` list. Taking SOME extension would be worse
 // than none — the caller's fallback is at least honest.
            expect(extensionForMimeIn([entry({ extensions: ['.docx'] })], DTMPL_MIME)).toBeNull();
        });
    });
});
