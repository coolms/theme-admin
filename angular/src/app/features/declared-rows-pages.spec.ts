import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, PageTitleService, ToastService, type DataGridConfig } from '@coolms/ui-angular';
import { ContactsListComponent } from './contacts/contacts-list.page';
import { ContactsService } from './contacts/contacts.service';
import { UsersListComponent } from './identity/users-list.component';
import { IdentityApiService } from './identity/identity-api.service';
import { LeadsListComponent } from './leads/leads-list.page';
import { LeadsService } from './leads/leads.service';
import { CallRecordsListComponent } from './call/call-records-list.page';
import { CallApiService } from './call/call-api.service';

/**
 * The four grid pages read their rows from where the grid's DEFINITION says they come from, and nowhere else.
 *
 * Each page is handed a definition whose `rows.operation` is a route the page has never heard of
 * (`/api/v1/moved-...`): the request goes there. A page that still fetched from its own hard-coded route would
 * ask the old one, and `expectOne` on the moved route fails -- this is the "no page hard-codes a list route" check,
 * measured on the code that runs. Pages are built directly, not rendered: only what construction reaches for is
 * stubbed.
 */
describe('Grid pages read the rows their definition declares', () => {
    let http: HttpTestingController;

    function build<T>(page: new () => T): T {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => 'refused' } },
                { provide: Router, useValue: {} },
                { provide: Dialog, useValue: {} },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
                { provide: ContactsService, useValue: {} },
                { provide: IdentityApiService, useValue: {} },
                { provide: LeadsService, useValue: {} },
                { provide: CallApiService, useValue: {} },
            ],
        });
        http = TestBed.inject(HttpTestingController);

        return TestBed.runInInjectionContext(() => new page());
    }

    function definition(id: string, path: string): DataGridConfig {
        return {
            id, label: '', columns: [], rowActions: [], draggable: false, perPage: 50, loadingMode: 'lazy',
            rows: { action: 'x.list', operation: 'GET ' + path, state: 'allowed', query: 'rql' },
        } as DataGridConfig;
    }

    const FIRST = { offset: 0, sort: null, reset: true, columnFilters: ['name cn "a"'] };

    afterEach(() => http.verify());

    it('contacts: asks the declared operation, and its rows are the page\'s contacts', () => {
        const page = build(ContactsListComponent);
        page.rows.use(definition('contact:contacts', '/api/v1/moved-contacts'));
        page.onLoadMore(FIRST);

        const req = http.expectOne(r => r.url === '/api/v1/moved-contacts');
        expect(req.request.params.getAll('filter')).toEqual(['name cn "a"']);
        req.flush({ member: [{ id: 'c1', displayName: 'Sam' }], totalItems: 1 });
        expect(page.contacts().map(c => c.id)).toEqual(['c1']);
        expect(page.totalItems()).toBe(1);
    });

    it('accounts: asks the declared operation, and draws each user\'s joined name', () => {
        const page = build(UsersListComponent);
        page.rows.use(definition('identity:users', '/api/v1/moved-users'));
        page.onLoadMore(FIRST);

        http.expectOne(r => r.url === '/api/v1/moved-users').flush({
            member: [{ id: 'u1', identifier: 'sam.roe@example.test', firstName: 'Sam', lastName: 'Roe' }],
            totalItems: 1,
        });
        expect((page.rows.data().items[0] as Record<string, unknown>)['displayName']).toBe('Sam Roe');
        expect(page.users().map(u => u.id)).toEqual(['u1']);
    });

    it('leads: asks the declared operation within the selected tab\'s scope', () => {
        const page = build(LeadsListComponent);
        page.rows.use(definition('lead:list', '/api/v1/moved-leads'));
        page.onLoadMore(FIRST);
        http.expectOne(r => r.url === '/api/v1/moved-leads' && r.params.get('status') === 'new')
            .flush({ member: [], totalItems: 0 });

        page.selectTab('spam');
        page.onLoadMore(FIRST);
        http.expectOne(r => r.url === '/api/v1/moved-leads' && r.params.get('status') === 'spam')
            .flush({ member: [{ id: 'l1', status: 'spam' }], totalItems: 1 });
        expect(page.leads().map(l => l.id)).toEqual(['l1']);
    });

    it('call records: asks the declared operation, and counts what it answers', () => {
        const page = build(CallRecordsListComponent);
        page.rows.use(definition('call:records', '/api/v1/moved-calls'));
        page.onLoadMore(FIRST);

        http.expectOne(r => r.url === '/api/v1/moved-calls').flush({ member: [{ id: 'r1' }], totalItems: 9 });
        expect(page.totalItems()).toBe(9);
    });

    it('a page whose rows are refused asks nothing, and its grid body is not drawn', () => {
        const page = build(ContactsListComponent);
        page.rows.use({ ...definition('contact:contacts', '/api/v1/moved-contacts'),
            rows: { action: 'x.list', operation: 'GET /api/v1/moved-contacts', state: 'denied', query: 'rql' } });
        page.onLoadMore(FIRST);

        http.expectNone(() => true);
        expect(page.rows.showsRows()).toBe(false);
        expect(page.rows.availability()).toBe('denied');
    });
});
