/**
 * Smart recurrence presets derived from a DTSTART instant — the
 * Google-Calendar pattern. The 6 common shapes appear as ready-made
 * options in the event editor's `Repeats` dropdown so 80% of recurrences
 * pick in one click without opening the full structured form.
 *
 * Anything outside the preset list (multi-weekday Weekly, Nth-weekday
 * Monthly, UNTIL/COUNT bounds, EXDATEs, raw RFC 5545) opens the
 * Recurrence sub-dialog and shows a one-line summary in the main
 * editor under the dropdown.
 */

import { WEEKDAYS, type WeekdayCode } from './recurrence-form.types';

export type RecurrencePresetKey =
    | 'none'
    | 'daily'
    | 'weekly'      // BYDAY = single weekday matching dtstart
    | 'monthly'     // BYMONTHDAY = dtstart day-of-month
    | 'yearly'      // BYMONTH + BYMONTHDAY matching dtstart
    | 'weekdays'    // BYDAY = MO,TU,WE,TH,FR
    | 'custom';     // anything else — opens sub-dialog

/** Display labels for the dropdown. Some entries interpolate dtstart values. */
export interface RecurrencePresetOption {
    key:   RecurrencePresetKey;
    label: string;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** Build the dropdown options for a given DTSTART. */
export function buildPresetOptions(dtstart: Date): RecurrencePresetOption[] {
    const weekdayName = dtstartWeekdayName(dtstart);
    const dayOrdinal  = ordinalSuffix(dtstart.getDate());
    const monthDay    = `${MONTH_NAMES[dtstart.getMonth()]} ${dtstart.getDate()}`;
    return [
        { key: 'none',     label: "Doesn't repeat" },
        { key: 'daily',    label: 'Daily' },
        { key: 'weekly',   label: `Weekly on ${weekdayName}` },
        { key: 'monthly',  label: `Monthly on the ${dayOrdinal}` },
        { key: 'yearly',   label: `Annually on ${monthDay}` },
        { key: 'weekdays', label: 'Every weekday (Mon–Fri)' },
        { key: 'custom',   label: 'Custom…' },
    ];
}

/**
 * Build the RFC 5545 spec string for a preset key. Returns null for
 * `none` (no recurrence sent). The `custom` key never reaches this —
 * the caller opens the sub-dialog instead.
 */
export function buildPresetSpec(key: RecurrencePresetKey, dtstart: Date): string | null {
    switch (key) {
        case 'none':
            return null;
        case 'daily':
            return 'RRULE:FREQ=DAILY';
        case 'weekly':
            return `RRULE:FREQ=WEEKLY;BYDAY=${weekdayCodeOf(dtstart)}`;
        case 'monthly':
            return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dtstart.getDate()}`;
        case 'yearly':
            return `RRULE:FREQ=YEARLY;BYMONTH=${dtstart.getMonth() + 1};BYMONTHDAY=${dtstart.getDate()}`;
        case 'weekdays':
            return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
        case 'custom':
            // Caller never invokes this; defensive null.
            return null;
    }
}

/**
 * Reverse direction — given an existing spec string and the event's
 * DTSTART, detect which preset it matches. Anything outside the preset
 * shapes falls through to `custom`.
 *
 * Conservative recogniser: an exact part-by-part match against the
 * shape `buildPresetSpec` produces. Extra parts (EXDATE, INTERVAL > 1,
 * UNTIL, COUNT) bump straight to `custom` so the user sees a real
 * summary line rather than a misleading preset label.
 */
export function detectPreset(spec: string | null, dtstart: Date): RecurrencePresetKey {
    if (!spec || spec.trim() === '') return 'none';

    // Multi-line specs (EXDATE / RDATE present) are always custom.
    const lines = spec.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length !== 1) return 'custom';

    let body = lines[0];
    if (body.toUpperCase().startsWith('RRULE:')) body = body.substring(6);

    const parts: Record<string, string> = {};
    for (const seg of body.split(';')) {
        const eq = seg.indexOf('=');
        if (eq < 0) return 'custom';
        parts[seg.substring(0, eq).toUpperCase()] = seg.substring(eq + 1);
    }
    const keys = Object.keys(parts);

    // Any UNTIL / COUNT / INTERVAL / WKST / BYSETPOS / BYMONTH bumps to custom.
    if (parts['INTERVAL'] && parts['INTERVAL'] !== '1') return 'custom';
    if (parts['UNTIL'] || parts['COUNT'] || parts['BYSETPOS']) return 'custom';
    if (parts['WKST'] && parts['WKST'].toUpperCase() !== 'MO') return 'custom';

    const freq = parts['FREQ']?.toUpperCase();
    if (!freq) return 'custom';

    if (freq === 'DAILY') {
        // Only FREQ=DAILY allowed; INTERVAL must equal 1 (handled above).
        return onlyKeys(keys, ['FREQ', 'INTERVAL']) ? 'daily' : 'custom';
    }

    if (freq === 'WEEKLY') {
        if (!onlyKeys(keys, ['FREQ', 'INTERVAL', 'BYDAY'])) return 'custom';
        const byday = parts['BYDAY']?.toUpperCase() ?? '';
        if (byday === 'MO,TU,WE,TH,FR') return 'weekdays';
        if (byday === weekdayCodeOf(dtstart)) return 'weekly';
        return 'custom';
    }

    if (freq === 'MONTHLY') {
        if (!onlyKeys(keys, ['FREQ', 'INTERVAL', 'BYMONTHDAY'])) return 'custom';
        const md = parts['BYMONTHDAY'];
        if (md && Number.parseInt(md, 10) === dtstart.getDate()) return 'monthly';
        return 'custom';
    }

    if (freq === 'YEARLY') {
        if (!onlyKeys(keys, ['FREQ', 'INTERVAL', 'BYMONTH', 'BYMONTHDAY'])) return 'custom';
        const m = parts['BYMONTH'];
        const d = parts['BYMONTHDAY'];
        if (
            m && d
            && Number.parseInt(m, 10) === dtstart.getMonth() + 1
            && Number.parseInt(d, 10) === dtstart.getDate()
        ) return 'yearly';
        return 'custom';
    }

    return 'custom';
}

/**
 * One-line summary of an arbitrary spec — shown under the dropdown
 * when the current value lives outside the preset shapes. Best-effort
 * parse of the most common bits (FREQ, BYDAY, INTERVAL, UNTIL/COUNT,
 * EXDATE count); falls back to the spec string itself when we can't
 * decode it.
 */
export function summariseRecurrence(spec: string | null): string {
    if (!spec || spec.trim() === '') return "Doesn't repeat";

    const lines = spec.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rruleLine = lines.find(l => l.toUpperCase().startsWith('RRULE:'))?.substring(6)
        ?? (lines.length === 1 ? lines[0] : null);
    const exdateCount = lines.filter(l => l.toUpperCase().startsWith('EXDATE')).length;
    const rdateCount  = lines.filter(l => l.toUpperCase().startsWith('RDATE')).length;

    if (!rruleLine) return spec;

    const parts: Record<string, string> = {};
    for (const seg of rruleLine.split(';')) {
        const eq = seg.indexOf('=');
        if (eq < 0) continue;
        parts[seg.substring(0, eq).toUpperCase()] = seg.substring(eq + 1);
    }

    const freq = parts['FREQ']?.toUpperCase();
    if (!freq) return spec;
    const interval = parts['INTERVAL'] ? Number.parseInt(parts['INTERVAL'], 10) : 1;

    let head: string;
    switch (freq) {
        case 'DAILY':
            head = interval === 1 ? 'Daily' : `Every ${interval} days`;
            break;
        case 'WEEKLY': {
            const byday = parts['BYDAY']?.toUpperCase();
            const days  = byday ? humaniseWeekdays(byday) : null;
            const base  = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
            head = days ? `${base} on ${days}` : base;
            break;
        }
        case 'MONTHLY':
            head = interval === 1 ? 'Monthly' : `Every ${interval} months`;
            if (parts['BYMONTHDAY']) head += ` on the ${ordinalSuffix(Number.parseInt(parts['BYMONTHDAY'], 10))}`;
            else if (parts['BYDAY']) head += ` on ${humaniseByDayOrdinal(parts['BYDAY'])}`;
            break;
        case 'YEARLY':
            head = interval === 1 ? 'Annually' : `Every ${interval} years`;
            break;
        default:
            return spec;
    }

    const tail: string[] = [];
    if (parts['COUNT']) tail.push(`${parts['COUNT']} times`);
    else if (parts['UNTIL']) tail.push(`until ${formatUntilDate(parts['UNTIL'])}`);
    if (exdateCount > 0 || rdateCount > 0) {
        const ex = exdateCount > 0 ? `${exdateCount} exclusion${exdateCount > 1 ? 's' : ''}` : '';
        const rd = rdateCount > 0 ? `${rdateCount} extra date${rdateCount > 1 ? 's' : ''}` : '';
        tail.push([ex, rd].filter(Boolean).join(', '));
    }
    return tail.length > 0 ? `${head}; ${tail.join(', ')}` : head;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function dtstartWeekdayName(d: Date): string {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[d.getDay()];
}

function weekdayCodeOf(d: Date): WeekdayCode {
    const map: WeekdayCode[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    return map[d.getDay()];
}

function ordinalSuffix(n: number): string {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1:  return `${n}st`;
        case 2:  return `${n}nd`;
        case 3:  return `${n}rd`;
        default: return `${n}th`;
    }
}

function onlyKeys(present: string[], allowed: string[]): boolean {
    return present.every(k => allowed.includes(k));
}

function humaniseWeekdays(byday: string): string | null {
    const tokens = byday.split(',').map(t => t.trim().toUpperCase());
    if (tokens.length === 5
        && tokens.includes('MO') && tokens.includes('TU') && tokens.includes('WE')
        && tokens.includes('TH') && tokens.includes('FR')
        && !tokens.includes('SA') && !tokens.includes('SU')) {
        return 'weekdays';
    }
    if (tokens.length === 2 && tokens.includes('SA') && tokens.includes('SU')) {
        return 'weekends';
    }
    const labels = tokens
        .map(t => WEEKDAYS.find(w => w.code === t)?.short)
        .filter((s): s is string => Boolean(s));
    return labels.length > 0 ? labels.join(', ') : null;
}

function humaniseByDayOrdinal(byday: string): string {
    const m = byday.match(/^(-?\d+)(MO|TU|WE|TH|FR|SA|SU)$/);
    if (!m) return byday;
    const ord = Number.parseInt(m[1], 10);
    const wd  = WEEKDAYS.find(w => w.code === m[2])?.long ?? m[2];
    const ordLabel = ord === -1
        ? 'last'
        : ordinalSuffix(ord);
    return `the ${ordLabel} ${wd}`;
}

function formatUntilDate(token: string): string {
    const m = token.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return token;
    return `${m[1]}-${m[2]}-${m[3]}`;
}
