import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { type ProviderToken, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    PageFooterService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { BackupsListPageComponent } from './backups/backups-list.page';
import { BackupService } from './backups/backup.service';
import { CalendarsListComponent } from './calendars/calendars-list.page';
import { CalendarsApiService } from './calendars/calendars-api.service';
import { PagesListComponent } from './content/pages-list.component';
import { PageService } from './content/page.service';
import { PageSpaceStateService } from './content/page-space-state.service';
import { DocumentFontsPageComponent } from './documents/fonts/document-fonts.page';
import { DocumentFontService } from './documents/fonts/document-font.service';
import {
    DocumentGenerationListPageComponent,
} from './documents/generation-list/document-generation-list-page.component';
import { DocumentsApiService } from './documents/documents-api.service';
import { ExperimentsListComponent } from './experiments/experiments-list.page';
import { ExperimentsService } from './experiments/experiments.service';
import { InboxListComponent } from './inbox/inbox-list.page';
import { InboxService } from './inbox/inbox.service';
import { InboxLiveEventsService } from './inbox/inbox-live-events.service';
import { ModerationListComponent } from './moderation/moderation-list.page';
import { ModerationService } from './moderation/moderation.service';
import { NaviTreesListComponent } from './navi/navi-trees-list.component';
import { NaviNodesListComponent } from './navi/navi-nodes-list.component';
import { NaviApiService } from './navi/navi-api.service';
import { NewsletterListComponent } from './newsletter/newsletter-list.page';
import { NewsletterService } from './newsletter/newsletter.service';
import { SchedulesListComponent } from './schedules/schedules-list.page';
import { SchedulesApiService } from './schedules/schedules-api.service';
import { SectionsListComponent } from './sections/sections-list.component';
import { SectionsApiService } from './sections/sections-api.service';
import { CategoriesPageComponent } from './taxonomy/categories-page.component';
import { TaxonomyService } from './taxonomy/taxonomy.service';

/**
 * A list page whose load fails shows the failure in the error banner in place of its list, never a "Failed to
 * load ..." toast: the page holds the error in `loadFailure()`, the banner's Retry asks the API again, and a load
 * that then succeeds clears the failure. Each row builds the real page directly, not rendered, and drives its real
 * load path; only the API method the load reaches is answered, the rest of construction is stubbed.
 */
describe('List pages show a failed load in the error banner', () => {
    const FIRST = { offset: 0, sort: null, reset: true, columnFilters: [] as string[] };
    const PAGED = { items: [], totalItems: 0 };

    interface Loadable {
        loadFailure(): unknown;
    }

    interface Row {
        name: string;
        build: () => Loadable;
        api: ProviderToken<unknown>;
        method: string;
        /** Answers every other method the load path asks, always successfully. */
        alongside?: Record<string, () => Observable<unknown>>;
        ok: unknown;
        load: (page: Loadable) => void;
        retry: (page: Loadable) => void;
    }

    function row<T extends Loadable>(
        name: string,
        page: new () => T,
        api: ProviderToken<unknown>,
        method: string,
        ok: unknown,
        load: (page: T) => void,
        retry: (page: T) => void,
        alongside?: Record<string, () => Observable<unknown>>,
    ): Row {
        return {
            name,
            build: () => new page(),
            api,
            method,
            ok,
            alongside,
            load: p => load(p as T),
            retry: p => retry(p as T),
        };
    }

    const ROWS: Row[] = [
        row('backups', BackupsListPageComponent, BackupService, 'listBundles', [],
            p => p.load(), p => p.load()),
        row('calendars', CalendarsListComponent, CalendarsApiService, 'listCalendarsPage', PAGED,
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('pages', PagesListComponent, PageService, 'listPages', [],
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('document fonts', DocumentFontsPageComponent, DocumentFontService, 'list', { families: [] },
            p => p.load(), p => p.load()),
        row('document generations', DocumentGenerationListPageComponent, DocumentsApiService,
            'listDocumentGenerations', PAGED, p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('experiments', ExperimentsListComponent, ExperimentsService, 'list', [],
            p => p.load(), p => p.load()),
        row('inbox', InboxListComponent, InboxService, 'listTasks', PAGED,
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('moderation', ModerationListComponent, ModerationService, 'listPage', PAGED,
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('navigation trees', NaviTreesListComponent, NaviApiService, 'getNaviTrees', [],
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('navigation nodes', NaviNodesListComponent, NaviApiService, 'getNaviNodes', [],
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('newsletter', NewsletterListComponent, NewsletterService, 'listPage', PAGED,
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('schedules', SchedulesListComponent, SchedulesApiService, 'listSchedulesPage', PAGED,
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('sections', SectionsListComponent, SectionsApiService, 'getSections', [],
            p => p.onLoadMore(FIRST), p => p.retryLoad()),
        row('categories', CategoriesPageComponent, TaxonomyService, 'listNodes', [],
            p => p.onLoadMore(FIRST), p => p.retryLoad(), { findTreeByCode: () => of(null) }),
    ];

    /**
     * A fresh module per page: `api` answers `method` from `answers` in turn (the last one repeats), every toast is
     * recorded in `toasts`, and the rest of what construction reaches for is stubbed.
     */
    function configure(
        api: ProviderToken<unknown>,
        method: string,
        answers: Array<() => Observable<unknown>>,
        toasts: string[],
        alongside?: Record<string, () => Observable<unknown>>,
    ): { asked: () => number } {
        let asked = 0;
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: api,
                    useValue: {
                        ...alongside,
                        [method]: () => answers[Math.min(asked++, answers.length - 1)](),
                    },
                },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                {
                    provide: ToastService,
                    useValue: { error: recordToast, success: recordToast, info: recordToast },
                },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
                { provide: Dialog, useValue: {} },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => 'refused' } },
                { provide: Router, useValue: {} },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
                    },
                },
                { provide: DateTimeFormatService, useValue: {} },
                { provide: InboxLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: {} },
                { provide: PageFooterService, useValue: { update: (): void => {} } },
                {
                    provide: PageSpaceStateService,
                    useValue: {
                        spaceKey:                signal('site'),
                        spaceRoot:               signal('/site'),
                        pageTypes:               signal([]),
                        viewMode:                signal('details'),
                        folderId:                signal(null),
                        folderPath:              signal('/site'),
                        actionRequested$:        NEVER,
                        sectionActionRequested$: NEVER,
                        resetFolder:             (): void => {},
                    },
                },
            ],
        });

        return { asked: () => asked };
    }

    for (const r of ROWS) {
        it(`${r.name}: a failed load is the banner, Retry asks again, a success clears it`, () => {
            const failure = new HttpErrorResponse({ status: 500 });
            const toasts: string[] = [];
            const answers = [() => throwError(() => failure), () => of(r.ok)];
            const api = configure(r.api, r.method, answers, toasts, r.alongside);
            const page = TestBed.runInInjectionContext(() => r.build());

            r.load(page);

            expect(api.asked()).withContext('the load asked the API').toBe(1);
            expect(page.loadFailure()).withContext('the failure is held for the banner').toBe(failure);
            expect(toasts).withContext('no toast for a failed load').toEqual([]);

            r.retry(page);

            expect(api.asked()).withContext('Retry asked the API again').toBe(2);
            expect(page.loadFailure()).withContext('a load that succeeds clears the failure').toBeNull();
            expect(toasts).toEqual([]);
        });
    }

    it('calendars: a later page that fails keeps the rows and the grid, and is the toast', () => {
        const toasts: string[] = [];
        const first = { items: [{ id: 'c1', label: 'One' }], totalItems: 2 };
        const api = configure(
            CalendarsApiService,
            'listCalendarsPage',
            [() => of(first), () => throwError(() => new HttpErrorResponse({ status: 500 }))],
            toasts,
        );
        const page = TestBed.runInInjectionContext(() => new CalendarsListComponent());
        page.onLoadMore(FIRST);
        expect(page.calendars().map(c => c.id)).withContext('the first page loaded').toEqual(['c1']);

        page.onLoadMore({ ...FIRST, reset: false, offset: 1 });

        expect(api.asked()).withContext('the append asked the API').toBe(2);
        expect(page.loadFailure()).withContext('no banner for a failed append').toBeNull();
        expect(page.calendars().map(c => c.id)).withContext('the first page is still shown').toEqual(['c1']);
        expect(toasts).toEqual(['Failed to load calendars']);
    });
});
