import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';
import { CollectionService } from './collection.service';
import { PageService } from './page.service';
import { SectionPropertiesDialogComponent, type SectionPropertiesDialogData } from './section-properties-dialog.component';

/**
 * A site's folder has a Page properties tab: the same panel a page has, on the folder's own property sets, which
 * every page below it inherits. It shows each value with where it comes from ("this folder" for the folder's own),
 * in all languages or one of the site's; a card with changes not saved makes closing ask first. A folder in a
 * personal space has no such tab.
 */
describe('Section properties: the folder\'s page properties', () => {
    const URL = '/api/v1/web/page-properties';
    const FOLDER = '/content/site/docs';
    let http: HttpTestingController;
    let fixture: ComponentFixture<SectionPropertiesDialogComponent>;
    let closed: unknown[];
    let confirms: number;

    function view(locale: string): object {
        return {
            path: FOLDER,
            locale,
            properties: {
                meta: {
                    merge: 'keyed',
                    values: { author: 'Ann', keywords: 'docs' },
                    sources: {
                        author: { label: FOLDER, scope: '*', isPage: false, link: FOLDER },
                        keywords: { label: '/content/site', scope: '*', isPage: false, link: '/content/site' },
                    },
                    stoppedAt: null,
                },
            },
            own: { '*': { meta: { op: 'append', values: { author: 'Ann' } } } },
            version: 'v1',
            writable: true,
        };
    }

    function open(data: SectionPropertiesDialogData): HTMLElement {
        closed = [];
        confirms = 0;
        TestBed.configureTestingModule({
            imports: [SectionPropertiesDialogComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: (v: unknown) => closed.push(v) } },
                {
                    provide: CollectionService,
                    useValue: {
                        getSettings: () => of({
                            isCollection: false, postContentType: '', requiresReview: false, sidebarNav: false,
                        }),
                        getDistribution: () => of({ enabledChannels: [], channelConfig: {} }),
                        listChannels: () => of([]),
                    },
                },
                { provide: PageService, useValue: { listPageTypes: () => of([]) } },
                { provide: ToastService, useValue: { error: () => undefined } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ConfirmDialogService, useValue: { open: () => { confirms++; return of(true); } } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        fixture = TestBed.createComponent(SectionPropertiesDialogComponent);
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    function read(locale: string): TestRequest {
        return http.expectOne(r => r.method === 'GET' && r.url === URL && r.params.get('path') === FOLDER
            && r.params.get('locale') === locale);
    }

    function languages(): TestRequest {
        return http.expectOne(r => r.url === '/api/v1/options/i18n.site_enabled_locales');
    }

    afterEach(() => http.verify());

    it('offers the Page properties tab for a site\'s folder, with the folder\'s properties in all languages', () => {
        const el = open({ path: FOLDER, label: 'docs', siteSlug: 'acme' });
        languages().flush({ member: [{ value: 'en', label: 'English' }, { value: 'de', label: 'Deutsch' }] });
        read('*').flush(view('*'));
        fixture.detectChanges();

        expect(Array.from(el.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim()))
            .toEqual(['Section', 'Page properties']);
        const tab = el.querySelector('[data-test="folder-page-properties"]') as HTMLElement;
        expect(tab).not.toBeNull();
        expect(tab.textContent).toContain('from this folder');
        expect(tab.textContent).toContain('from /content/site');
        expect(Array.from(tab.querySelectorAll('#spd-locale option')).map(o => o.textContent?.trim()))
            .toEqual(['All languages', 'English', 'Deutsch']);
    });

    it('asks the site named for its languages', () => {
        open({ path: FOLDER, siteSlug: 'acme' });
        const req = languages();
        expect(req.request.headers.get('X-CoolMS-Section')).toBe('acme');
        req.flush({ member: [] });
        read('*').flush(view('*'));
    });

    it('reads the folder\'s properties again in the language chosen', () => {
        const el = open({ path: FOLDER, siteSlug: 'acme' });
        languages().flush({ member: [{ value: 'de', label: 'Deutsch' }] });
        read('*').flush(view('*'));
        fixture.detectChanges();

        const select = el.querySelector('#spd-locale') as HTMLSelectElement;
        select.value = 'de';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        read('de').flush(view('de'));
    });

    it('has no Page properties tab for a folder in a personal space, and reads none', () => {
        const el = open({ path: '/home/ann/notes' });

        expect(el.querySelector('[role="tab"]')).toBeNull();
        expect(el.querySelector('[data-test="folder-page-properties"]')).toBeNull();
        http.expectNone(r => r.url === URL);
    });

    it('asks before closing over a page-properties card with changes not saved, and closes at once without', () => {
        const el = open({ path: FOLDER, siteSlug: 'acme' });
        languages().flush({ member: [] });
        read('*').flush(view('*'));
        fixture.detectChanges();

        (el.querySelector('.cms-dialog-close') as HTMLButtonElement).click();
        expect(confirms).toBe(0);
        expect(closed).toEqual([null]);

        const value = el.querySelector('input[aria-label="meta value 1"]') as HTMLInputElement;
        value.value = 'Bea';
        value.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        (el.querySelector('.cms-dialog-close') as HTMLButtonElement).click();

        expect(confirms).toBe(1);
        expect(closed).toEqual([null, null]);
    });
});
