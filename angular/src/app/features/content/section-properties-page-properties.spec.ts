import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { of, Subject } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, DateTimeFormatService, ToastService } from '@coolms/ui-angular';
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
    let ref: { close: (v: unknown) => void; disableClose: boolean | undefined;
               backdropClick: Subject<MouseEvent>; keydownEvents: Subject<KeyboardEvent> };

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
        ref = {
            close: (v: unknown) => closed.push(v), disableClose: undefined,
            backdropClick: new Subject<MouseEvent>(), keydownEvents: new Subject<KeyboardEvent>(),
        };
        TestBed.configureTestingModule({
            imports: [SectionPropertiesDialogComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: ref },
                {
                    provide: DateTimeFormatService,
                    useValue: { time: (iso: string) => iso.slice(11, 16), dateTime: (iso: string) => iso.slice(0, 16) },
                },
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
            .toEqual(['Section', 'Page properties', 'History']);
        const tab = el.querySelector('[data-test="folder-page-properties"]') as HTMLElement;
        expect(tab).not.toBeNull();
        expect(tab.textContent).toContain('from this folder');
        expect(tab.textContent).toContain('from /content/site');
        expect(Array.from(tab.querySelectorAll('#spd-locale option')).map(o => o.textContent?.trim()))
            .toEqual(['All languages', 'English', 'Deutsch']);
    });

    it('shows the folder\'s history, compact, read only when its tab is opened', () => {
        const el = open({ path: FOLDER, siteSlug: 'acme' });
        languages().flush({ member: [] });
        read('*').flush(view('*'));
        fixture.detectChanges();
        http.expectNone(r => r.url.endsWith('/web/page-versions'));

        const history = Array.from(el.querySelectorAll('[role="tab"]'))
            .find(t => t.textContent?.trim() === 'History') as HTMLElement;
        history.click();
        fixture.detectChanges();

        const req = http.expectOne(r => r.url.endsWith('/web/page-versions'));
        expect(req.request.params.get('path')).toBe(FOLDER);
        req.flush({ path: FOLDER, hasMore: false, versions: [] });
        fixture.detectChanges();
        const tab = el.querySelector('[data-test="folder-history"]') as HTMLElement;
        expect(tab.querySelector('[data-test="history-empty"]')).not.toBeNull();
        expect(tab.querySelector('[data-test="history-view-blame"]')).toBeNull();
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

    /** Opens a site's folder and leaves its meta card with a change not saved. */
    function openDirty(): HTMLElement {
        const el = open({ path: FOLDER, siteSlug: 'acme' });
        languages().flush({ member: [] });
        read('*').flush(view('*'));
        fixture.detectChanges();
        const value = el.querySelector('input[aria-label="meta value 1"]') as HTMLInputElement;
        value.value = 'Bea';
        value.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        return el;
    }

    it('takes Escape and the backdrop away from the dialog\'s own close: both ask over a card not saved', () => {
        openDirty();
        expect(ref.disableClose).toBeTrue();

        ref.keydownEvents.next(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(confirms).toBe(1);
        ref.backdropClick.next(new MouseEvent('click'));
        expect(confirms).toBe(2);
        expect(closed).toEqual([null, null]);
    });

    it('closes at once on Escape when no card holds changes, and ignores other keys', () => {
        open({ path: FOLDER, siteSlug: 'acme' });
        languages().flush({ member: [] });
        read('*').flush(view('*'));

        ref.keydownEvents.next(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(closed).toEqual([]);
        ref.keydownEvents.next(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(confirms).toBe(0);
        expect(closed).toEqual([null]);
    });

    it('holds the section\'s own actions that close the dialog while a card is not saved, and says why', () => {
        const el = openDirty();

        const promote = Array.from(el.querySelectorAll('button'))
            .find(b => b.textContent?.includes('Make this a content collection')) as HTMLButtonElement;
        expect(promote.disabled).toBeTrue();
        expect(el.querySelector('[data-test="page-properties-unsaved"]')).not.toBeNull();
    });
});
