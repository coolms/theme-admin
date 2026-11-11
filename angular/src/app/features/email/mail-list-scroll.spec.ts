import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { type EmailMessageDto, type EmailMessageList } from './email.types';
import {
    FIRST_PAGE, LIST_PAGE_SIZE, anchorAt, arrivedAbove, listRowHeight, listSetSize, nearListEnd, newRowsOf, nextPageOf,
    offsetOfAnchor, pageRefusal,
} from './mail-list-scroll';

const row = (n: number): EmailMessageDto => ({ id: `m-${n}`, folder: 'INBOX', subject: `Message ${n}` });
const rows = (n: number): EmailMessageDto[] => Array.from({ length: n }, (_, i) => row(i + 1));
const page = (list: EmailMessageDto[], next: string | null = null): EmailMessageList => Object.assign([...list], { next, serverPages: null });

describe('mail-list-scroll', () => {
    it('the next page: the cursor an answer gives, else the next number after a full page, else none', () => {
        expect(nextPageOf(page(rows(LIST_PAGE_SIZE), 'c-2'), FIRST_PAGE)).toEqual({ cursor: 'c-2' });
        expect(nextPageOf(page(rows(3), 'c-2'), { cursor: 'c-1' })).withContext('a cursor however short the page').toEqual({ cursor: 'c-2' });
        expect(nextPageOf(page(rows(LIST_PAGE_SIZE)), { page: 2 })).toEqual({ page: 3 });
        expect(nextPageOf(page(rows(LIST_PAGE_SIZE - 1)), { page: 2 })).withContext('a short page is the last').toBeNull();
        expect(nextPageOf(page(rows(LIST_PAGE_SIZE)), { cursor: 'c-9' })).withContext('a cursor list ends without one').toBeNull();
    });

    it('near the end: one and a half screens or fewer below the view', () => {
        expect(nearListEnd(4000, 4000 - 400 - 601, 400)).toBeFalse();
        expect(nearListEnd(4000, 4000 - 400 - 600, 400)).toBeTrue();
        expect(nearListEnd(300, 0, 400)).withContext('rows shorter than the view').toBeTrue();
    });

    it('reads a refused page: stale, rate-limited with its wait, or failed', () => {
        const stale = new HttpErrorResponse({ status: 409, error: { type: '/errors/email/server-search/stale-cursor' } });
        expect(pageRefusal(stale)).toEqual({ kind: 'stale' });
        expect(pageRefusal(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '7' }) })))
            .toEqual({ kind: 'rate-limited', seconds: 7 });
        expect(pageRefusal(new HttpErrorResponse({ status: 503 }))).toEqual({ kind: 'failed' });
        expect(pageRefusal(new Error('network'))).toEqual({ kind: 'failed' });
    });

    it('an anchor keeps the row at the view\'s top through rows coming above it', () => {
        const before = rows(10);
        const anchor = anchorAt(before, 3 * 80 + 12, 80)!;
        expect(anchor).toEqual({ key: 'id:m-4', index: 3, into: 12 });
        const after = [row(100), row(101), ...before];
        expect(offsetOfAnchor(after, anchor, 80)).toBe(5 * 80 + 12);
        expect(arrivedAbove(before, after, anchor)).toBe(2);
        expect(offsetOfAnchor([row(1)], anchor, 80)).withContext('the row gone').toBeNull();
    });

    it('a next page adds only rows not shown already', () => {
        expect(newRowsOf(rows(3), [row(3), row(4)]).map(m => m.id)).toEqual(['m-4']);
    });

    it('a row\'s height is fixed from the root font size; the set size is the total or -1', () => {
        expect(listRowHeight(16)).toBe(84);
        expect(listRowHeight(20)).toBeGreaterThan(listRowHeight(16));
        expect(listSetSize(5544, 150)).toBe(5544);
        expect(listSetSize(null, 150)).toBe(-1);
        expect(listSetSize(100, 150)).toBe(-1);
    });
});
