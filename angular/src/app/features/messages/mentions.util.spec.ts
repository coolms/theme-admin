import { mentionsUser } from './mentions.util';
import { MentionRef } from './messages.types';

/**
 * "Does this message mention me" (#2124) — the predicate that decides which
 * bubble gets the accent. Untested until the accent existed to be wrong about.
 */
describe('mentionsUser', () => {
    const me = 'user-me';
    const msg = (...mentions: MentionRef[]): { mentions: MentionRef[] } => ({ mentions });
    const ref = (userId: string, label = 'Someone'): MentionRef => ({ userId, label });

    it('is true when the message mentions that user', () => {
        expect(mentionsUser(msg(ref(me, 'Me')), me)).toBe(true);
    });

    it('is false when it mentions someone else', () => {
        expect(mentionsUser(msg(ref('user-other')), me)).toBe(false);
    });

    it('finds the user among several mentions', () => {
        expect(mentionsUser(msg(ref('user-a'), ref(me), ref('user-b')), me)).toBe(true);
    });

    it('is false for a message with no mentions', () => {
        expect(mentionsUser(msg(), me)).toBe(false);
        expect(mentionsUser({ mentions: undefined }, me)).toBe(false);
    });

    it('is false when there is no current user', () => {
        // Before auth hydrates, `meId` is null — every message would otherwise
        // have to be compared against nothing, and a loose `===` on two
        // undefineds would light up the whole thread.
        expect(mentionsUser(msg(ref(me)), null)).toBe(false);
        expect(mentionsUser(msg(ref('')), '')).toBe(false);
    });

    it('matches on the USER ID and never on the label', () => {
        // ⚠️ A mention snapshots the display name as typed: two people called
        // "Alex" share a label, and a renamed user keeps their old one. Matching
        // by label would highlight the wrong person's messages.
        expect(mentionsUser(msg({ userId: 'user-other', label: 'Me' }), me)).toBe(false);
        expect(mentionsUser(msg({ userId: me, label: 'stale old name' }), me)).toBe(true);
    });
});
