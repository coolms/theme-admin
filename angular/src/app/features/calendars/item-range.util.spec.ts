import { capturedRange, itemDayKey, nextDayRange } from './item-range.util';

/**
 * An all-day item is its dates. Each case is built so the browser's own zone cannot satisfy it: the event's Date is
 * deliberately on ANOTHER day than its startStr (as FullCalendar's local midnight is east of UTC), and the formatter
 * passed to itemDayKey deliberately moves a bare date to the day before (as `new Date()` does west of UTC).
 */
describe('item ranges', () => {
    /** Local midnight of the 12th seen from Minsk: 21:00 UTC on the 11th. */
    const minskMidnightOf12th = new Date(Date.UTC(2030, 2, 11, 21, 0, 0));

    it('captures an all-day event by its dates, never by its local-midnight instant', () => {
        expect(minskMidnightOf12th.toISOString().slice(0, 10))
            .withContext('vacuous unless the instant names another day than the date')
            .toBe('2030-03-11');

        const range = capturedRange({
            allDay: true, start: minskMidnightOf12th, end: new Date(Date.UTC(2030, 2, 12, 21, 0, 0)),
            startStr: '2030-03-12', endStr: '2030-03-13',
        });

        expect(range).toEqual({ start: '2030-03-12', end: '2030-03-13' });
    });

    it('captures an all-day event with no end as no end', () => {
        expect(capturedRange({ allDay: true, start: minskMidnightOf12th, end: null, startStr: '2030-03-12', endStr: '' }))
            .toEqual({ start: '2030-03-12', end: null });
    });

    it('captures a timed event by its instants, as before', () => {
        const start = new Date('2030-03-10T16:00:00.000Z');
        const end = new Date('2030-03-10T17:00:00.000Z');

        expect(capturedRange({ allDay: false, start, end, startStr: 'ignored', endStr: 'ignored' }))
            .toEqual({ start: '2030-03-10T16:00:00.000Z', end: '2030-03-10T17:00:00.000Z' });
    });

    it('duplicates an all-day item to the next DATE, across a month and a year', () => {
        expect(nextDayRange({ start: '2030-03-31', end: '2030-04-01' }, true)).toEqual({ start: '2030-04-01', end: '2030-04-02' });
        expect(nextDayRange({ start: '2030-12-31', end: null }, true)).toEqual({ start: '2031-01-01', end: null });
    });

    it('duplicates a timed item one local day later, as before', () => {
        const start = new Date(2030, 2, 10, 9, 0);
        const next = nextDayRange({ start: start.toISOString(), end: null }, false);
        const moved = new Date(next.start);

        expect(moved.getDate()).toBe(11);
        expect(moved.getHours()).toBe(9);
        expect(next.end).toBeNull();
    });

    it('lists an all-day item under its own date, whatever the formatter would make of it', () => {
        // What the formatter does with a bare date west of UTC: UTC midnight is the evening before.
        const westOfUtc = (iso: string): string =>
            new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
        expect(westOfUtc('2030-03-12'))
            .withContext('vacuous unless the formatter moves the bare date')
            .toBe('2030-03-11');

        expect(itemDayKey({ start: '2030-03-12', allDay: true }, westOfUtc)).toBe('2030-03-12');
        expect(itemDayKey({ start: '2030-03-12T15:00:00.000Z', allDay: false }, westOfUtc)).toBe('2030-03-12');
    });
});
