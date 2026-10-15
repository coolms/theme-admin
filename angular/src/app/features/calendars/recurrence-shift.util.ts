import { instantOfWall, wallMs } from './series-shift.util';

/**
 * A series' recurrence, moved with its start. When all events of a series move by a difference, every date the rule
 * names moves by it too: UNTIL, the skipped dates (EXDATE) and the added ones (RDATE). A skipped 09:00 occurrence of a
 * series moved to 10:00 stays skipped at 10:00 instead of coming back. A rule that picks days moves its days:
 * BYDAY=MO moved by a day becomes BYDAY=TU.
 *
 * A move is applied only when the moved rule gives exactly the old occurrences, each moved by the difference. When no
 * rule can say that, the move is refused with the reason, and nothing changes. Examples: "the 2nd Monday" moved by a
 * day, "the 30th of each month" moved across a month's end, or a day of the month moved into another month.
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export type RecurrenceShift =
    | { readonly recurrence: string }
    | { readonly refused: string };

/**
 * `spec` (RRULE plus any RDATE and EXDATE lines) moved by `delta`, a difference of milliseconds on the wall clock of
 * `zone`, for a series starting at `seriesStart`. An all-day series is passed with zone `UTC`, which it repeats on, and
 * a whole number of days.
 */
export function shiftRecurrence(spec: string, seriesStart: string, delta: number, zone: string): RecurrenceShift {
    const startWall = wallMs(new Date(seriesStart), zone);
    const days = Math.floor((startWall + delta) / DAY_MS) - Math.floor(startWall / DAY_MS);
    const moveInstant = (ms: number): number => instantOfWall(wallMs(new Date(ms), zone) + delta, zone).getTime();

    const out: string[] = [];
    for (const line of spec.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '')) {
        const colon = line.indexOf(':');
        const head = (colon < 0 ? '' : line.slice(0, colon)).split(';');
        const name = head[0].toUpperCase();
        const value = line.slice(colon + 1);
        if (name === 'RRULE') {
            const rule = shiftRule(value, startWall, days, moveInstant);
            if ('refused' in rule) {
                return rule;
            }
            out.push('RRULE:' + rule.rule);
        } else if (name === 'EXDATE' || name === 'RDATE') {
            const tzid = head.slice(1).find(p => p.toUpperCase().startsWith('TZID='))?.slice(5) ?? null;
            const tokens = value.split(',').map(t => shiftToken(t.trim(), tzid, days, moveInstant));
            if (tokens.includes(null)) {
                return { refused: `The series' ${name} line could not be read, so its dates cannot be moved with it.` };
            }
            out.push(line.slice(0, colon + 1) + tokens.join(','));
        } else {
            return { refused: 'The series\' recurrence has a line this editor does not move.' };
        }
    }
    return { recurrence: out.join('\r\n') };
}

/** The RRULE part list moved; `days` is how many days the series' start moved on its wall clock. */
function shiftRule(
    value: string,
    startWall: number,
    days: number,
    moveInstant: (ms: number) => number,
): { rule: string } | { refused: string } {
    const parts = value.split(';').filter(p => p !== '').map(p => {
        const eq = p.indexOf('=');
        return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)] as [string, string];
    });
    const get = (key: string): string | undefined => parts.find(([k]) => k === key)?.[1];
    const set = (key: string, v: string): void => {
        const at = parts.findIndex(([k]) => k === key);
        if (at < 0) {
            parts.push([key, v]);
        } else {
            parts[at] = [key, v];
        }
    };

    const until = get('UNTIL');
    if (until !== undefined) {
        const moved = shiftToken(until, null, days, moveInstant);
        if (moved === null) {
            return { refused: 'The series\' end date could not be read, so it cannot be moved with it.' };
        }
        set('UNTIL', moved);
    }
    if (days === 0) {
        return { rule: parts.map(([k, v]) => `${k}=${v}`).join(';') };
    }

    const freq = (get('FREQ') ?? '').toUpperCase();
    const byDay = get('BYDAY');
    const byMonthDay = get('BYMONTHDAY');
    const byMonth = get('BYMONTH');
    const refused = (what: string): { refused: string } => ({
        refused: `This series repeats ${what}, which cannot be moved by a day and still give the same events. `
            + 'Move its time of day only, or change its repeat in the series\' editor.',
    });

    if (get('BYSETPOS') !== undefined) {
        return refused('on a numbered one of a set of days');
    }
    if (byDay !== undefined) {
        const tokens = byDay.split(',').map(t => t.trim().toUpperCase());
        if (tokens.some(t => !(WEEKDAYS as readonly string[]).includes(t))) {
            return refused('on a numbered weekday of the month or year');
        }
        if (freq !== 'DAILY' && freq !== 'WEEKLY') {
            return refused('on weekdays within each month or year');
        }
        set('BYDAY', tokens.map(t => rotate(t, days)).join(','));
        // Weeks counted from WKST decide which week an INTERVAL>1 rule repeats in: they turn with the weekdays.
        if (freq === 'WEEKLY' && Number(get('INTERVAL') ?? '1') > 1) {
            set('WKST', rotate((get('WKST') ?? 'MO').toUpperCase(), days));
        }
    }
    if (byMonth !== undefined && (freq === 'DAILY' || freq === 'WEEKLY')) {
        return refused('only in some months');
    }
    if (byMonthDay !== undefined) {
        const moved = byMonthDay.split(',').map(t => shiftMonthDay(Number(t.trim()), days));
        if (moved.includes(null)) {
            return refused('on a day of the month that a move by a day would carry into another month');
        }
        set('BYMONTHDAY', moved.join(','));
    }
    if (freq === 'MONTHLY' || freq === 'YEARLY') {
        const from = new Date(startWall);
        const to = new Date(startWall + days * DAY_MS);
        if (byMonthDay === undefined && shiftMonthDay(from.getUTCDate(), days) === null) {
            return refused('on the day of the month it started, which a move by a day would carry into another month');
        }
        if (freq === 'YEARLY' && byMonth === undefined && from.getUTCMonth() !== to.getUTCMonth()) {
            return refused('in the month it started, which this move leaves');
        }
    }
    return { rule: parts.map(([k, v]) => `${k}=${v}`).join(';') };
}

/** A weekday code turned by `days`. */
function rotate(weekday: string, days: number): string {
    const at = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
    return WEEKDAYS[(((at + days) % 7) + 7) % 7];
}

/**
 * A BYMONTHDAY value moved by `days`, or null when some month would not have the moved day where the old one was: a
 * day counted from the start stays within 1..28, one counted from the end within -28..-1, before and after.
 */
function shiftMonthDay(day: number, days: number): number | null {
    const moved = day + days;
    if (day >= 1 && day <= 28 && moved >= 1 && moved <= 28) {
        return moved;
    }
    if (day <= -1 && day >= -28 && moved <= -1 && moved >= -28) {
        return moved;
    }
    return null;
}

/**
 * One RFC 5545 date token moved: `YYYYMMDDTHHMMSSZ` (an instant), `YYYYMMDDTHHMMSS` (on the wall clock of `tzid`, or
 * read as UTC without one, as the server reads it), or `YYYYMMDD` (a date, moved by whole days). Each keeps its form.
 * Null for a token that is none of these.
 */
function shiftToken(token: string, tzid: string | null, days: number, moveInstant: (ms: number) => number): string | null {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(token);
    if (m === null) {
        return null;
    }
    const [, y, mo, d, h, mi, s, z] = m;
    const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
    if (h === undefined) {
        return format(wall + days * DAY_MS).slice(0, 8);
    }
    if (z === 'Z' || tzid === null) {
        return format(moveInstant(wall)) + z;
    }
    const instant = instantOfWall(wall, tzid).getTime();
    return format(wallMs(new Date(moveInstant(instant)), tzid));
}

/** `YYYYMMDDTHHMMSS` of a millisecond count read as UTC. */
function format(ms: number): string {
    return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '');
}
