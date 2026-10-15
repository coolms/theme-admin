import { HttpErrorResponse } from '@angular/common/http';

import { leftBehindMessage, seriesChangeLeaves } from './series-change.util';

/**
 * A change of a series the server refuses (409) because it would leave occurrences edited one by one, or skipped
 * dates, on no slot: read off the answer, and put to the person by name.
 */
describe('what a refused series change would leave behind', () => {
    const answer = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

    it('reads the 409 of this type: its edited occurrences and its skip dates', () => {
        const left = seriesChangeLeaves(answer(409, {
            type: '/errors/series-change-leaves-occurrences',
            exceptions: [{ id: 'e1', recurrenceInstant: '2026-11-09T10:00:00+00:00', start: '2026-11-09T11:00:00+00:00', end: null, title: 'Review' }],
            skipDates: ['2026-11-16T10:00:00+00:00'],
        }));

        expect(left).toEqual({
            exceptions: [{ id: 'e1', start: '2026-11-09T11:00:00+00:00', title: 'Review' }],
            skipDates: ['2026-11-16T10:00:00+00:00'],
        });
    });

    it('anything else is not this: another 409, a 412, a failure with no answer', () => {
        expect(seriesChangeLeaves(answer(409, { type: '/errors/conflict' }))).toBeNull();
        expect(seriesChangeLeaves(answer(412, { type: '/errors/series-change-leaves-occurrences' }))).toBeNull();
        expect(seriesChangeLeaves(new Error('offline'))).toBeNull();
    });

    it('names the events by title and date, an untitled one as such, and counts the skipped dates', () => {
        const message = leftBehindMessage({
            exceptions: [
                { id: 'e1', start: '2026-11-09T11:00:00+00:00', title: 'Review' },
                { id: 'e2', start: '2026-11-23T11:00:00+00:00', title: '' },
            ],
            skipDates: ['2026-11-16T10:00:00+00:00'],
        });

        expect(message).toContain('2 events changed one by one');
        expect(message).toContain('"Review" on 2026-11-09');
        expect(message).toContain('an untitled event on 2026-11-23');
        expect(message).toContain('A skipped date would skip nothing any more.');
        expect(message).toContain('Nothing changes until you choose.');
    });
});
