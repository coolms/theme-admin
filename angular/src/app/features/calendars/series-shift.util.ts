/**
 * Moving every occurrence of a series by what one of them was moved. "All events" on a dragged occurrence moves the
 * whole series by the same difference -- days and time of day -- and drops nothing: the difference is read on the
 * wall clock of the series' zone, and applied to the series' own start and end on that wall clock. A series that runs
 * at 09:00 still runs at 09:00 after being moved across a daylight-saving change, which an hour count would not do.
 */

const DAY_MS = 86_400_000;

/** Where `instant` falls on the wall clock of `zone`, as a count of milliseconds read as if that wall clock were UTC. */
export function wallMs(instant: Date, zone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(p => p.type === type)?.value ?? 0);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
        + instant.getUTCMilliseconds();
}

/**
 * The instant whose wall clock in `zone` reads `wall` (see {@link wallMs}). A wall time a daylight-saving change skips
 * lands just after the gap; one it repeats lands on the first of the two.
 */
export function instantOfWall(wall: number, zone: string): Date {
    let guess = wall;
    for (let i = 0; i < 4; i++) {
        const next = wall - (wallMs(new Date(guess), zone) - guess);
        if (next === guess) {
            break;
        }
        guess = next;
    }
    return new Date(guess);
}

/** A `YYYY-MM-DD` date moved by whole days. */
function shiftDate(date: string, days: number): string {
    return new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

/** A series "All events" does not move, with the reason for the person; nothing was written. */
export class SeriesNotMovedError extends Error {}

export interface SeriesTimes {
    readonly start: string;
    readonly end: string | null;
    readonly allDay: boolean;
}

/**
 * The series' start and end, moved by the difference between where one occurrence was (`from`) and where it was
 * dropped (`to`), in `zone`. An all-day series moves by whole days (`from`/`to` read as dates).
 */
export function shiftSeries(series: SeriesTimes, from: string, to: string, zone: string): { start: string; end: string | null } {
    const move = seriesMove(series.allDay, from, to, zone);
    if (series.allDay) {
        const days = move.delta / DAY_MS;
        return { start: shiftDate(series.start, days), end: series.end === null ? null : shiftDate(series.end, days) };
    }
    const shift = (iso: string): string => instantOfWall(wallMs(new Date(iso), zone) + move.delta, zone).toISOString();
    return { start: shift(series.start), end: series.end === null ? null : shift(series.end) };
}

/**
 * The difference one occurrence was moved by (`from` to `to`), on the wall clock the series repeats on: `zone` for a
 * timed series; UTC and whole days for an all-day series (`from`/`to` read as dates).
 */
export function seriesMove(allDay: boolean, from: string, to: string, zone: string): { readonly zone: string; readonly delta: number } {
    if (allDay) {
        return { zone: 'UTC', delta: Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS) * DAY_MS };
    }
    return { zone, delta: wallMs(new Date(to), zone) - wallMs(new Date(from), zone) };
}

/**
 * The series' end, moved by the difference between one occurrence's end before (`from`) and after (`to`) a resize, in
 * `zone`: every occurrence becomes as much longer or shorter. Null when the series has no end to stretch.
 */
export function stretchSeries(series: SeriesTimes, from: string, to: string, zone: string): { end: string | null } {
    if (series.end === null) {
        return { end: null };
    }
    if (series.allDay) {
        const days = Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
        return { end: shiftDate(series.end, days) };
    }
    const delta = wallMs(new Date(to), zone) - wallMs(new Date(from), zone);
    return { end: instantOfWall(wallMs(new Date(series.end), zone) + delta, zone).toISOString() };
}
