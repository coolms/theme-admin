import { rowVersionOf, seriesVersionOf } from './write-versions.util';

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
});
