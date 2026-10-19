import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Observable, Subject, of } from 'rxjs';
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
 * A read that has not ended, or ended part-way, never leaves Save able to write over what it did not deliver.
 *
 * - A body still being read is not an empty body. The editor once mounted empty during the read and took edits; the
 *   stored body then arrived without replacing them, and Save wrote them over it with the version just read.
 * - An SEO field the person never saw is not written. A title edited before the SEO field list arrived once cached
 *   an empty SEO map, and Save then sent null for every declared field, removing the stored values.
 *
 * The template is rendered (the editor surface is not: unknown elements stand in for it), because what is asked is
 * whether there is an editor to type into at all.
 */
describe('PageEditorComponent -- reads that have not ended, or ended part-way', () => {
    const PAGE = { id: 'p1', slug: 'about', vfsPath: '/content/default/about' } as PageDto;
    const VARIANT = {
        id: 'v1', pageId: 'p1', locale: 'en', status: 'draft', title: 'About',
        extras: { metaTitle: 'Stored title', metaDescription: 'Stored description' },
    } as unknown as PageVariantDto;
    const SEO = { panels: [{ group: 'seo', fields: [{ name: 'metaTitle' }, { name: 'metaDescription' }] }] };

    let pages: { [k: string]: jasmine.Spy };

    function anEditor(body: Observable<{ content: string }>, fields: Observable<unknown>): ComponentFixture<PageEditorComponent> {
        pages = {
            listPageTypes: jasmine.createSpy('listPageTypes').and.returnValue(of([])),
            listVariants: jasmine.createSpy('listVariants').and.returnValue(of([VARIANT])),
            getContent: jasmine.createSpy('getContent').and.returnValue(body),
            saveContent: jasmine.createSpy('saveContent').and.returnValue(of({ contentHash: 'h2' })),
            updateVariant: jasmine.createSpy('updateVariant').and.returnValue(of(VARIANT)),
        };
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
                { provide: ToastService, useValue: { error: () => undefined, success: () => undefined } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: MarkdownService, useValue: {} },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: FileHistoryService, useValue: { log: () => of({ canWrite: false, revisions: [] }) } },
                { provide: EditorPanelsService, useValue: { getPanels: () => of([]) } },
                { provide: PageSizeService, useValue: { fetch: () => of({ options: [], pageSize: '', pageWidth: null }) } },
                { provide: ContentFieldPanelsService, useValue: { fetch: () => fields } },
                { provide: FieldWidgetRegistry, useValue: { componentFor: () => null } },
                { provide: DtmplContentAdapter, useValue: {} },
            ],
        });
        TestBed.overrideComponent(PageEditorComponent, {
            set: { imports: [], schemas: [NO_ERRORS_SCHEMA], providers: [{ provide: EditorCollabService, useValue: collab }] },
        });
        const fixture = TestBed.createComponent(PageEditorComponent);
        fixture.detectChanges();

        return fixture;
    }

    const editorShown = (f: ComponentFixture<PageEditorComponent>): boolean => {
        f.detectChanges();
        return f.nativeElement.querySelector('coolms-editor') !== null;
    };

    it('no editor while the body is being read; an edit sent meanwhile is not taken; Save writes the body read', () => {
        const body = new Subject<{ content: string }>();
        const f = anEditor(body, of({ panels: [] }));
        const editor = f.componentInstance;

        expect(editor.activeBodyReading()).withContext('the read is in flight').toBeTrue();
        expect(editorShown(f)).withContext('nothing to type into before the body is there').toBeFalse();
        expect(f.nativeElement.querySelector('.page-editor__reading')).not.toBeNull();

        editor.onContentChange('<p>typed before the body arrived</p>');
        expect(editor.anyDirty()).withContext('an edit to a body not read is not taken').toBeFalse();

        body.next({ content: '<p>the stored body</p>' });
        body.complete();
        expect(editor.activeBodyReading()).toBeFalse();
        expect(editorShown(f)).withContext('the editor mounts with the body').toBeTrue();

        editor.onTitleChange('About us');
        editor.saveAll();
        expect(pages['saveContent']).toHaveBeenCalledWith('p1', 'en', '<p>the stored body</p>');
    });

    it('a title edited before the SEO fields arrived keeps every stored SEO value, and Save writes none as empty', () => {
        const fields = new Subject<unknown>();
        const f = anEditor(of({ content: '<p>body</p>' }), fields);
        const editor = f.componentInstance;

        editor.onTitleChange('About us');
        fields.next(SEO);
        fields.complete();
        f.detectChanges();

        editor.saveAll();
        expect(pages['updateVariant']).toHaveBeenCalledTimes(1);
        const patch = pages['updateVariant'].calls.mostRecent().args[2] as { title: string; extras?: Record<string, unknown> };
        expect(patch.title).toBe('About us');
        expect(patch.extras ?? {}).withContext('no stored SEO value is sent as empty')
            .not.toEqual(jasmine.objectContaining({ metaTitle: null }));
        expect(patch.extras ?? {}).not.toEqual(jasmine.objectContaining({ metaDescription: null }));
    });
});
