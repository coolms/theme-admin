import { type DateTimeFormatService } from '@coolms/ui-angular';

import { shiftDayKey, utcDayOf } from './day-key.util';

export type FcViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

/**
 * The toolbar title for a displayed view -- "May 2026", "May 25 - 31, 2026",
 * "Saturday, May 30, 2026" -- from FullCalendar's `currentStart` and
 * `currentEnd`.
 *
 * FullCalendar 7 resolves a named `timeZone` itself (temporal-polyfill), so
 * those two are TRUE INSTANTS: the moment the period begins in the PERSON's
 * zone. Read with the browser's `getMonth()` or `toLocaleString()`, such an
 * instant lands on the previous day for every browser west of the profile's
 * zone -- September's month view titled "August 2026", Tuesday's day view
 * titled Monday. So each bound is projected into the profile's zone first
 * (`DateTimeFormatService.dayKey`) and the title is composed from calendar
 * days, named with `timeZone: 'UTC'` so the browser cannot move them again.
 *
 * `currentEnd` is FullCalendar's EXCLUSIVE end (for the week Mon May 25 -
 * Sun May 31 it names Mon Jun 1), so the visible last day is one day back.
 */
export function viewTitle(view: FcViewName, currentStart: Date, currentEnd: Date, dtf: DateTimeFormatService): string {
    const startKey = dtf.dayKey(currentStart.toISOString());
    const lastKey  = shiftDayKey(dtf.dayKey(currentEnd.toISOString()), -1);
    const start    = utcDayOf(startKey);

    if (view === 'timeGridDay') {
        return start.toLocaleString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
        });
    }
    if (view === 'timeGridWeek') {
        const last = utcDayOf(lastKey);
        if (startKey.slice(0, 7) === lastKey.slice(0, 7)) {
            // "May 25 - 31, 2026"
            const month = start.toLocaleString(undefined, { month: 'long', timeZone: 'UTC' });
            return `${month} ${start.getUTCDate()} – ${last.getUTCDate()}, ${start.getUTCFullYear()}`;
        }
        // Month-crossing or year-crossing -- show both ends explicitly.
        const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
        return `${start.toLocaleString(undefined, fmt)} – ${last.toLocaleString(undefined, fmt)}`;
    }
    // dayGridMonth -- "May 2026"
    return start.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
