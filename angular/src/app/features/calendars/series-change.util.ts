import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

import { wallMs } from './series-shift.util';

/** The problem type of a series change the server refused because it would leave occurrences on no slot. */
export const SERIES_CHANGE_LEAVES_OCCURRENCES = '/errors/series-change-leaves-occurrences';

/** One occurrence edited on its own that a change of its series would leave on no slot, as the 409 names it. */
export interface LeftException {
    readonly id: string;
    readonly start: string;
    readonly title: string;
}

/** What a refused series change would leave behind: edited occurrences, and skipped dates that would skip nothing. */
export interface SeriesChangeLeaves {
    readonly exceptions: readonly LeftException[];
    readonly skipDates: readonly string[];
}

/**
 * The occurrences and skip dates a 409 says a series change would leave behind, or null for any other failure.
 * Nothing was changed by that answer: the same change sent again with `discardExceptions: true` makes it and removes
 * them (the server audits each one).
 */
export function seriesChangeLeaves(err: unknown): SeriesChangeLeaves | null {
    if (!(err instanceof HttpErrorResponse) || err.status !== 409) {
        return null;
    }
    const body = (err.error ?? {}) as { type?: unknown; exceptions?: unknown; skipDates?: unknown };
    if (typeof body.type !== 'string' || !body.type.endsWith(SERIES_CHANGE_LEAVES_OCCURRENCES)) {
        return null;
    }
    const exceptions = Array.isArray(body.exceptions)
        ? (body.exceptions as Array<Record<string, unknown>>).map(e => ({
            id: String(e['id'] ?? ''),
            start: String(e['start'] ?? ''),
            title: typeof e['title'] === 'string' ? e['title'] : '',
        }))
        : [];
    const skipDates = Array.isArray(body.skipDates) ? body.skipDates.map(d => String(d)) : [];
    return { exceptions, skipDates };
}

/**
 * The date for {@link leftBehindMessage}: the day an instant falls on in `zone` (the one the calendar is shown in),
 * written in the person's date format (an Angular date pattern). The 409 writes its instants in UTC, whose date can be
 * a day off the one the person sees.
 */
export function dateOnClock(zone: string, pattern: string): (iso: string) => string {
    return iso => {
        const at = new Date(iso);
        return Number.isNaN(at.getTime()) ? iso.slice(0, 10) : formatDate(wallMs(at, zone), pattern, 'en-US', 'UTC');
    };
}

/**
 * The question put to the person: what the move would remove, named -- the edited events by title and date (an
 * untitled one as such), and how many skipped dates would skip nothing any more.
 */
export function leftBehindMessage(left: SeriesChangeLeaves, formatDate: (iso: string) => string = iso => iso.slice(0, 10)): string {
    const parts: string[] = [];
    if (left.exceptions.length > 0) {
        const named = left.exceptions.slice(0, 5)
            .map(e => `${e.title.trim() !== '' ? `"${e.title}"` : 'an untitled event'} on ${formatDate(e.start)}`);
        const more = left.exceptions.length > 5 ? `, and ${left.exceptions.length - 5} more` : '';
        parts.push(`${left.exceptions.length === 1 ? 'An event' : `${left.exceptions.length} events`} changed one by one `
            + `would fit no event of the moved series: ${named.join(', ')}${more}.`);
    }
    if (left.skipDates.length > 0) {
        parts.push(`${left.skipDates.length === 1 ? 'A skipped date' : `${left.skipDates.length} skipped dates`} `
            + 'would skip nothing any more.');
    }
    parts.push('Moving removes them. Nothing changes until you choose.');
    return parts.join(' ');
}
