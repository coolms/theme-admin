/**
 * Read-receipt derivation for the internal Messages surface.
 *
 * A tick is "Read" only once EVERY other participant has read that far, so the
 * receipt high-water is the MINIMUM of the peers' cursors — while the live
 * `read` nudge that advances it names ONE participant. Keeping the peers'
 * cursors and taking the min is the only way for both halves to agree; folding
 * them into a single number made one member's read speak for the whole group
 *.
 *
 * Pure functions, deliberately outside the page component: this is the part
 * worth testing, and it was untestable while it lived as three lines spread
 * across a 2 500-line component.
 */

/** The participant fields the receipt derivation needs (a subset of the DTO). */
export interface ReadReceiptParticipant {
    readonly participantId: string;
    readonly userId?: string | null;
    readonly lastReadSeq?: number;
}

/**
 * Each OTHER participant's persisted read cursor, keyed by participant id —
 * the seed taken when a conversation is opened. A peer who has never opened the
 * conversation sits at 0 and correctly holds the ticks at "Sent".
 */
export function peerReadCursors(
    participants: readonly ReadReceiptParticipant[] | undefined,
    meId: string | null,
): ReadonlyMap<string, number> {
    const cursors = new Map<string, number>();
    for (const p of participants ?? []) {
        if (p.userId !== meId) {
            cursors.set(p.participantId, p.lastReadSeq ?? 0);
        }
    }

    return cursors;
}

/**
 * The seq every peer has read past — messages at or below it show "Read".
 *
 * Zero when there are no peers (a self-notes conversation, or one whose roster
 * hasn't loaded): with nobody to read them, nothing is read.
 */
export function readByEveryoneSeq(cursors: ReadonlyMap<string, number>): number {
    let min: number | null = null;
    for (const seq of cursors.values()) {
        min = null === min ? seq : Math.min(min, seq);
    }

    return min ?? 0;
}

/**
 * Advance ONE peer's cursor (a live `read` nudge). Returns the SAME map when
 * the nudge carries nothing new, so a signal holding it doesn't re-emit.
 *
 * A nudge from a participant absent from the seeded roster — they joined since
 * the list loaded — is recorded rather than dropped.
 */
export function advancePeerCursor(
    cursors: ReadonlyMap<string, number>,
    participantId: string,
    seq: number,
): ReadonlyMap<string, number> {
    if ((cursors.get(participantId) ?? 0) >= seq) {
        return cursors;
    }

    return new Map(cursors).set(participantId, seq);
}
