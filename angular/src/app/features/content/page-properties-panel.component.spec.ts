import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ConfirmDialogService } from '@coolms/ui-angular';
import { PagePropertiesPanelComponent } from './page-properties-panel.component';

/**
 * The page-properties panel: per property, what applies to the page and where each value was set, and what
 * the page sets itself, each card saving itself with the version it was read at. A save that finds THIS property
 * changed by someone else sends nothing more until the editor chooses to save over it or to reload.
 */
describe('Page properties: each card shows where its values come from and saves itself', () => {
    const URL = '/api/v1/web/page-properties';
    const PAGE = '/content/site/docs/page';
    let http: HttpTestingController;

    function view(own: Record<string, unknown> = {}, version = 'v1', extra: Record<string, unknown> = {}): object {
        return {
            path: PAGE,
            locale: 'de',
            properties: {
                meta: {
                    merge: 'keyed',
                    values: { author: 'Ann', keywords: 'docs' },
                    sources: {
                        author: { label: PAGE, scope: '*', isPage: true, link: PAGE },
                        keywords: { label: '/content/site/docs', scope: 'de', isPage: false, link: '/content/site/docs' },
                    },
                    stoppedAt: null,
                },
                og: {
                    merge: 'keyed',
                    values: {},
                    sources: {},
                    stoppedAt: { label: 'private', scope: '*', isPage: false, link: null },
                },
                twitter: { merge: 'keyed', values: [], sources: [], stoppedAt: null },
                x_default: { merge: 'single', values: { '': 'en' }, sources: { '': { label: 'secret', scope: '*', isPage: true, link: null } }, stoppedAt: null },
                ...extra,
            },
            own,
            version,
        };
    }

    function open(first: object = view()): { el: HTMLElement; panel: PagePropertiesPanelComponent; detect: () => void } {
        TestBed.configureTestingModule({
            imports: [PagePropertiesPanelComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        const f = TestBed.createComponent(PagePropertiesPanelComponent);
        f.componentRef.setInput('path', PAGE);
        f.componentRef.setInput('locale', 'de');
        f.detectChanges();
        read().flush(first);
        f.detectChanges();
        return { el: f.nativeElement as HTMLElement, panel: f.componentInstance, detect: () => f.detectChanges() };
    }

    function read(): TestRequest {
        return http.expectOne(r => r.method === 'GET' && r.url === URL && r.params.get('path') === PAGE
            && r.params.get('locale') === 'de');
    }

    function write(): TestRequest {
        return http.expectOne(r => r.method === 'POST' && r.url === URL);
    }

    function card(el: HTMLElement, name: string): HTMLElement {
        return el.querySelector(`section[aria-label="${name}"]`) as HTMLElement;
    }

    function refuse(req: TestRequest, status: number, detail = ''): void {
        req.flush({ detail }, { status, statusText: 'refused' });
    }

    afterEach(() => http.verify());

    it('draws one card per property the server declares, a fifth included, with no client list', () => {
        const { el } = open(view({}, 'v1', { robots: { merge: 'keyed', values: {}, sources: {}, stoppedAt: null } }));

        const names = Array.from(el.querySelectorAll('section.pp-card')).map(s => s.getAttribute('aria-label'));
        expect(names).toEqual(['meta', 'og', 'twitter', 'x_default', 'robots']);
    });

    it('names each source: this page, a folder by its path and language, a node the reader cannot open by name only', () => {
        const { el } = open();

        const meta = card(el, 'meta').textContent ?? '';
        expect(meta).toContain('from this page');
        expect(meta).toContain('from /content/site/docs (de)');
        expect(card(el, 'x_default').textContent).toContain('from secret (you cannot open it)');
        expect(card(el, 'og').textContent).toContain('Inheritance stopped at private (you cannot open it).');
    });

    it('saves a card with its op, its values, its languages and the version it was read at', () => {
        const { el, panel, detect } = open();

        panel.setOp('meta', 'override');
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'Bo');
        detect();
        expect(panel.dirty()).toBeTrue();
        (el.querySelector('button[aria-label="Save meta"]') as HTMLButtonElement).click();

        const req = write();
        expect(req.request.body).toEqual({
            path: PAGE, scope: '*', property: 'meta', op: 'override', values: { author: 'Bo' }, version: 'v1',
        });
        req.flush(view({ '*': { meta: { op: 'override', values: { author: 'Bo' } } } }, 'v2'));
        read().flush(view({ '*': { meta: { op: 'override', values: { author: 'Bo' } } } }, 'v2'));
        expect(panel.dirty()).toBeFalse();
    });

    it('sends the page language as the scope when the card is switched to it', () => {
        const { panel } = open();

        panel.setScope('meta', 'de');
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'Bo');
        panel.save('meta');

        expect(write().request.body.scope).toBe('de');
    });

    it('after a 412 that changed THIS property, shows theirs and sends nothing until the editor chooses', () => {
        const { el, panel, detect } = open();
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'Mine');
        panel.save('meta');
        refuse(write(), 412);
        read().flush(view({ '*': { meta: { op: 'append', values: { author: 'Theirs' } } } }, 'v2'));
        detect();

        expect(card(el, 'meta').textContent).toContain('Theirs now: Add to what is inherited: author = Theirs');
        panel.save('meta');
        http.expectNone(r => r.method === 'POST');
        expect(panel.cards().find(c => c.name === 'meta')?.version).toBe('v1');

        panel.saveOverTheirs('meta');
        const req = write();
        expect(req.request.body.version).toBe('v2');
        expect(req.request.body.values).toEqual({ author: 'Mine' });
    });

    it('after a 412 that changed only ANOTHER property, takes the new version and asks for the save again', () => {
        const { el, panel, detect } = open();
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'Mine');
        panel.save('meta');
        refuse(write(), 412);
        read().flush(view({ '*': { og: { op: 'append', values: { type: 'article' } } } }, 'v2'));
        detect();

        expect(card(el, 'meta').textContent).toContain('this one did not. Save again.');
        panel.save('meta');
        expect(write().request.body.version).toBe('v2');
    });

    it('Reload drops the rows, after a confirm, for the values as they now are', () => {
        const { panel } = open();
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'Mine');
        panel.save('meta');
        refuse(write(), 412);
        read().flush(view({ '*': { meta: { op: 'append', values: { author: 'Theirs' } } } }, 'v2'));

        panel.reloadCard('meta');

        const meta = panel.cards().find(c => c.name === 'meta');
        expect(meta?.rows).toEqual([{ key: 'author', value: 'Theirs' }]);
        expect(meta?.version).toBe('v2');
        expect(panel.dirty()).toBeFalse();
    });

    it('resets a set the page has, naming the version', () => {
        const { el, detect } = open(view({ '*': { og: { op: 'stop', values: {} } } }));
        detect();

        (el.querySelector('button[aria-label="Reset og"]') as HTMLButtonElement).click();

        const req = write();
        expect(req.request.body).toEqual({ path: PAGE, scope: '*', property: 'og', op: 'reset', values: {}, version: 'v1' });
        req.flush(view());
        read().flush(view({}, 'v2'));
    });

    it('shows a refusal in the server\'s words, on the card it belongs to', () => {
        const { el, panel, detect } = open();
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'description');
        panel.setRow('meta', 0, 'value', 'x');
        panel.save('meta');
        refuse(write(), 422, 'meta "description" is set by the page itself.');
        detect();

        expect(card(el, 'meta').querySelector('[role="alert"]')?.textContent).toContain('is set by the page itself.');
    });

    it('turns read-only on a 403: no Save is offered any more', () => {
        const { el, panel, detect } = open();
        panel.addRow('meta');
        panel.setRow('meta', 0, 'key', 'author');
        panel.setRow('meta', 0, 'value', 'x');
        panel.save('meta');
        refuse(write(), 403);
        detect();

        expect(el.querySelector('button[aria-label^="Save"]')).toBeNull();
        expect(el.textContent).toContain('You may read these properties but not change them.');
    });
});
