import { instantOfWall, shiftSeries, stretchSeries, wallMs } from './series-shift.util';

/**
 * "All events" on a dragged occurrence moves the whole series by the same difference, day and time, and drops nothing
 * (Dmitry, 2026-10-15). The difference is read on the series' wall clock, so a daylight-saving change between the
 * series' start and the dragged occurrence does not shift its time of day.
 */
describe('moving a whole series by one occurrence\'s move', () => {
    it('the 5th occurrence of a daily series dragged by two days moves the series\' start -- the 1st included -- by two days', () => {
        const daily = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', allDay: false };
        const fifth = '2026-11-06T09:00:00.000Z';

        const moved = shiftSeries(daily, fifth, '2026-11-08T09:00:00.000Z', 'UTC');

        expect(moved).toEqual({ start: '2026-11-04T09:00:00.000Z', end: '2026-11-04T10:00:00.000Z' });
    });

    it('a time of day dragged keeps the day and moves the time', () => {
        const daily = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', allDay: false };

        const moved = shiftSeries(daily, '2026-11-06T09:00:00.000Z', '2026-11-06T11:30:00.000Z', 'UTC');

        expect(moved).toEqual({ start: '2026-11-02T11:30:00.000Z', end: '2026-11-02T12:30:00.000Z' });
    });

    it('across a daylight-saving change, a 09:00 series stays at 09:00 on its own wall clock', () => {
        // Europe/Berlin leaves summer time on 25 October 2026: 09:00 is 07:00Z before it, 08:00Z after.
        const daily = { start: '2026-10-24T07:00:00.000Z', end: '2026-10-24T08:00:00.000Z', allDay: false };
        const occurrence = '2026-10-28T08:00:00.000Z'; // 28 Oct, 09:00 Berlin

        const moved = shiftSeries(daily, occurrence, '2026-10-30T08:00:00.000Z', 'Europe/Berlin');

        // Two days later, still 09:00 Berlin -- 08:00Z, past the change. Forty-eight hours would have given 07:00Z,
        // 08:00 on the wall clock.
        expect(moved).toEqual({ start: '2026-10-26T08:00:00.000Z', end: '2026-10-26T09:00:00.000Z' });
    });

    it('an all-day series moves by whole days', () => {
        const allDay = { start: '2026-11-02', end: '2026-11-03', allDay: true };

        expect(shiftSeries(allDay, '2026-11-06', '2026-11-09', 'Europe/Berlin')).toEqual({ start: '2026-11-05', end: '2026-11-06' });
    });

    it('a resize stretches the series\' end by as much, on its wall clock', () => {
        const daily = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', allDay: false };

        expect(stretchSeries(daily, '2026-11-06T10:00:00.000Z', '2026-11-06T10:30:00.000Z', 'UTC'))
            .toEqual({ end: '2026-11-02T10:30:00.000Z' });
    });

    it('reads and writes a wall clock in a zone, both ways', () => {
        const instant = new Date('2026-10-28T08:00:00.000Z');
        const wall = wallMs(instant, 'Europe/Berlin');

        expect(new Date(wall).toISOString()).toBe('2026-10-28T09:00:00.000Z');
        expect(instantOfWall(wall, 'Europe/Berlin').toISOString()).toBe('2026-10-28T08:00:00.000Z');
    });
});
