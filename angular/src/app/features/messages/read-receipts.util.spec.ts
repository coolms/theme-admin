import { advancePeerCursor, peerReadCursors, readByEveryoneSeq, ReadReceiptParticipant } from './read-receipts.util';

/**
 * The read-receipt rule: a tick flips to "Read" only once EVERY peer has read
 * that far — including after a live `read` nudge, which is where it
 * used to break.
 */
describe('read receipts', () => {
    const me = 'user-me';

    const peer = (id: string, lastReadSeq: number, userId = 'user-' + id): ReadReceiptParticipant =>
        ({ participantId: id, userId, lastReadSeq });

 describe('peerReadCursors', () => {
 it('keys every other participant by participant id and excludes me', () => {
            const roster: ReadReceiptParticipant[] = [
                { participantId: 'p-me', userId: me, lastReadSeq: 9 },
                peer('a', 4),
                peer('b', 7),
            ];

            const cursors = peerReadCursors(roster, me);

            expect([...cursors.entries()]).toEqual([['a', 4], ['b', 7]]);
            expect(cursors.has('p-me')).toBe(false);
        });

 it('treats a participant with no cursor as having read nothing', () => {
            const cursors = peerReadCursors([{ participantId: 'a', userId: 'user-a' }], me);

            expect(cursors.get('a')).toBe(0);
        });

 it('counts anonymous participants (no userId) as peers', () => {
            const cursors = peerReadCursors([{ participantId: 'visitor', userId: null, lastReadSeq: 3 }], me);

            expect(cursors.get('visitor')).toBe(3);
        });
    });

 describe('readByEveryoneSeq', () => {
 it('is the LOWEST peer cursor, not the highest', () => {
            expect(readByEveryoneSeq(new Map([['a', 12], ['b', 3], ['c', 8]]))).toBe(3);
        });

 it('is zero when a peer has never read', () => {
            expect(readByEveryoneSeq(new Map([['a', 12], ['b', 0]]))).toBe(0);
        });

 it('is zero when there are no peers at all', () => {
 // Self-notes, or a roster that hasn't loaded: with nobody to read
 // them, nothing is read — never "everything".
            expect(readByEveryoneSeq(new Map())).toBe(0);
        });
    });

 describe('advancePeerCursor', () => {
 it('advances only the participant the nudge names', () => {
            const before = new Map([['a', 1], ['b', 1]]);

            const after = advancePeerCursor(before, 'a', 10);

            expect(after.get('a')).toBe(10);
            expect(after.get('b')).toBe(1);
        });

 it('does NOT let one peer read for the whole group', () => {
 // THE regression: `b` still trails, so my messages above seq 1
 // are not "Read" just because `a` opened the channel.
            const cursors = advancePeerCursor(peerReadCursors([peer('a', 1), peer('b', 1)], me), 'a', 42);

            expect(readByEveryoneSeq(cursors)).toBe(1);
        });

 it('flips to read once the LAST peer catches up', () => {
            let cursors = peerReadCursors([peer('a', 1), peer('b', 1)], me);
            cursors = advancePeerCursor(cursors, 'a', 42);
            expect(readByEveryoneSeq(cursors)).toBe(1);

            cursors = advancePeerCursor(cursors, 'b', 42);
            expect(readByEveryoneSeq(cursors)).toBe(42);
        });

 it('records a peer who joined after the roster loaded', () => {
            expect(advancePeerCursor(new Map(), 'late-joiner', 5).get('late-joiner')).toBe(5);
        });

 it('returns the same map for a stale or repeated nudge, so a signal does not re-emit', () => {
            const before = new Map([['a', 10]]);

            expect(advancePeerCursor(before, 'a', 4)).toBe(before);
            expect(advancePeerCursor(before, 'a', 10)).toBe(before);
        });

 it('never moves a cursor backwards', () => {
            expect(advancePeerCursor(new Map([['a', 10]]), 'a', 2).get('a')).toBe(10);
        });
    });
});
