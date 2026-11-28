import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { BACKGROUND_REQUEST } from '@coolms/core-angular';

import { ChatLastOpenedService, LAST_OPENED_DEBOUNCE_MS } from './chat-last-opened.service';

const SECTION = '/api/v1/auth/me/settings/chat';
const REFUSED = { type: '/errors/validation', title: 'Unprocessable', detail: 'lastConversationId: it is not a conversation you take part in.' };

/**
 * Chat's last conversation in the person's settings section `chat` (GET and PATCH /auth/me/settings/chat, key
 * `lastConversationId`): read with the section's ETag; saved a second after the last of a quick run of opens, only
 * that key, If-Match the ETag read, in the background. A 412 reads again and tries once more; a 422 is dropped. A
 * section not served (404) or any failure is none stored, and saves nothing, silently.
 */
describe('ChatLastOpenedService', () => {
    let http: HttpTestingController;
    let service: ChatLastOpenedService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        service = TestBed.inject(ChatLastOpenedService);
    });
    afterEach(() => http.verify());

    const read = (): Array<string | null> => {
        const got: Array<string | null> = [];
        service.read().subscribe(id => got.push(id));
        return got;
    };
    /** The section's read, answered with this id and ETag. */
    const answerRead = (id: string | null, etag: string): TestRequest => {
        const req = http.expectOne(r => r.method === 'GET' && r.url === SECTION);
        req.flush({ lastConversationId: id }, { headers: { ETag: etag } });
        return req;
    };
    const patch = (): TestRequest => http.expectOne(r => r.method === 'PATCH' && r.url === SECTION);
    const noPatch = (): void => http.expectNone(r => r.method === 'PATCH');
    const noRead = (): void => http.expectNone(r => r.method === 'GET');

    it('reads the stored id, in the background', () => {
        const got = read();
        const req = answerRead('d2', '"v7"');
        expect(req.request.context.get(BACKGROUND_REQUEST)).toBeTrue();
        expect(got).toEqual(['d2']);
    });

    it('none stored: a null value, a section not served (404), a failure', () => {
        const answers: Array<() => void> = [
            () => answerRead(null, '"v1"'),
            () => http.expectOne(SECTION).flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' }),
            () => http.expectOne(SECTION).flush(null, { status: 500, statusText: 'Server Error' }),
        ];
        for (const answer of answers) {
            const got = read();
            answer();
            expect(got).toEqual([null]);
        }
    });

    it('a quick run of opens saves once, the last, a second after it: only that key, If-Match the ETag read', fakeAsync(() => {
        service.remember('d1');
        tick(300);
        service.remember('d2');
        tick(300);
        service.remember('d3');
        tick(LAST_OPENED_DEBOUNCE_MS - 1);
        noRead();
        tick(1);

        answerRead('d0', '"v7"');
        const save = patch();
        expect(save.request.body).toEqual({ lastConversationId: 'd3' });
        expect(save.request.headers.get('If-Match')).toBe('"v7"');
        expect(save.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
        expect(save.request.context.get(BACKGROUND_REQUEST)).toBeTrue();
        save.flush({ lastConversationId: 'd3' }, { headers: { ETag: '"v8"' } });
        noPatch();
    }));

    it('a section saved since (412) is read again and the save tried once more, naming the new ETag', fakeAsync(() => {
        service.remember('d2');
        tick(LAST_OPENED_DEBOUNCE_MS);
        answerRead('d1', '"v7"');
        patch().flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });

        answerRead('d1', '"v9"');
        const retry = patch();
        expect(retry.request.headers.get('If-Match')).toBe('"v9"');
        expect(retry.request.body).toEqual({ lastConversationId: 'd2' });
        retry.flush({ lastConversationId: 'd2' });
        noRead();
        noPatch();
    }));

    it('a second 412 is not tried again', fakeAsync(() => {
        service.remember('d2');
        tick(LAST_OPENED_DEBOUNCE_MS);
        answerRead('d1', '"v7"');
        patch().flush({}, { status: 412, statusText: 'Precondition Failed' });
        answerRead('d1', '"v8"');
        patch().flush({}, { status: 412, statusText: 'Precondition Failed' });

        noRead();
        noPatch();
    }));

    it('a refusal (422) is dropped silently, not tried again, and the next open still saves', fakeAsync(() => {
        service.remember('x9');
        tick(LAST_OPENED_DEBOUNCE_MS);
        answerRead('d1', '"v7"');
        patch().flush(REFUSED, { status: 422, statusText: 'Unprocessable Content' });
        noRead();
        noPatch();

        service.remember('d3');
        tick(LAST_OPENED_DEBOUNCE_MS);
        answerRead('d1', '"v7"');
        const next = patch();
        expect(next.request.body).withContext('the next open still saves').toEqual({ lastConversationId: 'd3' });
        next.flush({ lastConversationId: 'd3' });
    }));

    it('saves nothing where the section is not served, or answers no ETag', fakeAsync(() => {
        service.remember('d1');
        tick(LAST_OPENED_DEBOUNCE_MS);
        http.expectOne(SECTION).flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' });
        noPatch();

        service.remember('d2');
        tick(LAST_OPENED_DEBOUNCE_MS);
        http.expectOne(SECTION).flush({ lastConversationId: null });
        noPatch();
    }));
});
