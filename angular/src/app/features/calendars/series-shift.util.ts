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
    if (series.allDay) {
        const days = Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
        return { start: shiftDate(series.start, days), end: series.end === null ? null : shiftDate(series.end, days) };
    }
    const delta = wallMs(new Date(to), zone) - wallMs(new Date(from), zone);
    const move = (iso: string): string => instantOfWall(wallMs(new Date(iso), zone) + delta, zone).toISOString();
    return { start: move(series.start), end: series.end === null ? null : move(series.end) };
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
