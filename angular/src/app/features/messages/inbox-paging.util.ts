/**
 * Inbox paging state (#2120) — shared by the Messages PAGE and the topbar quick
 * panel, so the two cannot drift.
 *
 * `GET /chat/conversations` used to answer with every conversation the caller
 * had ever joined. It now takes `limit`/`offset` and returns a BARE ARRAY with
 * no total, which fixes the shape of everything here: "is there more?" can only
 * be read off the page LENGTH, and a page that comes back shorter than we asked
 * for is the last one.
 *
 * Two things are easy to get wrong and are the reason this is a unit rather
 * than two copies of an `if`:
 *
 *  1. **The offset counts rows CONSUMED, not rows held.** The list is ordered by
 *     an ever-increasing key (`updatedAt`), so a conversation that gets a message
 *     mid-paging moves towards the HEAD and can be served on two consecutive
 *     pages. That is the benign direction — a row can repeat, never be skipped —
 *     but only if the repeat is deduped, and deriving the next offset from the
 *     deduped list would then re-request the same page forever.
 *  2. **A full page of pure duplicates still means there is more.** Stopping on
 *     "nothing new arrived" would strand the tail behind rows that merely shifted.
 *
 * A page that exactly fills the request reads as "there may be more" even when
 * it was the last one, so at that boundary the affordance survives one dead
 * click: the next request comes back empty and it disappears. That is the safe
 * direction — the alternative is hiding rows that exist.
 */

/** Anything with a stable identity — every row shape this pages over has an id. */
export interface Identified {
    readonly id: string;
}

/** One page's worth of accumulated inbox state. */
export interface InboxPage<T extends Identified> {
    /** The rows to render, in server order, deduped by id. */
    readonly rows: readonly T[];
    /** Rows consumed from the server ordering — the NEXT request's offset. */
    readonly offset: number;
    /** Whether another page is worth asking for. */
    readonly hasMore: boolean;
}

/** The empty state, before anything has loaded. */
export function emptyInboxPage<T extends Identified>(): InboxPage<T> {
    return { rows: [], offset: 0, hasMore: false };
}

/**
 * Seed (or re-seed) from a read that started at offset 0 — the initial load and
 * every background refresh.
 *
 * `asked` is what the request asked for, NOT the client's page size: a refresh
 * re-reads everything currently on screen (see {@link refreshWindow}), so
 * comparing against the page size would report "more" on every refresh.
 */
export function firstInboxPage<T extends Identified>(page: readonly T[], asked: number): InboxPage<T> {
    return { rows: dedupe(page), offset: page.length, hasMore: page.length >= asked };
}

/**
 * Fold the next page onto the accumulated state.
 *
 * The offset advances by the RAW page length so progress never depends on how
 * many rows survived the dedupe.
 */
export function nextInboxPage<T extends Identified>(
    current: InboxPage<T>,
    page: readonly T[],
    asked: number,
): InboxPage<T> {
    const seen = new Set(current.rows.map(r => r.id));
    const fresh = page.filter(r => !seen.has(r.id));

    return {
        rows: fresh.length > 0 ? [...current.rows, ...dedupe(fresh)] : current.rows,
        offset: current.offset + page.length,
        hasMore: page.length >= asked,
    };
}

/**
 * How many rows a REFRESH should re-read: everything currently on screen, never
 * fewer than one page.
 *
 * A refresh that dropped back to the first page would erase every "Load more"
 * the user had clicked — and it fires on a live nudge, so it would happen while
 * they were reading.
 */
export function refreshWindow(pageSize: number, loadedCount: number): number {
    return Math.max(pageSize, loadedCount);
}

/** First occurrence wins — a page can carry a row twice only if the server does. */
function dedupe<T extends Identified>(rows: readonly T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const row of rows) {
        if (!seen.has(row.id)) {
            seen.add(row.id);
            out.push(row);
        }
    }

    return out;
}
