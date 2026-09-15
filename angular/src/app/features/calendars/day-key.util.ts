/**
 * Arithmetic on canonical `YYYY-MM-DD` day keys -- the keys
 * `DateTimeFormatService.dayKey()` hands out for an instant in the PERSON's
 * timezone.
 *
 * A key names a calendar day and nothing else: no zone, no clock. The `Date`
 * behind each helper therefore sits at UTC midnight of that day, so the
 * browser's own zone can never move the day, and the names Intl gives a day
 * (`Mon`, `Mar 11`) are taken with `timeZone: 'UTC'` for the same reason.
 * Those names are locale-sensitive but never ambiguous, so the browser's
 * language is kept; the DAY is the profile's.
 *
 * Its natural home is the kit, beside `dayKey()`; it lives here until a second
 * package needs it.
 */

const DAY_MS = 86_400_000;

/** The instant of UTC midnight on the day `key` names. */
export function utcDayOf(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/** The key of the day `days` after `key` (before it, when negative). */
export function shiftDayKey(key: string, days: number): string {
    const dt = utcDayOf(key);
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to`; negative when `to` is the earlier day. */
export function calendarDaysBetween(from: string, to: string): number {
    return Math.round((utcDayOf(to).getTime() - utcDayOf(from).getTime()) / DAY_MS);
}

/** The key of a browser-local `Date`'s own calendar day (its local Y-M-D). */
export function localDayKey(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A browser-local `Date` at local midnight of the day `key` names -- for a
 * widget that speaks local Dates and reads only Y-M-D from them (the
 * mini-calendar).
 */
export function localDateOf(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** The day's short weekday name, e.g. `Mon`. */
export function weekdayName(key: string): string {
    return utcDayOf(key).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
}

/** The day as a short month and a day number, e.g. `Mar 11`. */
export function monthDayName(key: string): string {
    return utcDayOf(key).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}
