/**
 * Inbox paging state -- shared by the Messages PAGE and the topbar quick
 * panel, so the two cannot drift.
 *
 * `GET /chat/conversations` pages by CURSOR (request 0007): each row carries a
 * `cursor`, the key of that row in the list's order (last activity, then id),
 * and `?after=<cursor>` answers the rows that come after it. The response is a
 * BARE ARRAY with no total, so "is there more?" is still read off the page
 * LENGTH: a page that comes back shorter than we asked for is the last one.
 *
 * What a cursor changes, against the offset this replaced:
 *
 *  1. **A row that moves cannot be served twice by the next page.** A
 *     conversation that gets a message mid-paging moves to the HEAD, which is
 *     before every cursor already handed out. An offset counted positions, so
 *     the same move shifted every later row down one and the next page repeated
 *     one. Rows are still deduped by id, because a refresh and a "Load more" can
 *     overlap.
 *  2. **A row that moves is not skipped either.** It is at the head, and the
 *     live nudge that reported the move refreshes the head (see
 *     {@link refreshWindow}).
 *  3. **The next cursor is the last RAW row's**, not the last row kept after the
 *     dedupe, so progress never depends on how many rows survived.
 *  4. **A row with no cursor ends paging.** Asking again with no `after` would
 *     re-read the first page forever with the button lit.
 *
 * A page that exactly fills the request reads as "there may be more" even when
 * it was the last one, so at that boundary the affordance survives one dead
 * click: the next request comes back empty and it disappears. That is the safe
 * direction -- the alternative is hiding rows that exist.
 */

/** Anything with a stable identity -- every row shape this pages over has an id. */
export interface Identified {
    readonly id: string;
}

/** A row the server can page after: its key in the list's order. */
export interface Paged extends Identified {
    readonly cursor?: string | null;
}

/** One page's worth of accumulated inbox state. */
export interface InboxPage<T extends Paged> {
    /** The rows to render, in server order, deduped by id. */
    readonly rows: readonly T[];
    /** Where the NEXT request resumes: the last row read's cursor, or null before any. */
    readonly after: string | null;
    /** Whether another page is worth asking for. */
    readonly hasMore: boolean;
}

/** The empty state, before anything has loaded. */
export function emptyInboxPage<T extends Paged>(): InboxPage<T> {
    return { rows: [], after: null, hasMore: false };
}

/**
 * Seed (or re-seed) from a read that started at the head -- the initial load and
 * every background refresh.
 *
 * `asked` is what the request asked for, NOT the client's page size: a refresh
 * re-reads everything currently on screen (see {@link refreshWindow}), so
 * comparing against the page size would report "more" on every refresh.
 */
export function firstInboxPage<T extends Paged>(page: readonly T[], asked: number): InboxPage<T> {
    const after = lastCursor(page, null);

    return { rows: dedupe(page), after, hasMore: page.length >= asked && null !== after };
}

/**
 * Fold the next page onto the accumulated state.
 *
 * The cursor moves to the last RAW row of the page, so progress never depends on
 * how many rows survived the dedupe. An empty page keeps the cursor it had.
 */
export function nextInboxPage<T extends Paged>(
    current: InboxPage<T>,
    page: readonly T[],
    asked: number,
): InboxPage<T> {
    const seen = new Set(current.rows.map(r => r.id));
    const fresh = page.filter(r => !seen.has(r.id));
    const after = lastCursor(page, current.after);

    return {
        rows: fresh.length > 0 ? [...current.rows, ...dedupe(fresh)] : current.rows,
        after,
        hasMore: page.length >= asked && null !== after,
    };
}

/**
 * How many rows a REFRESH should re-read: everything currently on screen, never
 * fewer than one page.
 *
 * A refresh that dropped back to the first page would erase every "Load more"
 * the user had clicked -- and it fires on a live nudge, so it would happen while
 * they were reading.
 */
export function refreshWindow(pageSize: number, loadedCount: number): number {
    return Math.max(pageSize, loadedCount);
}

/**
 * The last row's cursor; `fallback` for an empty page. A last row WITHOUT a
 * cursor answers null, which ends paging (see the file comment, point 4).
 */
function lastCursor<T extends Paged>(page: readonly T[], fallback: string | null): string | null {
    if (page.length === 0) {
        return fallback;
    }
    const cursor = page[page.length - 1].cursor;

    return typeof cursor === 'string' && cursor !== '' ? cursor : null;
}

/** First occurrence wins -- a page can carry a row twice only if the server does. */
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
