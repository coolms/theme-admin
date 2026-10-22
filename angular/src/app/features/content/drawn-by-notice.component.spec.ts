import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { ToastService } from '@coolms/ui-angular';
import { BlockEditorComponent } from './block-editor.component';
import { type DrawnByDto, DrawnByNoticeComponent, describeDrawing } from './drawn-by-notice.component';

/**
 * "Drawn by" in the page editor (decided 2026-10-20): which frame draws the page, said where an editor works on it,
 * and a warning when an edit would not show. The test is whether the frame DRAWS the content, not whether one is
 * named: a frame with `{content}` is a quiet line, one without is a warning.
 */
describe('Drawn by: the page editor says which frame draws the page', () => {
    const FRAMED: DrawnByDto = {
        path: 'frame', frame: 'frames/site.html.dtmpl', origin: 'directory', namedBy: '/content/coolms-docs',
        hasContent: true, content: 'content/landing.html.dtmpl', sharedBy: 40, pages: 46, template: null,
    };

    function render(d: DrawnByDto | null): HTMLElement {
        TestBed.configureTestingModule({ imports: [DrawnByNoticeComponent] });
        const f = TestBed.createComponent(DrawnByNoticeComponent);
        f.componentRef.setInput('drawing', d);
        f.detectChanges();
        return f.nativeElement as HTMLElement;
    }

    it('a frame that draws the content: a quiet line naming the frame, where it came from and the renderer', () => {
        const el = render(FRAMED);
        const box = el.querySelector('.drawn-by') as HTMLElement;

        expect(box).withContext('shown').not.toBeNull();
        expect(box.classList.contains('drawn-by--warning')).withContext('no warning').toBeFalse();
        expect(box.getAttribute('role')).toBe('note');
        expect(box.textContent).toContain('Drawn by frames/site.html.dtmpl, its content by content/landing.html.dtmpl.');
        expect(box.textContent).toContain('The frame is inherited from /content/coolms-docs');
        expect(box.textContent).toContain("this frame draws 40 of the section's 46 pages");
    });

    it('a frame that does not draw the content: a warning that edits will not show', () => {
        const el = render({ ...FRAMED, frame: 'frames/hand-written.html.dtmpl', origin: 'page', hasContent: false });
        const box = el.querySelector('.drawn-by') as HTMLElement;

        expect(box.classList.contains('drawn-by--warning')).toBeTrue();
        expect(box.getAttribute('role')).toBe('alert');
        expect(box.textContent).toContain('drawn by frames/hand-written.html.dtmpl, which does not draw the page\'s content');
        expect(box.textContent).toContain('will not show');
        expect(box.textContent).toContain('The frame is set on this page');
    });

    it('nothing renders the content type: a warning too', () => {
        const v = describeDrawing({ ...FRAMED, content: null });

        expect(v?.tone).toBe('warning');
        expect(v?.text).toContain('nothing renders this page\'s content type');
    });

    it('each origin reads as where the frame was chosen', () => {
        const at = (origin: string, namedBy: string | null = null) => describeDrawing({ ...FRAMED, origin, namedBy })?.detail;

        expect(at('page')).toContain('set on this page');
        expect(at('directory', '/content/blog')).toContain('inherited from /content/blog');
        expect(at('section_root')).toContain("the section's own");
        expect(at('theme')).toContain("the theme's default");
        expect(at('fallback')).toContain("the platform's plain one");
    });

    it('a frame that is the only one of its kind does not count pages', () => {
        const v = describeDrawing({ ...FRAMED, sharedBy: 1, pages: 1 });

        expect(v?.detail).not.toContain('pages');
    });

    it('the template pipeline: names the template and claims nothing it was not told', () => {
        const v = describeDrawing({ path: 'template', template: 'pages/landing.html.dtmpl' });

        expect(v?.tone).toBe('info');
        expect(v?.text).toBe('Drawn by the template pages/landing.html.dtmpl, not by a frame.');
        expect(v?.text).not.toContain('will not show');
    });

    it('no answer, or one of an unknown shape: nothing shown', () => {
        expect(render(null).querySelector('.drawn-by')).toBeNull();
        expect(describeDrawing({ path: 'frame', frame: null })).toBeNull();
        expect(describeDrawing({ path: 'something-new', frame: 'x' })).toBeNull();
    });
});

describe('BlockEditorComponent -- hands the page editor its "drawn by"', () => {
    const PATH = '/content/default/about';
    const READ = '/api/v1/content/landing-blocks?path=%2Fcontent%2Fdefault%2Fabout';
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

    function opened(): { seen: (DrawnByDto | null)[]; flush: (body: Record<string, unknown> | null, status?: number) => void } {
        const f = TestBed.createComponent(BlockEditorComponent);
        const seen: (DrawnByDto | null)[] = [];
        f.componentInstance.drawnByChange.subscribe(d => seen.push(d));
        f.componentRef.setInput('path', PATH);
        f.detectChanges();
        return {
            seen,
            flush: (body, status = 200) => {
                const req = http.expectOne(READ);
                if (status === 200) {
                    req.flush(body);
                } else {
                    req.flush({ detail: 'x' }, { status, statusText: 'x' });
                }
                f.detectChanges();
            },
        };
    }

    it('emits the answer\'s drawnBy for a page that is not a landing page as well', () => {
        const o = opened();
        const drawing = { path: 'frame', frame: 'frames/site.html.dtmpl', hasContent: false, content: 'content/page.html.dtmpl' };
        o.flush({ types: [], blocks: [], contentType: 'page', drawnBy: drawing });

        expect(o.seen).toEqual([drawing]);
    });

    it('emits null when the read fails, so a stale notice never stays', () => {
        const o = opened();
        o.flush(null, 500);

        expect(o.seen).toEqual([null]);
    });
});
