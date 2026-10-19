import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Observable, of, throwError } from 'rxjs';
import { Store } from '@ngxs/store';
import { ConfirmDialogService, FieldWidgetRegistry, ToastService } from '@coolms/ui-angular';
import { PageEditorComponent } from './page-editor.component';
import { PageService } from './page.service';
import { MarkdownService } from './markdown.service';
import { FileHistoryService } from './file-history.service';
import { EditorPanelsService } from './editor-panels.service';
import { PageSizeService } from './page-size.service';
import { ContentFieldPanelsService } from './content-field-panels.service';
import { EditorCollabService } from './editor-collab.service';
import { DtmplContentAdapter } from './dtmpl-content-adapter';
import { PageDto, PageVariantDto } from './page.types';

/**
 * A body that could not be read is not an empty body (2026-10-15): the editor once marked a failed read as loaded
 * with '', and a title save then wrote '' over the stored body, with no If-Match because no version was ever read.
 * Every press that writes the body -- the save of a meta edit, Publish, Submit for review -- writes it only after its
 * read succeeded. The template is not rendered here: what is asked is what the editor sends.
 */
describe('PageEditorComponent -- a body that could not be read is never written', () => {
    const PAGE = { id: 'p1', slug: 'about', vfsPath: '/content/default/about' } as PageDto;
    const VARIANT = { id: 'v1', pageId: 'p1', locale: 'en', status: 'draft', title: 'About', extras: {} } as PageVariantDto;

    let pages: {
        listPageTypes: jasmine.Spy;
        listVariants: jasmine.Spy;
        getContent: jasmine.Spy;
        saveContent: jasmine.Spy;
        updateVariant: jasmine.Spy;
        publishVariant: jasmine.Spy;
        submitForReview: jasmine.Spy;
    };
    let toast: { error: jasmine.Spy; success: jasmine.Spy };

    function anEditorWhoseBodyRead(answers: Observable<{ content: string }>): PageEditorComponent {
        pages = {
            listPageTypes: jasmine.createSpy('listPageTypes').and.returnValue(of([])),
            listVariants: jasmine.createSpy('listVariants').and.returnValue(of([VARIANT])),
            getContent: jasmine.createSpy('getContent').and.returnValue(answers),
            saveContent: jasmine.createSpy('saveContent').and.returnValue(of({ contentHash: 'h2' })),
            updateVariant: jasmine.createSpy('updateVariant').and.returnValue(of(VARIANT)),
            publishVariant: jasmine.createSpy('publishVariant').and.returnValue(of({ status: 'published' })),
            submitForReview: jasmine.createSpy('submitForReview').and.returnValue(of(VARIANT)),
        };
        toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') };
        const collab = {
            peers: signal([]),
            peerSaved: signal(null),
            stop: () => undefined,
            watch: () => undefined,
            acknowledgeSaved: () => undefined,
        };
        TestBed.configureTestingModule({
            imports: [PageEditorComponent],
            providers: [
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DIALOG_DATA, useValue: { page: PAGE } },
                { provide: PageService, useValue: pages },
                { provide: ToastService, useValue: toast },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: MarkdownService, useValue: {} },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: FileHistoryService, useValue: { log: () => of({ canWrite: false, revisions: [] }) } },
                { provide: EditorPanelsService, useValue: { getPanels: () => of([]) } },
                { provide: PageSizeService, useValue: { fetch: () => of({ options: [], pageSize: '', pageWidth: null }) } },
                { provide: ContentFieldPanelsService, useValue: { fetch: () => of({ panels: [] }) } },
                { provide: FieldWidgetRegistry, useValue: { componentFor: () => null } },
                { provide: DtmplContentAdapter, useValue: {} },
            ],
        });
        TestBed.overrideComponent(PageEditorComponent, {
            set: { template: '', imports: [], providers: [{ provide: EditorCollabService, useValue: collab }] },
        });
        const fixture = TestBed.createComponent(PageEditorComponent);
        fixture.detectChanges();

        return fixture.componentInstance;
    }

    const aFailedRead = (): Observable<never> => throwError(() => new HttpErrorResponse({ status: 500 }));

    it('a title saved after the body read failed writes the title, never the body', () => {
        const editor = anEditorWhoseBodyRead(aFailedRead());
        expect(editor.activeBodyUnreadable()).withContext('the read failed, and the editor says so').toBeTrue();

        editor.onTitleChange('About us');
        editor.saveAll();

        expect(pages.updateVariant).withContext('the title is saved').toHaveBeenCalled();
        expect(pages.saveContent).withContext('the body is not written').not.toHaveBeenCalled();
    });

    it('the control: the same title save after a read that succeeded writes the body it read', () => {
        const editor = anEditorWhoseBodyRead(of({ content: '<p>the stored body</p>' }));
        expect(editor.activeBodyUnreadable()).toBeFalse();

        editor.onTitleChange('About us');
        editor.saveAll();

        expect(pages.saveContent).toHaveBeenCalledWith('p1', 'en', '<p>the stored body</p>');
    });

    it('Publish after the body read failed writes nothing and publishes nothing, and says why', () => {
        const editor = anEditorWhoseBodyRead(aFailedRead());

        editor.publish();

        expect(pages.saveContent).not.toHaveBeenCalled();
        expect(pages.publishVariant).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(jasmine.stringContaining('could not be read'));
    });

    it('Submit for review after the body read failed writes nothing and submits nothing', () => {
        const editor = anEditorWhoseBodyRead(aFailedRead());

        editor.submitForReview();

        expect(pages.saveContent).not.toHaveBeenCalled();
        expect(pages.submitForReview).not.toHaveBeenCalled();
    });

    it('"Read it again" reads the body again, and a read that succeeds makes it writable', () => {
        const editor = anEditorWhoseBodyRead(aFailedRead());
        pages.getContent.and.returnValue(of({ content: '<p>read at last</p>' }));

        editor.retryBody();
        editor.onTitleChange('About us');
        editor.saveAll();

        expect(editor.activeBodyUnreadable()).toBeFalse();
        expect(pages.saveContent).toHaveBeenCalledWith('p1', 'en', '<p>read at last</p>');
    });
});
