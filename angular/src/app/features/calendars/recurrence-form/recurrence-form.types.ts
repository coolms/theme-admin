/**
 * Internal form state for the &lt;app-recurrence-form&gt; component.
 *
 * The form maintains a normalised structured value that maps cleanly
 * onto the RFC 5545 subset the backend supports. On every change the
 * component serialises this state into a multi-line spec string
 * (RRULE + optional EXDATE lines) and emits it via `valueChange`.
 *
 * The reverse direction (parsing an arbitrary input spec back into
 * form state) is intentionally lossy. When the form receives an input
 * string we cannot confidently round-trip (e.g. BYSETPOS, multiple
 * BYDAY ordinals, RDATE lines, RDATE-with-TZID), we drop into
 * `mode: 'raw'` — a textarea fallback that submits the user's literal
 * spec unchanged. Phase 1 scope: cover Daily / Weekly+BYDAY /
 * Monthly+BYMONTHDAY / Monthly+BYDAY(+ordinal) / Yearly+BYMONTH+BYMONTHDAY
 * cleanly via the structured form; everything else uses the raw fallback.
 */

export type RecurrenceFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'RAW';

export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export type MonthlyAnchor =
    | { kind: 'dayOfMonth'; day: number }
    | { kind: 'weekdayOfMonth'; ordinal: number; weekday: WeekdayCode };

/** Three end modes, mirroring the RFC 5545 RRULE end-condition shapes. */
export type EndMode =
    | { kind: 'never' }
    | { kind: 'untilDate'; date: string }       // ISO 8601 yyyy-mm-dd (local)
    | { kind: 'afterCount'; count: number };

/**
 * The full structured form state. `mode: 'NONE'` short-circuits to "no
 * recurrence sent"; `mode: 'RAW'` short-circuits to "submit the textarea
 * verbatim". Otherwise the per-freq fields shape the spec.
 *
 * Defaults are populated based on the anchor DTSTART when the form
 * first mounts (weekly defaults to DTSTART's weekday; monthly to its
 * day-of-month; yearly to its month + day).
 */
export interface RecurrenceFormState {
    mode:        RecurrenceFreq;
    interval:    number;
    /** WEEKLY: which weekdays. Defaults to [DTSTART's weekday]. */
    byWeekdays:  WeekdayCode[];
    /** MONTHLY: day-of-month vs Nth weekday. */
    monthlyAnchor: MonthlyAnchor;
    /** YEARLY: 1-12. */
    yearMonth:   number;
    /** YEARLY: day-of-month. */
    yearDay:     number;
    end:         EndMode;
    /** EXDATE list. Each entry is an ISO 8601 UTC string. */
    excludeDates: string[];
    /** RAW mode: the literal RFC 5545 spec text. */
    rawSpec:     string;
}

export const WEEKDAYS: ReadonlyArray<{ code: WeekdayCode; short: string; long: string }> = [
    { code: 'MO', short: 'Mo', long: 'Monday' },
    { code: 'TU', short: 'Tu', long: 'Tuesday' },
    { code: 'WE', short: 'We', long: 'Wednesday' },
    { code: 'TH', short: 'Th', long: 'Thursday' },
    { code: 'FR', short: 'Fr', long: 'Friday' },
    { code: 'SA', short: 'Sa', long: 'Saturday' },
    { code: 'SU', short: 'Su', long: 'Sunday' },
];

export const MONTHS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 1,  label: 'January' },
    { value: 2,  label: 'February' },
    { value: 3,  label: 'March' },
    { value: 4,  label: 'April' },
    { value: 5,  label: 'May' },
    { value: 6,  label: 'June' },
    { value: 7,  label: 'July' },
    { value: 8,  label: 'August' },
    { value: 9,  label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
];

export const ORDINALS: ReadonlyArray<{ value: number; label: string }> = [
    { value:  1, label: 'First' },
    { value:  2, label: 'Second' },
    { value:  3, label: 'Third' },
    { value:  4, label: 'Fourth' },
    { value: -1, label: 'Last' },
];

/**
 * Build initial form state from a DTSTART instant. Used both when
 * mounting the form for a new event AND when resetting the form
 * to defaults after switching modes.
 *
 * @param dtstart ISO 8601 with offset. The component caller passes the
 *                event's start instant so the form's default weekday /
 *                day-of-month / month + day all align with the anchor.
 */
export function buildDefaultState(dtstart: Date): RecurrenceFormState {
    const weekday = isoWeekdayOf(dtstart);
    const day = dtstart.getDate();
    const month = dtstart.getMonth() + 1;
    return {
        mode:        'NONE',
        interval:    1,
        byWeekdays:  [weekday],
        monthlyAnchor: { kind: 'dayOfMonth', day },
        yearMonth:   month,
        yearDay:     day,
        end:         { kind: 'never' },
        excludeDates: [],
        rawSpec:     '',
    };
}

/**
 * Serialize structured form state into a RFC 5545 multi-line spec
 * string. The backend parser (`App\Recurrence\Application\Service\RRuleParser::parseSpec`)
 * accepts whatever we emit here unchanged.
 *
 * Returns `null` for `mode: 'NONE'` — the caller treats null as "no
 * recurrence sent".
 *
 * Note: UNTIL is emitted as a UTC `YYYYMMDDT235959Z` instant (end of
 * the chosen date in UTC). This matches the spec parser's invariant
 * that UNTIL is always UTC.
 */
export function serializeRecurrence(s: RecurrenceFormState): string | null {
    if (s.mode === 'NONE') return null;
    if (s.mode === 'RAW') return s.rawSpec.trim() || null;

    const parts: string[] = [`FREQ=${s.mode}`];
    if (s.interval > 1) parts.push(`INTERVAL=${s.interval}`);

    if (s.mode === 'WEEKLY' && s.byWeekdays.length > 0) {
        parts.push(`BYDAY=${s.byWeekdays.join(',')}`);
    }

    if (s.mode === 'MONTHLY') {
        if (s.monthlyAnchor.kind === 'dayOfMonth') {
            parts.push(`BYMONTHDAY=${s.monthlyAnchor.day}`);
        } else {
            parts.push(`BYDAY=${s.monthlyAnchor.ordinal}${s.monthlyAnchor.weekday}`);
        }
    }

    if (s.mode === 'YEARLY') {
        parts.push(`BYMONTH=${s.yearMonth}`);
        parts.push(`BYMONTHDAY=${s.yearDay}`);
    }

    if (s.end.kind === 'untilDate') {
        // Convert local-date end (yyyy-mm-dd) to a UTC instant at the
        // very end of that day so any same-day occurrences are kept.
        parts.push(`UNTIL=${untilToUtc(s.end.date)}`);
    } else if (s.end.kind === 'afterCount' && s.end.count > 0) {
        parts.push(`COUNT=${s.end.count}`);
    }

    const lines = [`RRULE:${parts.join(';')}`];

    if (s.excludeDates.length > 0) {
        // Each ISO 8601 instant -> RFC 5545 `YYYYMMDDTHHMMSSZ`.
        const dates = s.excludeDates.map(isoToRfc5545Utc).join(',');
        lines.push(`EXDATE:${dates}`);
    }

    return lines.join('\n');
}

/** ISO weekday (1=Mon … 7=Sun) -> our WeekdayCode. */
export function isoWeekdayOf(d: Date): WeekdayCode {
    const js = d.getDay(); // 0=Sun..6=Sat
    const map: WeekdayCode[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    return map[js];
}

function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/** `yyyy-mm-dd` (local) -> `YYYYMMDDT235959Z` (UTC end of day). */
function untilToUtc(localDate: string): string {
    // Treat the chosen date as a local calendar day; convert to UTC at
    // 23:59:59. The backend's UNTIL is inclusive so this captures any
    // same-day final occurrence regardless of timezone.
    const [y, m, d] = localDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    return rfc5545Utc(dt);
}

/** ISO 8601 instant -> RFC 5545 `YYYYMMDDTHHMMSSZ`. */
function isoToRfc5545Utc(iso: string): string {
    const dt = new Date(iso);
    return rfc5545Utc(dt);
}

function rfc5545Utc(dt: Date): string {
    return (
        dt.getUTCFullYear().toString() +
        pad(dt.getUTCMonth() + 1) +
        pad(dt.getUTCDate()) +
        'T' +
        pad(dt.getUTCHours()) +
        pad(dt.getUTCMinutes()) +
        pad(dt.getUTCSeconds()) +
        'Z'
    );
}

/**
 * Attempt to round-trip an incoming RFC 5545 spec into structured form
 * state. Best-effort: when the spec carries features beyond the
 * structured form's expressiveness, return null so the caller drops
 * into RAW mode and shows the textarea verbatim.
 *
 * Conservative recogniser: only succeeds for the exact shapes the
 * structured form would produce. Anything richer (BYSETPOS, multiple
 * BYDAY tokens with different ordinals, RDATE lines, etc.) flips to RAW.
 */
export function parseRecurrence(spec: string, dtstart: Date): RecurrenceFormState | null {
    const trimmed = spec.trim();
    if (!trimmed) return null;

    // Multi-line parse: separate RRULE / EXDATE.
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let rruleLine: string | null = null;
    const excludes: string[] = [];

    for (const line of lines) {
        if (line.toUpperCase().startsWith('RRULE:')) {
            if (rruleLine !== null) return null; // multiple RRULEs -> RAW
            rruleLine = line.substring(6);
        } else if (line.toUpperCase().startsWith('EXDATE:')) {
            const body = line.substring(7);
            for (const tok of body.split(',')) {
                const iso = rfc5545UtcToIso(tok.trim());
                if (!iso) return null;
                excludes.push(iso);
            }
        } else if (line.toUpperCase().startsWith('EXDATE;')) {
            // EXDATE with TZID parameter -> beyond structured form's reach.
            return null;
        } else if (line.toUpperCase().startsWith('RDATE')) {
            // RDATE inserts beyond structured form's reach.
            return null;
        } else {
            // Bare RRULE part list (no `RRULE:` prefix) on its own line.
            if (rruleLine !== null) return null;
            rruleLine = line;
        }
    }

    if (rruleLine === null) return null;

    const parts: Record<string, string> = {};
    for (const seg of rruleLine.split(';')) {
        const [k, ...rest] = seg.split('=');
        if (!k || rest.length === 0) return null;
        parts[k.toUpperCase()] = rest.join('=');
    }

    const freq = parts['FREQ']?.toUpperCase();
    if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
        return null;
    }

    // Reject any unrecognised RRULE parts so we don't silently lose data.
    const KNOWN = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL', 'COUNT', 'WKST'];
    for (const k of Object.keys(parts)) {
        if (!KNOWN.includes(k)) return null;
    }
    if (parts['WKST'] && parts['WKST'].toUpperCase() !== 'MO') return null;

    const interval = parts['INTERVAL'] ? Number.parseInt(parts['INTERVAL'], 10) : 1;
    if (!Number.isFinite(interval) || interval < 1) return null;

    const base = buildDefaultState(dtstart);
    base.mode = freq;
    base.interval = interval;
    base.excludeDates = excludes;

    // BYDAY handling — structured form supports two shapes:
    //  WEEKLY: BYDAY is a list of plain weekdays (no ordinals).
    //  MONTHLY: BYDAY is a single `{ordinal}{weekday}` token.
    if (parts['BYDAY']) {
        const tokens = parts['BYDAY'].split(',').map(t => t.trim().toUpperCase());
        if (freq === 'WEEKLY') {
            const days: WeekdayCode[] = [];
            for (const tok of tokens) {
                if (!/^(MO|TU|WE|TH|FR|SA|SU)$/.test(tok)) return null;
                days.push(tok as WeekdayCode);
            }
            base.byWeekdays = days;
        } else if (freq === 'MONTHLY') {
            if (tokens.length !== 1) return null;
            const m = tokens[0].match(/^(-?\d+)(MO|TU|WE|TH|FR|SA|SU)$/);
            if (!m) return null;
            base.monthlyAnchor = {
                kind: 'weekdayOfMonth',
                ordinal: Number.parseInt(m[1], 10),
                weekday: m[2] as WeekdayCode,
            };
        } else {
            return null;
        }
    } else if (parts['BYMONTHDAY']) {
        const day = Number.parseInt(parts['BYMONTHDAY'], 10);
        if (!Number.isFinite(day)) return null;
        if (freq === 'MONTHLY') {
            base.monthlyAnchor = { kind: 'dayOfMonth', day };
        } else if (freq === 'YEARLY') {
            base.yearDay = day;
        } else {
            return null;
        }
    }

    if (parts['BYMONTH']) {
        if (freq !== 'YEARLY') return null;
        const m = Number.parseInt(parts['BYMONTH'], 10);
        if (!Number.isFinite(m) || m < 1 || m > 12) return null;
        base.yearMonth = m;
    }

    if (parts['UNTIL']) {
        const iso = rfc5545UtcToIso(parts['UNTIL']);
        if (!iso) return null;
        base.end = { kind: 'untilDate', date: iso.substring(0, 10) };
    } else if (parts['COUNT']) {
        const c = Number.parseInt(parts['COUNT'], 10);
        if (!Number.isFinite(c) || c < 1) return null;
        base.end = { kind: 'afterCount', count: c };
    }

    return base;
}

function rfc5545UtcToIso(token: string): string | null {
    const m = token.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
