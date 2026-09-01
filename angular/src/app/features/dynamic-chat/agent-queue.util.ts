/**
 * How the agent queue is counted and ordered.
 *
 * Both rules were inlined in a component before — the count in the topbar
 * badge, the order in the quick panel — so neither had a test and the two could
 * disagree about what "new" means without anything noticing.
 */

/** The subset of an agent conversation these rules read. */
export interface QueueEntry {
    /** `new` (waiting for an agent) | `answered` | … Absent when not resolved. */
    readonly agentStatus?: string;
    /** ISO-8601 timestamp of the last activity; null when unknown. */
    readonly updatedAt?: string | null;
}

/** A conversation still waiting for an agent — what the badge counts. */
export function isNewInQueue(entry: QueueEntry): boolean {
    return entry.agentStatus === 'new';
}

/**
 * How many conversations are waiting for an agent.
 *
 * `agentStatus` is OPTIONAL on the wire, and an absent one is NOT new — a row
 * whose status the server did not resolve must not inflate the badge and send
 * an agent looking for work that isn't there.
 */
export function countNewConversations(entries: readonly QueueEntry[]): number {
    return entries.reduce((n, entry) => n + (isNewInQueue(entry) ? 1 : 0), 0);
}

/**
 * Waiting conversations first, then most-recently-active — the order an agent
 * works the queue in.
 *
 *  Returns a NEW array: `Array.prototype.sort` mutates, and these lists come
 * straight out of a signal that other views read.
 *
 *  The recency comparison is a STRING compare on `updatedAt`, which is only
 * an ordering because ISO-8601 sorts lexicographically — and only while every
 * timestamp shares one format, precision and offset. A server that started
 * emitting local-offset timestamps for some rows would silently misorder the
 * queue rather than fail. `null` sorts last, which is the right place for a
 * conversation whose activity is unknown.
 */
export function sortQueue<T extends QueueEntry>(entries: readonly T[]): T[] {
    const rank = (e: QueueEntry): number => (isNewInQueue(e) ? 0 : 1);

    return [...entries].sort((a, b) => {
        const byStatus = rank(a) - rank(b);

        return byStatus !== 0 ? byStatus : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });
}
