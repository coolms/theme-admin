import { HttpErrorResponse } from '@angular/common/http';
import { type EmailMessageDto, type EmailMessageList } from './email.types';
import { listedFromServer, rowKey } from './mail-server-rows';
import { retryAfterSeconds, serverSearchRefusal } from './mail-server-search';

/**
 * The message list loads more as the person scrolls: the next page is asked for when about one and a half screens of
 * rows remain below the view, a row at the list's end says it is loading, and the same row says when a page could not
 * be read, with the only Retry. The list is virtualized at a fixed row height. These helpers hold the rules; the page
 * holds the state.
 */

/** Rows in one page of the list. */
export const LIST_PAGE_SIZE = 50;

/** How many screens of rows may remain below the view before the next page is asked for. */
export const PREFETCH_SCREENS = 1.5;

/** How near the top, in px, the list counts as at its top: new mail then simply appears. */
export const AT_TOP_PX = 4;

/** How the next page is asked for: by the cursor the last answer gave, or by its number. */
export type PageRequest = { readonly cursor: string } | { readonly page: number };

/** The first page of a list. */
export const FIRST_PAGE: PageRequest = { page: 1 };

/**
 * The page after `answer`, which was asked for by `asked`; null on the last page. The answer's cursor when it gives
 * one; until every folder gives one, the next page number after a full page of a folder paged by number.
 */
export function nextPageOf(answer: EmailMessageList, asked: PageRequest): PageRequest | null {
    const cursor = answer.next ?? null;
    if (cursor !== null) {
        return { cursor };
    }
    // Paging by number, for a folder whose answers give no cursor. Goes once every folder gives one.
    if ('page' in asked && !listedFromServer(answer) && answer.length >= LIST_PAGE_SIZE) return { page: asked.page + 1 };

    return null;
}

/** Whether about one and a half screens of rows, or fewer, remain below the view. */
export function nearListEnd(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
    return scrollHeight - scrollTop - clientHeight <= PREFETCH_SCREENS * clientHeight;
}

/** What the row at the list's end says beyond loading: the page could not be read, or the server asked to wait. */
export type ListEnd = { kind: 'failed' } | { kind: 'rate-limited'; seconds: number };

/** Why a page was not given: a stale cursor, too many requests (with the wait, in seconds), or any other failure. */
export type PageRefusal = { kind: 'stale' } | { kind: 'rate-limited'; seconds: number } | { kind: 'failed' };

/** A page's error read: a 409 stale cursor, a 429 with its Retry-After, or a failure. */
export function pageRefusal(error: unknown): PageRefusal {
    const refusal = serverSearchRefusal(error);
    if (refusal.reason === 'stale-cursor') {
        return { kind: 'stale' };
    }
    if (refusal.reason === 'rate-limited') {
        return { kind: 'rate-limited', seconds: refusal.retryAfter ?? retryAfterSeconds(null) };
    }
    if (error instanceof HttpErrorResponse && error.status === 429) {
        return { kind: 'rate-limited', seconds: retryAfterSeconds(error.headers.get('Retry-After')) };
    }

    return { kind: 'failed' };
}

/** A row's height in px, the same for every row: three lines of text, its padding and its border. */
export function listRowHeight(rootFontPx: number): number {
    // Lines of .875rem, .8125rem and .75rem at line-height 1.5, two 2px gaps, 10px padding above and below, a 1px border.
    return Math.ceil((0.875 + 0.8125 + 0.75) * 1.5 * rootFontPx + 2 * 2 + 2 * 10 + 1);
}

/** The root font size in px; 16 where it cannot be read. */
export function rootFontPx(): number {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
        return 16;
    }
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize);

    return Number.isFinite(px) && px > 0 ? px : 16;
}

/** Where the person is looking: the first row in view, by its key, and how far into the rows the view starts. */
export interface ListAnchor {
    readonly key: string;
    readonly index: number;
    readonly into: number;
}

/** The anchor at `offset` px into the rows, each `rowHeight` tall; null when there are no rows. */
export function anchorAt(rows: readonly EmailMessageDto[], offset: number, rowHeight: number): ListAnchor | null {
    if (rows.length === 0 || rowHeight <= 0) {
        return null;
    }
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor(offset / rowHeight)));

    return { key: rowKey(rows[index]), index, into: offset - index * rowHeight };
}

/**
 * Where the view must start, in px into the rows, so the anchored row shows where it showed; null when that row is
 * no longer listed.
 */
export function offsetOfAnchor(rows: readonly EmailMessageDto[], anchor: ListAnchor, rowHeight: number): number | null {
    const index = rows.findIndex(m => rowKey(m) === anchor.key);

    return index < 0 ? null : index * rowHeight + anchor.into;
}

/** How many rows of `after` are new (not in `before`) and stand above the anchored row. */
export function arrivedAbove(before: readonly EmailMessageDto[], after: readonly EmailMessageDto[], anchor: ListAnchor): number {
    const had = new Set(before.map(rowKey));
    const at = after.findIndex(m => rowKey(m) === anchor.key);
    const above = at < 0 ? after : after.slice(0, at);

    return above.filter(m => !had.has(rowKey(m))).length;
}

/** The rows of a next page that the list does not show already: a page asked by number can overlap the last. */
export function newRowsOf(rows: readonly EmailMessageDto[], page: readonly EmailMessageDto[]): EmailMessageDto[] {
    const shown = new Set(rows.map(rowKey));

    return page.filter(m => !shown.has(rowKey(m)));
}

/** A row's aria-setsize: the folder's total when it is known and holds every row loaded, else -1. */
export function listSetSize(total: number | null | undefined, loaded: number): number {
    return typeof total === 'number' && Number.isFinite(total) && total >= loaded ? total : -1;
}
