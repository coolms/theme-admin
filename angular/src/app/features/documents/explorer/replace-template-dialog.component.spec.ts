import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';

import { FormatInfoService } from './format-info.service';
import { ReplaceTemplateDialogComponent } from './replace-template-dialog.component';
import type { ReplaceTemplateDialogData } from './replace-template-dialog.component';
import { type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * The Replace dialog's file picker.
 *
 * The bug these pin: the picker was hard-coded to `.docx` and the copy named
 * Word, while the dialog opens for whichever template is selected — so
 * replacing a spreadsheet's or a presentation's source meant defeating the
 * chooser's own filter and reading about the wrong application.
 *
 * Two properties matter, and the second is the subtle one:
 *
 *   1. The accepted extension follows the template's FORMAT.
 *   2. It is the IMPORTED half of's source axis and never the native
 *      one. `format-info` advertises both (`['.docx', '.dtmpl']`), but every
 *      provider's `replaceSource()` runs the bytes through `validateUpload()`,
 *      which opens them as an Office file. Offering `.dtmpl` would filter the
 *      chooser to the one file the backend refuses.
 */
describe('ReplaceTemplateDialogComponent', () => {
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    const DTMPL_MIME = 'text/x-dtmpl';
    const DSHEET_MIME = 'application/x-coolms-sheet+json';

    /** The shape the backend really publishes — both halves, in pairs. */
    const REGISTRY = [
        {
            format: 'word',
            label: 'Word Document',
            icon: 'bi-file-earmark-word',
            color: '#2B579A',
            mimeTypes: [DOCX_MIME, DTMPL_MIME],
            extensions: ['.docx', '.dtmpl'],
            supportsNativeAuthoring: true,
        },
        {
            format: 'spreadsheet',
            label: 'Spreadsheet',
            icon: 'bi-file-earmark-spreadsheet',
            color: '#217346',
            mimeTypes: [XLSX_MIME, DSHEET_MIME],
            extensions: ['.xlsx', '.dsheet'],
            supportsNativeAuthoring: true,
        },
        {
            format: 'presentation',
            label: 'Presentation',
            icon: 'bi-file-earmark-slides',
            color: '#D24726',
            mimeTypes: [PPTX_MIME],
            extensions: ['.pptx'],
            supportsNativeAuthoring: false,
        },
    ];

    let http: HttpTestingController;
    let close: jasmine.Spy;
    let dialogData: ReplaceTemplateDialogData;

    beforeEach(() => {
        close = jasmine.createSpy('close');
        dialogData = { template: template() };

        TestBed.configureTestingModule({
            imports: [ReplaceTemplateDialogComponent, HttpClientTestingModule],
            providers: [
                // A factory, not a value: `build()` swaps the template in
                // before the component is created and the dialog reads its
                // data once, at construction.
                { provide: DIALOG_DATA, useFactory: () => dialogData },
                { provide: DialogRef, useValue: { close } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function template(overrides: Partial<DocumentTemplate> = {}): DocumentTemplate {
        return {
            id: 'a4f1e3c2-0000-4000-8000-000000000001',
            name: 'Invoice',
            slug: 'invoice',
            description: null,
            native: false,
            sourceMimeType: DOCX_MIME,
            contextSchema: null,
            defaultOutputFormat: 'docx',
            format: 'word',
            instanceNameSuffix: null,
            publiclyAccessible: false,
            path: '/docs/.templates/invoice.docx',
            createdAt: null,
            updatedAt: null,
            ...overrides,
        };
    }

    /** Populate the shared cache the way the Document Library page does. */
    function loadWholeRegistry(): void {
        TestBed.inject(FormatInfoService).loadFormatInfo().subscribe();
        http.expectOne(r => r.url === '/api/v1/document/format-info').flush({
            formats: REGISTRY,
            acceptMimeTypes: [DOCX_MIME, DTMPL_MIME, XLSX_MIME, DSHEET_MIME, PPTX_MIME],
            acceptExtensions: ['.docx', '.dtmpl', '.xlsx', '.dsheet', '.pptx'],
            acceptString: '.docx,.dtmpl,.xlsx,.dsheet,.pptx',
        });
    }

    function build(data: ReplaceTemplateDialogData): ComponentFixture<ReplaceTemplateDialogComponent> {
        dialogData = data;

        const fixture = TestBed.createComponent(ReplaceTemplateDialogComponent);
        fixture.detectChanges();

        return fixture;
    }

    function accept(fixture: ComponentFixture<ReplaceTemplateDialogComponent>): string {
        const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="file"]');

        return input.accept;
    }

    function copy(fixture: ComponentFixture<ReplaceTemplateDialogComponent>): string {
        return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
    }

    /**
     * Found by LABEL, never by index — the footer swaps its primary button
     * between phases, and `querySelectorAll('button')[n]` has turned a
     * "click preview" into a "click cancel" in this codebase before.
     */
    function buttonLabelled(
        fixture: ComponentFixture<ReplaceTemplateDialogComponent>,
        label: string,
    ): HTMLButtonElement {
        const buttons: HTMLButtonElement[] = Array.from(
            fixture.nativeElement.querySelectorAll('button'),
        );
        const match = buttons.find(b => (b.textContent ?? '').trim() === label);
        if (!match) {
            throw new Error(`no button labelled "${label}" rendered`);
        }

        return match;
    }

    describe('with the registry already cached', () => {
        beforeEach(() => loadWholeRegistry());

        it('accepts .docx for a Word template', () => {
            const fixture = build({ template: template() });

            expect(accept(fixture)).toBe(`.docx,${DOCX_MIME}`);
            expect(copy(fixture)).toContain('Drop a .docx file here');
            expect(copy(fixture)).toContain('Accepted: Word Document (.docx)');
        });

        it('accepts .xlsx for a SPREADSHEET template, not .docx', () => {
            const fixture = build({
                template: template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME }),
            });

            expect(accept(fixture)).toBe(`.xlsx,${XLSX_MIME}`);
            expect(accept(fixture)).not.toContain('.docx');
            expect(copy(fixture)).toContain('Drop a .xlsx file here');
            expect(copy(fixture)).toContain('Accepted: Spreadsheet (.xlsx)');
            expect(copy(fixture)).not.toContain('Word');
        });

        it('accepts .pptx for a PRESENTATION template', () => {
            const fixture = build({
                template: template({ format: 'presentation', sourceMimeType: PPTX_MIME }),
            });

            expect(accept(fixture)).toBe(`.pptx,${PPTX_MIME}`);
            expect(copy(fixture)).toContain('Accepted: Presentation (.pptx)');
        });

        it('never offers the NATIVE half the payload advertises beside it', () => {
            // `format-info` says word is ['.docx', '.dtmpl'] — the whole list
            // would offer a file `replaceSource()` cannot read.
            expect(accept(build({ template: template() }))).not.toContain('.dtmpl');
            expect(
                accept(build({ template: template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME }) })),
            ).not.toContain('.dsheet');
        });

        it('offers the imported half even when the template ITSELF is native', () => {
            // A native spreadsheet's own source mime is the `.dsheet`, and
            // that is precisely the file the backend will not take back.
            const fixture = build({
                template: template({
                    format: 'spreadsheet',
                    native: true,
                    sourceMimeType: DSHEET_MIME,
                    path: '/docs/.templates/invoice.dsheet',
                }),
            });

            expect(accept(fixture)).toBe(`.xlsx,${XLSX_MIME}`);
            expect(accept(fixture)).not.toContain('.dsheet');
        });

        it('takes the extension a NEW format advertises, with no change here', () => {
            // Nothing in the frontend knows `markdown`; the row's own source
            // mime plus the payload's pairing name it anyway.
            const fixture = build({
                template: template({ format: 'markdown', sourceMimeType: 'text/x-markdown-tmpl' }),
            });
            http.expectOne(r => r.params.get('format') === 'markdown').flush({
                formats: [{
                    format: 'markdown',
                    label: 'Markdown',
                    icon: 'bi-markdown',
                    color: '#000',
                    mimeTypes: ['text/x-markdown-tmpl'],
                    extensions: ['.mdtmpl'],
                    supportsNativeAuthoring: true,
                }],
                acceptMimeTypes: [],
                acceptExtensions: [],
                acceptString: '',
            });
            fixture.detectChanges();

            expect(accept(fixture)).toBe('.mdtmpl,text/x-markdown-tmpl');
            expect(copy(fixture)).toContain('Accepted: Markdown (.mdtmpl)');
        });

        it('asks for nothing when the cache already answers', () => {
            const fixture = build({
                template: template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME }),
            });

            // A filtered fetch here would be a round-trip per dialog open for
            // an answer the page loaded once on mount.
            expect(http.match(r => r.url === '/api/v1/document/format-info').length).toBe(0);
            expect(accept(fixture)).toBe(`.xlsx,${XLSX_MIME}`);
        });

        it('still closes with null from the Cancel button', () => {
            const fixture = build({ template: template() });

            buttonLabelled(fixture, 'Cancel').click();

            expect(close).toHaveBeenCalledWith(null);
        });
    });

    describe('without a cached registry', () => {
        it('fetches just its own format', () => {
            const fixture = build({
                template: template({ format: 'spreadsheet', sourceMimeType: XLSX_MIME }),
            });

            const request = http.expectOne(r => r.url === '/api/v1/document/format-info');
            expect(request.request.params.get('format')).toBe('spreadsheet');
            request.flush({
                formats: [REGISTRY[1]],
                acceptMimeTypes: [],
                acceptExtensions: [],
                acceptString: '',
            });
            fixture.detectChanges();

            expect(accept(fixture)).toBe(`.xlsx,${XLSX_MIME}`);
            expect(copy(fixture)).toContain('Accepted: Spreadsheet (.xlsx)');
        });

        it('names the imported extension from the local map when the fetch fails', () => {
            // format-info is best-effort on the page too — its errors are
            // swallowed. A dialog that filtered to nothing here would be
            // worse than one that filters to the fallback map's answer.
            const fixture = build({
                template: template({ format: 'presentation', sourceMimeType: PPTX_MIME }),
            });
            http.expectOne(r => r.url === '/api/v1/document/format-info')
                .flush('nope', { status: 500, statusText: 'Server Error' });
            fixture.detectChanges();

            expect(accept(fixture)).toBe(`.pptx,${PPTX_MIME}`);
            expect(copy(fixture)).toContain('Accepted: Presentation (.pptx)');
        });

        it('leaves the picker unfiltered rather than guess an unknown format', () => {
            const fixture = build({
                template: template({ format: 'markdown', native: true, sourceMimeType: null }),
            });
            http.expectOne(r => r.url === '/api/v1/document/format-info')
                .flush({ formats: [], acceptMimeTypes: [], acceptExtensions: [], acceptString: '' });
            fixture.detectChanges();

            expect(accept(fixture)).toBe('');
            expect(copy(fixture)).toContain("Drop the template's source file here");
        });
    });
});
