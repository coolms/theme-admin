import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { ToastService } from '@coolms/ui-angular';
import { BlockEditorComponent } from './block-editor.component';

/**
 * The landing-block editor edits the sections as stored and saves them naming their version.
 *
 * The read answers two lists: `blocks`, the render view (unknown types and undeclared keys dropped), and
 * `storedBlocks`, extras.blocks exactly as stored. The editor edits the stored list -- a block it does not know is
 * kept as it is, keys it does not edit are carried -- and every save names the version read (If-Match). A save
 * refused 412 is said, and no save follows until a reload. A read without the stored list is never saved over.
 */
describe('BlockEditorComponent -- the sections as stored, saved over the version read', () => {
    const PATH = '/content/default/landing';
    const READ = '/api/v1/content/landing-blocks?path=%2Fcontent%2Fdefault%2Flanding';
    const WRITE = '/api/v1/vfs/files?path=%2Fcontent%2Fdefault%2Flanding';
    const TYPES = [{ id: 'hero', label: 'Hero', fields: [{ name: 'title', kind: 'text', itemFields: [] }] }];
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [BlockEditorComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined, info: () => undefined } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function opened(answer: Record<string, unknown>) {
        const f = TestBed.createComponent(BlockEditorComponent);
        f.componentRef.setInput('path', PATH);
        f.detectChanges();
        http.expectOne(READ).flush({ types: TYPES, contentType: 'landing', ...answer });
        f.detectChanges();
        return f;
    }

    it('edits the stored list: an unknown block and an undeclared key go back untouched, with If-Match', () => {
        const f = opened({
            blocks: [{ type: 'hero', title: 'Hi' }],
            storedBlocks: [{ type: 'hero', title: 'Hi', note: 'kept' }, { type: 'retired_widget', anything: 1 }],
            version: 'm1',
        });
        expect((f.nativeElement as HTMLElement).textContent).toContain('kept as it is');

        f.componentInstance.setField(0, 'title', 'Hello');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        const first = http.expectOne(WRITE);
        expect(first.request.headers.get('If-Match')).toBe('"m1"');
        expect(first.request.body.extras.blocks).toEqual([
            { type: 'hero', title: 'Hello', note: 'kept' },
            { type: 'retired_widget', anything: 1 },
        ]);
        first.flush({}, { headers: { ETag: '"m2"' } });

        f.componentInstance.setField(0, 'title', 'Hello again');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        expect(http.expectOne(WRITE).request.headers.get('If-Match')).withContext('the version the save answered').toBe('"m2"');
    });

    it('a save refused 412 is said, and nothing more is sent until a reload', () => {
        const f = opened({ blocks: [], storedBlocks: [{ type: 'hero', title: 'Hi' }], version: 'm1' });

        f.componentInstance.setField(0, 'title', 'Mine');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        http.expectOne(WRITE).flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });
        f.detectChanges();
        expect(f.componentInstance.conflict()).toBe('changed');
        expect((f.nativeElement as HTMLElement).querySelector('.blk__conflict')).not.toBeNull();

        f.componentInstance.setField(0, 'title', 'Mine, again');
        f.detectChanges();
        let refused = false;
        f.componentInstance.save$().subscribe({ error: () => (refused = true) });
        http.expectNone(WRITE);
        expect(refused).withContext('the save is refused, not sent').toBeTrue();
    });

    it('Reload after a refusal reads the sections and their version again, and the next save names it', () => {
        const f = opened({ blocks: [], storedBlocks: [{ type: 'hero', title: 'Hi' }], version: 'm1' });
        f.componentInstance.setField(0, 'title', 'Mine');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        http.expectOne(WRITE).flush({}, { status: 412, statusText: 'Precondition Failed' });
        f.detectChanges();

        f.componentInstance.reloadAfterConflict();
        http.expectOne(READ).flush({ types: TYPES, contentType: 'landing', blocks: [], storedBlocks: [{ type: 'hero', title: 'Theirs' }], version: 'm5' });
        f.detectChanges();
        expect(f.componentInstance.conflict()).toBeNull();

        f.componentInstance.setField(0, 'title', 'Mine over theirs');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        expect(http.expectOne(WRITE).request.headers.get('If-Match')).toBe('"m5"');
    });

    it('a page deleted since it was opened is said as deleted, not as a newer save by someone else', () => {
        const f = opened({ blocks: [], storedBlocks: [{ type: 'hero', title: 'Hi' }], version: 'm1' });
        f.componentInstance.setField(0, 'title', 'Mine');
        f.detectChanges();
        f.componentInstance.save$().subscribe({ error: () => undefined });
        http.expectOne(WRITE).flush({}, { status: 404, statusText: 'Not Found' });
        f.detectChanges();
        expect(f.componentInstance.conflict()).toBe('deleted');
        expect((f.nativeElement as HTMLElement).querySelector('.blk__conflict')?.textContent).toContain('deleted');
    });

    it('a read without the stored list is the render view: shown, never saved over', () => {
        const f = opened({ blocks: [{ type: 'hero', title: 'Hi' }], version: 'm1' });

        f.componentInstance.setField(0, 'title', 'Mine');
        f.detectChanges();
        let refused = false;
        f.componentInstance.save$().subscribe({ error: () => (refused = true) });
        http.expectNone(WRITE);
        expect(refused).withContext('the save is refused, not sent').toBeTrue();
    });
});
