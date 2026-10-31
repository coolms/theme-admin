import { GROUP_GAP_MINUTES, groupVersions, type PageVersionDto } from './page-versions';

/**
 * Consecutive saves by one person are one row; each stays a version of its own. A save by someone else, or one more
 * than ten minutes before the save above it, starts a new row.
 */
describe('groupVersions', () => {
    const ann = { id: 'ann', name: 'Ann' };
    const bob = { id: 'bob', name: 'Bob' };
    let seq = 100;
    const v = (at: string, author: PageVersionDto['author'], changes: string[] = ['blocks']): PageVersionDto =>
        ({ id: 'v' + seq, seq: seq--, recordedAt: '2026-10-31T' + at + ':00Z', author, message: null, changes });

    it('puts consecutive saves by one person, each within ten minutes of the next, in one group', () => {
        const versions = [v('14:11', ann, ['tags']), v('14:05', ann), v('14:02', ann, ['en body'])];

        const groups = groupVersions(versions);

        expect(groups.length).toBe(1);
        expect(groups[0].versions).toEqual(versions);
        expect(groups[0].newest).toBe('2026-10-31T14:11:00Z');
        expect(groups[0].oldest).toBe('2026-10-31T14:02:00Z');
        expect(groups[0].changes).toEqual(['tags', 'blocks', 'en body']);
    });

    it('starts a new group for someone else', () => {
        const groups = groupVersions([v('14:11', ann), v('14:10', bob), v('14:09', ann)]);

        expect(groups.map(g => g.author?.id)).toEqual(['ann', 'bob', 'ann']);
    });

    it('starts a new group after a gap of more than ten minutes, and keeps one of exactly ten', () => {
        const groups = groupVersions([v('14:30', ann), v('14:20', ann), v('14:09', ann)]);

        expect(GROUP_GAP_MINUTES).toBe(10);
        expect(groups.map(g => g.versions.length)).toEqual([2, 1]);
    });

    it('treats versions with no author (the platform) as one author among themselves', () => {
        const groups = groupVersions([v('14:11', null), v('14:10', null), v('14:09', ann)]);

        expect(groups.map(g => g.versions.length)).toEqual([2, 1]);
    });

    it('keeps every version, in order, in exactly one group', () => {
        const versions = [v('15:00', ann), v('14:59', bob), v('14:58', bob), v('14:30', bob), v('14:29', ann)];

        expect(groupVersions(versions).flatMap(g => g.versions)).toEqual(versions);
    });

    it('answers no group for no version', () => {
        expect(groupVersions([])).toEqual([]);
    });
});
