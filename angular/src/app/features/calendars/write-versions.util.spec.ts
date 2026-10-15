import { occurrenceSlotOf, rowVersionOf, seriesTargetOf, seriesVersionOf } from './write-versions.util';

/**
 * A change or a delete names the version of the row the event's id names; the actions on a series name the series'.
 * On an edited occurrence the two are different rows: the exception (its own id, its own version) and the series.
 */
describe('the versions a calendar write names', () => {
    it('a one-off event: its own version; no series', () => {
        const props = { seriesId: null, version: 5, seriesVersion: null };

        expect(rowVersionOf(props)).toBe(5);
        expect(seriesVersionOf(props)).toBeNull();
    });

    it('a plain occurrence: the row is the series\' base, so both are the series\' version', () => {
        const props = { seriesId: 's1', parentItemId: null, version: 3, seriesVersion: 3 };

        expect(rowVersionOf(props)).toBe(3);
        expect(seriesVersionOf(props)).toBe(3);
    });

    it('an edited occurrence: a change of it names the exception\'s version, never the series\'', () => {
        const props = { seriesId: 's1', parentItemId: 'base', version: 9, seriesVersion: 3 };

        expect(rowVersionOf(props)).toBe(9);
        expect(seriesVersionOf(props)).toBe(3);
    });

    it('a row read without versions names none', () => {
        expect(rowVersionOf({})).toBeNull();
        expect(seriesVersionOf({ seriesVersion: 'x' })).toBeNull();
    });

    it("a series action addresses the series' base: an edited occurrence's parent, else the drawn id", () => {
        expect(seriesTargetOf({ parentItemId: 'base' }, 'exception')).toBe('base');
        expect(seriesTargetOf({ parentItemId: null }, 'base')).toBe('base');
    });

    it('names the slot the occurrence stands for, and its start only when the server answers none', () => {
        expect(occurrenceSlotOf({ recurrenceInstant: '2026-10-20T07:00:00+00:00' }, '2026-10-21T07:00:00.000Z'))
            .toBe('2026-10-20T07:00:00+00:00');
        expect(occurrenceSlotOf({}, '2026-10-21T07:00:00.000Z')).toBe('2026-10-21T07:00:00.000Z');
    });

    it("an edited occurrence whose slot was not answered has none: its start is no slot of the series", () => {
        expect(occurrenceSlotOf({ parentItemId: 'base' }, '2026-10-20T08:30:00.000Z')).toBeNull();
        expect(occurrenceSlotOf({ parentItemId: 'base', recurrenceInstant: '2026-10-20T07:00:00+00:00' }, null))
            .toBe('2026-10-20T07:00:00+00:00');
    });
});
