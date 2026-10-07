import { shiftDayKey } from './day-key.util';

/**
 * An item's start and end as the calendar holds them (2026-10-07). An ALL-DAY item is its DATES -- "2030-03-12", no
 * zone, no clock -- and a timed one its instants. A date read through `new Date()` becomes an instant (UTC
 * midnight, or the browser's local midnight), and that instant falls on the previous day in every zone on the other
 * side of UTC, so an all-day item never goes through one.
 */
export interface ItemRange {
    readonly start: string;
    readonly end:   string | null;
}

/** The parts of FullCalendar's EventApi the range is read from. */
export interface FcEventDates {
    readonly allDay:   boolean;
    readonly start:    Date | null;
    readonly end:      Date | null;
    readonly startStr: string;
    readonly endStr:   string;
}

/**
 * What an action captures from a rendered event. FullCalendar holds an all-day event at the browser's LOCAL
 * midnight, whose `toISOString()` east of UTC is the day before ("2030-03-11T21:00:00.000Z" for the 12th in
 * Minsk); its `startStr` is the date itself. So an all-day event is read by `startStr`/`endStr`, a timed one by its
 * instants, as before.
 */
export function capturedRange(event: FcEventDates): ItemRange {
    if (event.allDay) {
        return { start: event.startStr.slice(0, 10), end: event.endStr ? event.endStr.slice(0, 10) : null };
    }
    return { start: event.start?.toISOString() ?? new Date().toISOString(), end: event.end?.toISOString() ?? null };
}

/** The same range one day later, what Duplicate creates: an all-day item by DATE, a timed one by a local day. */
export function nextDayRange(range: ItemRange, allDay: boolean): ItemRange {
    if (allDay) {
        return {
            start: shiftDayKey(range.start.slice(0, 10), 1),
            end:   range.end ? shiftDayKey(range.end.slice(0, 10), 1) : null,
        };
    }
    const start = new Date(range.start);
    start.setDate(start.getDate() + 1);
    const end = range.end ? new Date(range.end) : null;
    end?.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end?.toISOString() ?? null };
}

/** Exactly a date, `YYYY-MM-DD`, nothing after it. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day an item is listed under: a start that is exactly a date is that date; any other start is an instant, and
 * its day is the person's (`dayKey` of the formatter, passed in), as before. Decided by the VALUE, not by `allDay`:
 * until the server sends all-day items as dates, it sends them as the instant of midnight in the calendar's zone,
 * whose first ten characters east of UTC name the day before ("2026-10-05T21:00:00+00:00" is Moscow's 6th).
 */
export function itemDayKey(item: { readonly start: string }, dayKey: (iso: string) => string): string {
    return BARE_DATE.test(item.start) ? item.start : dayKey(item.start);
}
