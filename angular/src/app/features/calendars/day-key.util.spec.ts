import {
    calendarDaysBetween,
    localDateOf,
    localDayKey,
    monthDayName,
    shiftDayKey,
    utcDayOf,
    weekdayName,
} from './day-key.util';

/**
 * A day key is a calendar day with no zone attached. Every helper here has to
 * give the same answer in every browser zone, so each case picks a day whose
 * neighbours cross a month or a year boundary -- the places a zone-shifted
 * `Date` would move the day.
 */
describe('day keys', () => {
    it('shifts across a month and a year boundary', () => {
        expect(shiftDayKey('2030-03-10', 1)).toBe('2030-03-11');
        expect(shiftDayKey('2030-03-31', 1)).toBe('2030-04-01');
        expect(shiftDayKey('2030-12-31', 1)).toBe('2031-01-01');
        expect(shiftDayKey('2030-01-01', -1)).toBe('2029-12-31');
        expect(shiftDayKey('2030-03-10', 14)).toBe('2030-03-24');
    });

    it('counts whole days, signed', () => {
        expect(calendarDaysBetween('2030-03-10', '2030-03-10')).toBe(0);
        expect(calendarDaysBetween('2030-03-10', '2030-03-11')).toBe(1);
        expect(calendarDaysBetween('2030-03-11', '2030-03-10')).toBe(-1);
        expect(calendarDaysBetween('2029-12-25', '2030-01-01')).toBe(7);
    });

    it('sits at UTC midnight, whatever the browser zone', () => {
        const d = utcDayOf('2030-03-11');
        expect(d.toISOString()).toBe('2030-03-11T00:00:00.000Z');
    });

    it('round-trips a local Date through its own calendar day', () => {
        const local = localDateOf('2030-03-11');
        expect(local.getFullYear()).toBe(2030);
        expect(local.getMonth()).toBe(2);
        expect(local.getDate()).toBe(11);
        expect(localDayKey(local)).toBe('2030-03-11');
        // Local midnight, so a widget reading Y-M-D sees the same day.
        expect(local.getHours()).toBe(0);
    });

    it('names the day the key says, not the day the browser would put its midnight on', () => {
        // Monday 11 March 2030. A browser west of UTC turns UTC midnight into
        // the evening of the 10th; the names must not follow it there.
        expect(weekdayName('2030-03-11'))
            .toBe(new Date(Date.UTC(2030, 2, 11)).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }));
        expect(monthDayName('2030-03-11')).toContain('11');
        expect(monthDayName('2030-03-11')).not.toContain('10');
    });
});
