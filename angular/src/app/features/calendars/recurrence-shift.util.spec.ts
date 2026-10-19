import { shiftRecurrence } from './recurrence-shift.util';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "All events" moves every date a series' rule names with its start: a skipped occurrence stays skipped where it moved
 * to, and a rule that picks days moves its days. A move no rule can give exactly is refused, with the reason.
 */
describe('moving a series\' recurrence with its start', () => {
    const moved = (spec: string, start: string, delta: number, zone = 'UTC'): string => {
        const shift = shiftRecurrence(spec, start, delta, zone);
        if ('refused' in shift) {
            throw new Error('refused: ' + shift.refused);
        }
        return shift.recurrence;
    };
    const refusal = (spec: string, start: string, delta: number, zone = 'UTC'): string | null => {
        const shift = shiftRecurrence(spec, start, delta, zone);
        return 'refused' in shift ? shift.refused : null;
    };

    describe('the dates it names', () => {
        it('a skipped 09:00 occurrence of a series moved to 10:00 stays skipped, at 10:00', () => {
            expect(moved('RRULE:FREQ=DAILY;COUNT=10\r\nEXDATE:20261103T090000Z', '2026-11-02T09:00:00.000Z', HOUR))
                .toBe('RRULE:FREQ=DAILY;COUNT=10\r\nEXDATE:20261103T100000Z');
        });

        it('across a daylight-saving change, a skipped date moves on the series\' wall clock', () => {
            // Europe/Berlin leaves summer time on 25 October 2026: 09:00 is 07:00Z before it, 08:00Z after.
            const spec = 'RRULE:FREQ=DAILY;UNTIL=20261031T080000Z\r\nEXDATE:20261024T070000Z,20261028T080000Z';

            expect(moved(spec, '2026-10-22T07:00:00.000Z', 2 * DAY, 'Europe/Berlin'))
                .toBe('RRULE:FREQ=DAILY;UNTIL=20261102T080000Z\r\nEXDATE:20261026T080000Z,20261030T080000Z');
        });

        it('a date written on a named zone\'s clock keeps its zone and form', () => {
            expect(moved('RRULE:FREQ=DAILY\r\nEXDATE;TZID=Europe/Berlin:20261028T090000', '2026-10-26T08:00:00.000Z', HOUR, 'Europe/Berlin'))
                .toBe('RRULE:FREQ=DAILY\r\nEXDATE;TZID=Europe/Berlin:20261028T100000');
        });

        it('an added date (RDATE) moves too', () => {
            expect(moved('RRULE:FREQ=WEEKLY\r\nRDATE:20261104T090000Z', '2026-11-02T09:00:00.000Z', 30 * 60_000))
                .toBe('RRULE:FREQ=WEEKLY\r\nRDATE:20261104T093000Z');
        });

        it('UNTIL moves, so the series keeps its last occurrence', () => {
            expect(moved('RRULE:FREQ=DAILY;UNTIL=20261110T090000Z', '2026-11-02T09:00:00.000Z', 2 * DAY))
                .toBe('RRULE:FREQ=DAILY;UNTIL=20261112T090000Z');
        });

        it('an all-day series moves its dates by whole days, a date-only one as a date', () => {
            expect(moved('RRULE:FREQ=DAILY\r\nEXDATE:20261103T000000Z\r\nEXDATE:20261106', '2026-11-02T00:00:00.000Z', 2 * DAY))
                .toBe('RRULE:FREQ=DAILY\r\nEXDATE:20261105T000000Z\r\nEXDATE:20261108');
        });
    });

    describe('the days it picks', () => {
        it('weekly on Monday and Wednesday, moved a day later, repeats on Tuesday and Thursday', () => {
            expect(moved('RRULE:FREQ=WEEKLY;BYDAY=MO,WE', '2026-11-02T09:00:00.000Z', DAY))
                .toBe('RRULE:FREQ=WEEKLY;BYDAY=TU,TH');
        });

        it('every other week, the week\'s first day turns with the weekdays', () => {
            // Monday and Sunday every other week, counted from Monday: moved a day, Tuesday and Monday every other
            // week counted from Tuesday -- so the Monday stays in the same fortnight as the Tuesday before it.
            expect(moved('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU', '2026-11-02T09:00:00.000Z', DAY))
                .toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,MO;WKST=TU');
            expect(moved('RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=MO', '2026-11-02T09:00:00.000Z', -DAY))
                .toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SA;BYDAY=SU');
        });

        it('a time moved past midnight moves the weekday too', () => {
            expect(moved('RRULE:FREQ=WEEKLY;BYDAY=MO', '2026-11-02T23:00:00.000Z', 2 * HOUR))
                .toBe('RRULE:FREQ=WEEKLY;BYDAY=TU');
        });

        it('a time moved within the day leaves the days alone, whatever the rule', () => {
            expect(moved('RRULE:FREQ=MONTHLY;BYDAY=2MO', '2026-11-09T09:00:00.000Z', HOUR))
                .toBe('RRULE:FREQ=MONTHLY;BYDAY=2MO');
            expect(moved('RRULE:FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31T09:00:00.000Z', -2 * HOUR))
                .toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=31');
        });

        it('a day of the month moves within the month: from the start, and from the end', () => {
            expect(moved('RRULE:FREQ=MONTHLY;BYMONTHDAY=15', '2026-11-15T09:00:00.000Z', 2 * DAY))
                .toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=17');
            expect(moved('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', '2026-11-30T09:00:00.000Z', -DAY))
                .toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=-2');
            expect(moved('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10', '2027-03-10T09:00:00.000Z', 5 * DAY))
                .toBe('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15');
        });

        it('monthly from its start\'s day, moved within the month, keeps the rule', () => {
            expect(moved('RRULE:FREQ=MONTHLY;COUNT=6', '2026-11-10T09:00:00.000Z', 2 * DAY))
                .toBe('RRULE:FREQ=MONTHLY;COUNT=6');
        });
    });

    describe('refused, when no rule gives the same events moved', () => {
        it('the 2nd Monday of each month, moved by a day', () => {
            expect(refusal('RRULE:FREQ=MONTHLY;BYDAY=2MO', '2026-11-09T09:00:00.000Z', DAY)).toContain('numbered weekday');
        });

        it('every Monday of each month, moved by a day', () => {
            expect(refusal('RRULE:FREQ=MONTHLY;BYDAY=MO', '2026-11-02T09:00:00.000Z', DAY)).toContain('within each month');
        });

        it('a day of the month a move carries past the 28th or into another month', () => {
            expect(refusal('RRULE:FREQ=MONTHLY;BYMONTHDAY=27', '2026-11-27T09:00:00.000Z', 3 * DAY)).toContain('another month');
            expect(refusal('RRULE:FREQ=MONTHLY;BYMONTHDAY=30', '2026-11-30T09:00:00.000Z', -DAY)).toContain('another month');
            expect(refusal('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10', '2027-03-10T09:00:00.000Z', -10 * DAY)).toContain('another month');
        });

        it('monthly from the 31st, moved by a day', () => {
            expect(refusal('RRULE:FREQ=MONTHLY', '2026-10-31T09:00:00.000Z', DAY)).toContain('day of the month it started');
        });

        it('yearly in the month it started, moved out of it', () => {
            // On the 5th of the month it started (March), from a start of 31 March: two days later is April.
            expect(refusal('RRULE:FREQ=YEARLY;BYMONTHDAY=5', '2027-03-31T09:00:00.000Z', 2 * DAY)).toContain('month it started');
        });

        it('a numbered one of a set of days, or daily only in some months, moved by a day', () => {
            expect(refusal('RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1', '2026-11-30T09:00:00.000Z', DAY)).toContain('numbered one');
            expect(refusal('RRULE:FREQ=DAILY;BYMONTH=11', '2026-11-02T09:00:00.000Z', DAY)).toContain('some months');
        });

        it('a line it does not read, or a date it cannot read', () => {
            expect(refusal('RRULE:FREQ=DAILY\r\nX-OTHER:1', '2026-11-02T09:00:00.000Z', HOUR)).toContain('does not move');
            expect(refusal('RRULE:FREQ=DAILY\r\nEXDATE:tomorrow', '2026-11-02T09:00:00.000Z', HOUR)).toContain('EXDATE');
        });
    });
});
