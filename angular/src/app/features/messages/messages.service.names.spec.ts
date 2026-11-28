import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { MessagesService } from './messages.service';

/** Chat shows people by the name they gave: never a login, an email or an id. */
describe('MessagesService people names', () => {
    const USERS = '/api/v1/identity/users';
    let svc: MessagesService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', identity: { usersUrl: USERS } }) } },
            ],
        });
        svc = TestBed.inject(MessagesService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('searches people by first and last name only, not by login', () => {
        let found: unknown[] = [];
        svc.searchUsers('ada').subscribe(r => (found = r));
        const req = http.expectOne(r => r.url === USERS);
        const filters = req.request.params.getAll('filter') ?? [];
        expect(filters[0]).toBe('firstName cn "ada"|lastName cn "ada"');
        expect(filters.join(' ')).not.toContain('identifier');
        req.flush([{ id: 'u1', fullName: 'Ada Lovelace' }]);
        expect(found).toEqual([{ userId: 'u1', displayName: 'Ada Lovelace', avatarUrl: null }]);
    });

    it('labels a person with no name "No name", never by email or login', () => {
        let found: { displayName: string }[] = [];
        svc.searchUsers('ada').subscribe(r => (found = r));
        http.expectOne(r => r.url === USERS)
            .flush([{ id: 'u2', fullName: null, email: 'ada@example.test', identifier: 'ada@example.test' }]);
        expect(found.map(u => u.displayName)).toEqual(['No name']);
    });

    it('resolves a person with no name to "No name", and a failed lookup too, never to the id', () => {
        const labels: string[] = [];
        svc.resolveUserLabel('u3').subscribe(l => labels.push(l));
        http.expectOne(USERS + '/u3').flush({ id: 'u3', fullName: '', identifier: 'login3' });
        svc.resolveUserLabel('u4').subscribe(l => labels.push(l));
        http.expectOne(USERS + '/u4').flush('gone', { status: 404, statusText: 'Not Found' });
        expect(labels).toEqual(['No name', 'No name']);
    });
});
