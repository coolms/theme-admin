import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Observable, of, throwError } from 'rxjs';
import { Store } from '@ngxs/store';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';
import { SiteScriptSourcesCardComponent } from './site-script-sources-card.component';
import { SectionsApiService } from './sections-api.service';
import { AddSiteScriptSourceDto, SiteScriptSourceDto } from './sections.types';

const SOURCE: SiteScriptSourceDto = {
    id: 'e1',
    kind: 'script',
    url: 'https://cdn.example.net/lib@1.2.3/lib.min.js',
    integrity: 'sha384-AAAA',
    addedBy: 'a1',
    addedAt: '2026-11-03T07:00:00+00:00',
};

/**
 * A site's allow-list card. It shows each entry; adding sends the three fields trimmed, and a refusal is shown in the
 * server's words with nothing added; removing asks first, sends the entry's id only after the confirmation, and a
 * refusal (a page still names the file) is shown. The list is read again after each change.
 */
describe('SiteScriptSourcesCardComponent', () => {
    let added: AddSiteScriptSourceDto[];
    let removed: string[];
    let reads: number;
    let confirmed: boolean;
    let addAnswer: () => Observable<SiteScriptSourceDto>;
    let removeAnswer: () => Observable<void>;

    function create() {
        added = [];
        removed = [];
        reads = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [SiteScriptSourcesCardComponent],
            providers: [
                {
                    provide: SectionsApiService,
                    useValue: {
                        listScriptSources: () => { reads++; return of([SOURCE]); },
                        addScriptSource: (_id: string, dto: AddSiteScriptSourceDto) => { added.push(dto); return addAnswer(); },
                        removeScriptSource: (_id: string, sourceId: string) => { removed.push(sourceId); return removeAnswer(); },
                    },
                },
                { provide: ErrorHandlerService, useValue: { humanize: (e: HttpErrorResponse) => `refused ${e.status}` } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
                { provide: ConfirmDialogService, useValue: { open: () => of(confirmed) } },
            ],
        });
        const fixture = TestBed.createComponent(SiteScriptSourcesCardComponent);
        fixture.componentRef.setInput('sectionId', 's1');
        fixture.detectChanges();

        return fixture;
    }

    beforeEach(() => {
        confirmed = true;
        addAnswer = () => of(SOURCE);
        removeAnswer = () => of(undefined);
    });

    it('shows each entry of the list', () => {
        const fixture = create();
        const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-test="script-source"]');

        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain(SOURCE.url);
        expect(rows[0].textContent).toContain('Script');
    });

    it('adds a file with its fields trimmed, then reads the list again', () => {
        const card = create().componentInstance;
        card.draft = { kind: 'style', url: '  https://cdn.example.net/a.css ', integrity: ' sha384-BBBB ' };

        card.add();

        expect(added).toEqual([{ kind: 'style', url: 'https://cdn.example.net/a.css', integrity: 'sha384-BBBB' }]);
        expect(reads).toBe(2);
        expect(card.draft.url).toBe('');
        expect(card.error()).toBeNull();
    });

    it('shows a refused addition in the server\'s words and keeps what was typed', () => {
        addAnswer = () => throwError(() => new HttpErrorResponse({ status: 422 }));
        const card = create().componentInstance;
        card.draft = { kind: 'script', url: 'https://cdn.example.net/moved.js', integrity: 'sha384-CCCC' };

        card.add();

        expect(card.error()).toBe('refused 422');
        expect(card.draft.url).toBe('https://cdn.example.net/moved.js');
        expect(reads).toBe(1);
    });

    it('removes an entry by its id only after the confirmation', () => {
        const card = create().componentInstance;
        confirmed = false;
        card.remove(SOURCE);
        expect(removed).toEqual([]);

        confirmed = true;
        card.remove(SOURCE);

        expect(removed).toEqual(['e1']);
        expect(reads).toBe(2);
    });

    it('shows a refused removal, a page still naming the file', () => {
        removeAnswer = () => throwError(() => new HttpErrorResponse({ status: 409 }));
        const card = create().componentInstance;

        card.remove(SOURCE);

        expect(card.error()).toBe('refused 409');
        expect(reads).toBe(1);
    });
});

/** The list's address is the section's own plus `/script-sources`; an entry's, that plus its id. */
describe('SectionsApiService allow-list addresses', () => {
    let api: SectionsApiService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                SectionsApiService,
                { provide: Store, useValue: { selectSnapshot: () => ({ sections: { item: '/api/v1/sections/{id}' } }) } },
            ],
        });
        api = TestBed.inject(SectionsApiService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('lists, adds and removes at the section\'s addresses', () => {
        let listed: SiteScriptSourceDto[] = [];
        api.listScriptSources('s 1').subscribe(rows => (listed = rows));
        http.expectOne('/api/v1/sections/s%201/script-sources').flush({ member: [SOURCE] });
        expect(listed).toEqual([SOURCE]);

        api.addScriptSource('s1', { kind: 'script', url: SOURCE.url, integrity: SOURCE.integrity }).subscribe();
        const post = http.expectOne('/api/v1/sections/s1/script-sources');
        expect(post.request.method).toBe('POST');
        expect(post.request.body).toEqual({ kind: 'script', url: SOURCE.url, integrity: SOURCE.integrity });
        post.flush(SOURCE);

        api.removeScriptSource('s1', 'e 1').subscribe();
        const del = http.expectOne('/api/v1/sections/s1/script-sources/e%201');
        expect(del.request.method).toBe('DELETE');
        del.flush(null);
    });
});
