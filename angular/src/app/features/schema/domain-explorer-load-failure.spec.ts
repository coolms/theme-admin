import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { Observable, of, throwError } from 'rxjs';
import { NaviGraphService, UserPreferencesService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DynamicRecordService,
    PageFooterService,
    ToastService,
} from '@coolms/ui-angular';
import { DomainExplorerStateService } from './domain-explorer-state.service';
import {
    type DomainEntityItem,
    type DomainModuleGroup,
    type DynamicEntityTypeDto,
    SchemaService,
} from './schema.service';

/**
 * The Domain Explorer's state reads three pieces: the domain's modules and entities, the active entity's records,
 * and the root of the dynamic types. A failed read of each is held in that piece's own failure signal for the error
 * banner in place of it, never a toast; Retry calls that piece's load again, and a read that then succeeds clears the
 * failure. One piece failing leaves the others' failures alone. The service is built directly.
 */
describe('DomainExplorerStateService -- a failed read of the domain, the records or the dynamic types', () => {
    type Answer = () => Observable<unknown>;

    let domainAnswers: Answer[];
    let typeAnswers: Answer[];
    let recordAnswers: Answer[];
    let domainAsked: number;
    let typesAsked: number;
    let recordParams: HttpParams[];
    let toasts: string[];

    const next = (answers: Answer[], n: number): Observable<unknown> => answers[Math.min(n, answers.length - 1)]();

    function build(): DomainExplorerStateService {
        domainAsked = 0;
        typesAsked = 0;
        recordParams = [];
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SchemaService,
                    useValue: {
                        domainExplorerToolbarUrl: '',
                        listDomain: () => next(domainAnswers, domainAsked++),
                        listRuntimeTypesForParent: () => next(typeAnswers, typesAsked++),
                        searchRuntimeTypes: () => of([]),
                    },
                },
                {
                    provide: HttpClient,
                    useValue: {
                        get: (_url: string, options: { params: HttpParams }) =>
                            next(recordAnswers, recordParams.push(options.params) - 1),
                    },
                },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: PageFooterService, useValue: { set: (): void => {}, update: (): void => {} } },
                {
                    provide: UserPreferencesService,
                    useValue: { getPageState: () => null, setPageState: (): void => {} },
                },
                { provide: NaviGraphService, useValue: {} },
                { provide: ContextMenuService, useValue: {} },
                { provide: DynamicRecordService, useValue: {} },
                { provide: Dialog, useValue: {} },
                { provide: ConfirmDialogService, useValue: {} },
            ],
        });

        return TestBed.runInInjectionContext(() => new DomainExplorerStateService());
    }

    const failures = (s: DomainExplorerStateService) => ({
        domain: s.domainFailure() !== null,
        records: s.recordsFailure() !== null,
        types: s.dynamicTypesFailure() !== null,
    });

    beforeEach(() => {
        domainAnswers = [() => of([])];
        typeAnswers = [() => of([])];
        recordAnswers = [() => of({ member: [], totalItems: 0 })];
    });

    it('domain data: the failure is held, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        const group = { module: 'content', entities: [] } as unknown as DomainModuleGroup;
        domainAnswers = [() => throwError(() => failure), () => of([group])];
        const state = build();

        state.loadAll();

        expect(domainAsked).withContext('the load asked the API').toBe(1);
        expect(state.domainFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(failures(state)).toEqual({ domain: true, records: false, types: false });
        expect(state.loading()).toBeFalse();
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        state.loadDomain();

        expect(domainAsked).withContext('Retry asked the API again').toBe(2);
        expect(state.domainFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(state.modules().map(m => m.module)).toEqual(['content']);
        expect(toasts).toEqual([]);
    });

    it('dynamic types: the failure is held, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        typeAnswers = [() => throwError(() => failure), () => of([{ id: 't1', slug: 'book' } as DynamicEntityTypeDto])];
        const state = build();
        state.showEntities.set(false);
        state.showDynamicTypes.set(true);

        state.loadAll();

        expect(typesAsked).withContext('the load asked the API').toBe(1);
        expect(state.dynamicTypesFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(failures(state)).toEqual({ domain: false, records: false, types: true });
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        state.loadRoot();

        expect(typesAsked).withContext('Retry asked the API again').toBe(2);
        expect(state.dynamicTypesFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(state.childrenMap().get('root')?.map(t => t.id)).toEqual(['t1']);
        expect(toasts).toEqual([]);
    });

    it('records: the failure is held, Retry asks again with the same sort and filters, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        recordAnswers = [() => throwError(() => failure), () => of({ member: [{ id: 'r1' }], totalItems: 1 })];
        const state = build();
        state.activeEntity.set({
            className: 'Library\\Book', shortName: 'Book', recordsUrl: '/api/v1/books',
        } as DomainEntityItem);

        state.onEntityRecordsLoadMore({ offset: 0, reset: true, sort: 'title', columnFilters: ['title=a'] });

        expect(recordParams.length).withContext('the load asked the API').toBe(1);
        expect(state.recordsFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(failures(state)).toEqual({ domain: false, records: true, types: false });
        expect(state.entityRecordsLoading()).toBeFalse();
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        state.retryEntityRecords();

        expect(recordParams.length).withContext('Retry asked the API again').toBe(2);
        expect(recordParams[1].get('sort')).toBe('title');
        expect(recordParams[1].getAll('filter')).toEqual(['title=a']);
        expect(state.recordsFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(state.entityRecordsData()?.items.length).toBe(1);
        expect(toasts).toEqual([]);
    });
});
