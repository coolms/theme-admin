import { emptyInboxPage, firstInboxPage, InboxPage, nextInboxPage, Paged, refreshWindow } from './inbox-paging.util';

/**
 * Inbox paging by cursor -- the rules that let a capped conversation list stay
 * honest: no row rendered twice, no row stranded, and no state where the
 * "Load more" button is lit but cannot make progress.
 */
describe('inbox paging', () => {
    // Each row's cursor is its id with a prefix, so a test can tell which row's
    // cursor the state holds.
    const row = (id: string): Paged => ({ id, cursor: `k-${id}` });
    const rows = (...ids: string[]): Paged[] => ids.map(row);
    const idsOf = (page: InboxPage<Paged>): string[] => page.rows.map(r => r.id);

    describe('firstInboxPage', () => {
        it('takes the page as-is and resumes after its last row', () => {
            const page = firstInboxPage(rows('a', 'b', 'c'), 3);

            expect(idsOf(page)).toEqual(['a', 'b', 'c']);
            expect(page.after).toBe('k-c');
        });

        it('reports more when the server filled the request', () => {
            expect(firstInboxPage(rows('a', 'b', 'c'), 3).hasMore).toBe(true);
        });

        it('reports no more when the page came back short -- the only end-of-list signal there is', () => {
            expect(firstInboxPage(rows('a', 'b'), 3).hasMore).toBe(false);
            expect(firstInboxPage([], 3).hasMore).toBe(false);
            expect(firstInboxPage([], 3).after).toBeNull();
        });

        it('compares against what was ASKED FOR, not the page size', () => {
            // A refresh re-reads everything on screen (refreshWindow), so 30 rows
            // back from a request for 30 is a full page even though the client's
            // page size is 10 -- measuring against 10 would claim "more" forever.
            expect(firstInboxPage(rows(...Array.from({ length: 30 }, (_, i) => `c${i}`)), 30).hasMore).toBe(true);
        });
    });

    describe('nextInboxPage', () => {
        it('appends the next page in order and resumes after its last row', () => {
            const page = nextInboxPage(firstInboxPage(rows('a', 'b'), 2), rows('c', 'd'), 2);

            expect(idsOf(page)).toEqual(['a', 'b', 'c', 'd']);
            expect(page.after).toBe('k-d');
        });

        it('drops a row it already holds rather than rendering it twice', () => {
            // A refresh of the head and a "Load more" can overlap.
            const page = nextInboxPage(firstInboxPage(rows('a', 'b'), 2), rows('b', 'c'), 2);

            expect(idsOf(page)).toEqual(['a', 'b', 'c']);
        });

        it('moves the cursor to the last RAW row, so a page of duplicates still makes progress', () => {
            // The load-bearing one. Taking the cursor from the rows KEPT would
            // leave a page that was entirely duplicates re-requesting itself
            // forever, with the button still lit.
            const first = firstInboxPage(rows('a', 'b'), 2);
            const page = nextInboxPage(first, rows('a', 'b'), 2);

            expect(idsOf(page)).toEqual(['a', 'b']);
            expect(page.after).toBe('k-b');
            expect(page.hasMore).toBe(true);
        });

        it('keeps looking when a full page yielded nothing new', () => {
            const page = nextInboxPage(firstInboxPage(rows('a'), 1), rows('a'), 1);

            expect(page.hasMore).toBe(true);
        });

        it('stops on a short page even when every row of it was new', () => {
            const page = nextInboxPage(firstInboxPage(rows('a', 'b'), 2), rows('c'), 2);

            expect(page.hasMore).toBe(false);
            expect(idsOf(page)).toEqual(['a', 'b', 'c']);
        });

        it('keeps the cursor it had when a page comes back empty', () => {
            const page = nextInboxPage(firstInboxPage(rows('a', 'b'), 2), [], 2);

            expect(page.after).toBe('k-b');
            expect(page.hasMore).toBe(false);
        });

        it('ends paging at a row without a cursor instead of re-reading the head', () => {
            // With no `after` the next request would start from the top again:
            // the first page, deduped to nothing, forever.
            const bare: Paged = { id: 'c' };
            const page = nextInboxPage(firstInboxPage(rows('a', 'b'), 2), [bare, bare], 2);

            expect(page.after).toBeNull();
            expect(page.hasMore).toBe(false);
            expect(firstInboxPage([bare], 1).hasMore).toBe(false);
        });

        it('does not mutate the state it was handed', () => {
            const first = firstInboxPage(rows('a', 'b'), 2);
            nextInboxPage(first, rows('c'), 2);

            expect(idsOf(first)).toEqual(['a', 'b']);
            expect(first.after).toBe('k-b');
        });

        it('tolerates a page that repeats a row within itself', () => {
            const page = nextInboxPage(emptyInboxPage(), rows('a', 'a', 'b'), 3);

            expect(idsOf(page)).toEqual(['a', 'b']);
            expect(page.after).toBe('k-b');
        });
    });

    describe('refreshWindow', () => {
        it('re-reads everything currently on screen', () => {
            expect(refreshWindow(20, 60)).toBe(60);
        });

        it('never asks for less than one page', () => {
            expect(refreshWindow(20, 0)).toBe(20);
            expect(refreshWindow(20, 7)).toBe(20);
        });

        it('is what stops a background refresh from erasing the pages already loaded', () => {
            // Three pages loaded; a nudge arrives. Asking for one page would drop 40
            // rows out from under the reader.
            const loaded = 60;
            expect(refreshWindow(20, loaded)).toBeGreaterThanOrEqual(loaded);
        });
    });
});
