import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { type Observable } from 'rxjs';

import { calendarItemChangedSinceRead, CalendarItemNotReadError, CalendarsApiService } from './calendars-api.service';

/**
 * Every write of an event or of its series names the version it was read at (If-Match): an event or a series changed
 * since is refused (412) and nothing is changed. Without a version the write is not sent at all.
 */
describe('CalendarsApiService -- every event write names the version it read', () => {
    const ITEM = '/api/v1/calendar/items/e1';
    let http: HttpTestingController;
    let api: CalendarsApiService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        api = TestBed.inject(CalendarsApiService);
    });

    afterEach(() => http.verify());

    const cases: ReadonlyArray<{ name: string; method: string; url: string; send: (v: number | null) => Observable<unknown> }> = [
        { name: 'a change', method: 'PATCH', url: ITEM, send: v => api.updateCalendarItem('e1', { title: 'x' }, v) },
        { name: 'a delete', method: 'DELETE', url: ITEM, send: v => api.deleteCalendarItem('e1', v) },
        {
            name: 'an exception', method: 'POST', url: `${ITEM}/exception`,
            send: v => api.createCalendarItemException('e1', {
                recurrenceInstant: '2026-10-20T07:00:00.000Z',
                newStart: '2026-10-20T08:00:00.000Z',
            }, v),
        },
        {
            name: 'a skip', method: 'POST', url: `${ITEM}/skip`,
            send: v => api.skipCalendarItemOccurrence('e1', '2026-10-20T07:00:00.000Z', v),
        },
        {
            name: 'a split', method: 'POST', url: `${ITEM}/split`,
            send: v => api.splitCalendarItem('e1', {
                recurrenceInstant: '2026-10-20T07:00:00.000Z',
                newStart: '2026-10-20T08:00:00.000Z',
                newEnd: null,
            }, v),
        },
        {
            name: 'a delete of this and the following', method: 'POST', url: `${ITEM}/delete-following`,
            send: v => api.deleteFollowingCalendarItem('e1', '2026-10-20T07:00:00.000Z', v),
        },
    ];

    for (const c of cases) {
        it(`${c.name} names the version as a strong If-Match`, () => {
            c.send(7).subscribe();

            const req = http.expectOne(r => r.method === c.method && r.url === c.url);
            expect(req.request.headers.get('If-Match')).toBe('"7"');
            req.flush({});
        });

        it(`${c.name} is not sent without a version`, () => {
            let failed: unknown = null;

            c.send(null).subscribe({ error: e => (failed = e) });

            http.expectNone(r => r.url.startsWith(ITEM));
            expect(failed instanceof CalendarItemNotReadError).toBeTrue();
        });
    }

    it('a change keeps its merge-patch content type beside the If-Match', () => {
        api.updateCalendarItem('e1', { title: 'x' }, 3).subscribe();

        const req = http.expectOne(r => r.method === 'PATCH' && r.url === ITEM);
        expect(req.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
        req.flush({});
    });

    it('counts only a 412 and an unread event as changed since read', () => {
        expect(calendarItemChangedSinceRead(new HttpErrorResponse({ status: 412 }))).toBeTrue();
        expect(calendarItemChangedSinceRead(new CalendarItemNotReadError('e1'))).toBeTrue();
        expect(calendarItemChangedSinceRead(new HttpErrorResponse({ status: 404 }))).toBeFalse();
        expect(calendarItemChangedSinceRead(new HttpErrorResponse({ status: 422 }))).toBeFalse();
    });
});
