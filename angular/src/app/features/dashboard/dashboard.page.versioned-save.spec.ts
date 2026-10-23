import { TestBed, fakeAsync, flushMicrotasks, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ConfigService, NaviGraphService } from '@coolms/core-angular';
import { LayoutActionsService } from '@coolms/ui-angular';
import { DashboardPageComponent } from './dashboard.page';

/** What the specs drive and read; protected on the component. */
interface DashboardView {
    onAction(id: string): void;
    reloadAfterConflict(): void;
    editing(): boolean;
    changedElsewhere(): boolean;
    saveError(): string | null;
    actionContext(): Record<string, unknown>;
}

/**
 * Each person arranges their own dashboards, saved over the version they were read at.
 *
 * The catalogue answers the version of all of the person's dashboards (ETag) and whether arranging is possible
 * (`canArrange`). Save and Reset name the version (If-Match). Refused 412, the page says so, keeps the arrangement on
 * screen, sends nothing again, and Reload reads the dashboards again. An installation that keeps no personal layouts
 * offers no Arrange. A server that still keeps one layout for everyone sends no `canArrange`, and is saved to as
 * before: with no ETag, nothing is named; with the ETag its framework adds, that goes back as If-Match.
 */
describe('DashboardPageComponent -- each person arranges their own dashboards, saved over the version read', () => {
    const WIDGETS = '/api/v1/dashboard/widgets';
    const LAYOUT = '/api/v1/dashboard/layout';
    // Hidden: a hidden card's endpoint is not called, so the catalogue is the only read.
    const WIDGET = { id: 'vfs.file-count', label: 'Files', icon: 'files', endpoint: '/api/v1/x', valuePath: 'n', kind: 'stat', columns: 3, hidden: true };
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [DashboardPageComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ConfigService, useValue: { layout: () => of({ headerActions: [] }) } },
                { provide: LayoutActionsService, useValue: { resolve: () => [] } },
                { provide: NaviGraphService, useValue: {} },
                { provide: Dialog, useValue: { open: () => ({ closed: of(null) }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function view(f: ComponentFixture<DashboardPageComponent>): DashboardView {
        return f.componentInstance as unknown as DashboardView;
    }

    function answerCatalogue(body: Record<string, unknown>, etag: string | null): void {
        http.expectOne(WIDGETS).flush(body, { headers: null === etag ? {} : { ETag: etag } });
        flushMicrotasks();
    }

    function opened(body: Record<string, unknown>, etag: string | null): ComponentFixture<DashboardPageComponent> {
        const f = TestBed.createComponent(DashboardPageComponent);
        f.detectChanges();
        answerCatalogue(body, etag);
        f.detectChanges();
        return f;
    }

    const PERSONAL = { widgets: [WIDGET], sections: [], canArrange: true };

    it('a save names the version read, and the next one the version read after it', fakeAsync(() => {
        const f = opened(PERSONAL, '"d1"');

        view(f).onAction('arrange');
        view(f).onAction('save');
        const first = http.expectOne(LAYOUT);
        expect(first.request.method).toBe('PUT');
        expect(first.request.headers.get('If-Match')).toBe('"d1"');
        first.flush({ version: 'd2' }, { headers: { ETag: '"d2"' } });
        flushMicrotasks();
        answerCatalogue(PERSONAL, '"d2"');
        expect(view(f).editing()).toBeFalse();

        view(f).onAction('arrange');
        view(f).onAction('save');
        const second = http.expectOne(LAYOUT);
        expect(second.request.headers.get('If-Match')).withContext('the version read after the first save').toBe('"d2"');
        second.flush({ version: 'd3' }, { headers: { ETag: '"d3"' } });
        flushMicrotasks();
        answerCatalogue(PERSONAL, '"d3"');
    }));

    it('changed elsewhere: said, the arrangement kept, nothing sent again; Reload reads the dashboards again', fakeAsync(() => {
        const f = opened(PERSONAL, '"d1"');

        view(f).onAction('arrange');
        view(f).onAction('save');
        http.expectOne(LAYOUT).flush({ detail: 'stale' }, { status: 412, statusText: 'Precondition Failed' });
        flushMicrotasks();
        f.detectChanges();

        expect(view(f).changedElsewhere()).toBeTrue();
        expect(view(f).editing()).withContext('the arrangement stays on screen').toBeTrue();
        expect(view(f).saveError()).toBeNull();
        expect((f.nativeElement as HTMLElement).textContent).toContain('Your dashboards were changed somewhere else');
        expect(view(f).actionContext()['_changedElsewhere']).toBeTrue();

        view(f).onAction('save');
        view(f).onAction('reset');
        flushMicrotasks();
        http.expectNone(LAYOUT);

        view(f).reloadAfterConflict();
        answerCatalogue(PERSONAL, '"d9"');
        expect(view(f).changedElsewhere()).toBeFalse();
        expect(view(f).editing()).toBeFalse();
    }));

    it('a person offered no widget: a refused save is said on the empty dashboard, with Reload', fakeAsync(() => {
        const EMPTY = { widgets: [], sections: [], canArrange: true };
        const f = opened(EMPTY, '"d1"');
        const host = f.nativeElement as HTMLElement;
        expect(host.textContent).toContain('No dashboard widgets are offered to you.');

        view(f).onAction('arrange');
        view(f).onAction('save');
        http.expectOne(LAYOUT).flush({ detail: 'stale' }, { status: 412, statusText: 'Precondition Failed' });
        flushMicrotasks();
        f.detectChanges();

        expect(host.textContent).toContain('Your dashboards were changed somewhere else');
        const reload = Array.from(host.querySelectorAll('button'))
            .find(b => b.textContent?.includes('Reload, discarding my arrangement')) as HTMLButtonElement;
        expect(reload).withContext('Reload is offered on the empty dashboard').toBeDefined();
        reload.click();
        answerCatalogue(EMPTY, '"d2"');
        f.detectChanges();
        expect(host.textContent).not.toContain('Your dashboards were changed somewhere else');
    }));

    it('a person offered no widget: a save that failed is said on the empty dashboard', fakeAsync(() => {
        const f = opened({ widgets: [], sections: [], canArrange: true }, '"d1"');

        view(f).onAction('arrange');
        view(f).onAction('save');
        http.expectOne(LAYOUT).flush({ detail: 'The layout names a widget you are not offered.' }, { status: 422, statusText: 'Unprocessable' });
        flushMicrotasks();
        f.detectChanges();

        expect((f.nativeElement as HTMLElement).querySelector('.alert-danger')?.textContent)
            .toContain('The layout names a widget you are not offered.');
    }));

    it('Reset names the version too, and its 412 is said the same way', fakeAsync(() => {
        const f = opened(PERSONAL, '"d1"');

        view(f).onAction('arrange');
        view(f).onAction('reset');
        const req = http.expectOne(LAYOUT);
        expect(req.request.method).toBe('DELETE');
        expect(req.request.headers.get('If-Match')).toBe('"d1"');
        req.flush(null, { status: 412, statusText: 'Precondition Failed' });
        flushMicrotasks();

        expect(view(f).changedElsewhere()).toBeTrue();
        expect(view(f).editing()).toBeTrue();
    }));

    it('an installation that keeps no personal layouts offers no Arrange, and arranging does not start', fakeAsync(() => {
        const f = opened({ ...PERSONAL, canArrange: false }, '"d1"');

        expect(view(f).actionContext()['_canArrange']).toBeFalse();
        view(f).onAction('arrange');
        expect(view(f).editing()).toBeFalse();
    }));

    it('whose arrangement it is: only yours when the server keeps personal layouts', fakeAsync(() => {
        const f = opened(PERSONAL, '"d1"');

        view(f).onAction('arrange');
        f.detectChanges();
        const text = (f.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('Only you see this arrangement.');
        expect(text).not.toContain('shared with everyone');
    }));

    it('a server that keeps one layout for everyone: said so, and saved to without a version, as before', fakeAsync(() => {
        const f = opened({ widgets: [WIDGET], sections: [] }, null);

        expect(view(f).actionContext()['_canArrange']).withContext('no canArrange: arranging stays offered').toBeTrue();
        view(f).onAction('arrange');
        f.detectChanges();
        expect((f.nativeElement as HTMLElement).textContent).toContain('This arrangement is shared with everyone.');

        view(f).onAction('save');
        const req = http.expectOne(LAYOUT);
        expect(req.request.headers.has('If-Match')).toBeFalse();
        req.flush({ storedAt: 'x' });
        flushMicrotasks();
        answerCatalogue({ widgets: [WIDGET], sections: [] }, null);
    }));

    it('a server that keeps one layout for everyone, with an ETag of its own: sent back, and saved as before', fakeAsync(() => {
        // API Platform adds a content ETag to a read by default; such a server does not check If-Match on the write.
        const f = opened({ widgets: [WIDGET], sections: [] }, 'W/"c0ffee"');

        view(f).onAction('arrange');
        f.detectChanges();
        expect((f.nativeElement as HTMLElement).textContent).toContain('This arrangement is shared with everyone.');

        view(f).onAction('save');
        const req = http.expectOne(LAYOUT);
        expect(req.request.headers.get('If-Match')).toBe('W/"c0ffee"');
        req.flush({ storedAt: 'x' });
        flushMicrotasks();
        answerCatalogue({ widgets: [WIDGET], sections: [] }, 'W/"c0ffee2"');
        expect(view(f).editing()).toBeFalse();
        expect(view(f).changedElsewhere()).toBeFalse();
    }));
});
