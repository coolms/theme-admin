import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import { viewTitle } from './view-title.util';

/**
 * FullCalendar 7 hands the page true instants for a named timeZone -- the
 * moment a period begins in the PERSON's zone -- and the page used to read a
 * month or a day off them with the browser's own getters. Every instant here
 * is a Tokyo midnight, which is the previous day for any browser west of
 * Tokyo; each case asserts the browser would indeed put it there, so the case
 * cannot pass by accident on a machine already in that zone.
 */
describe('calendar view title', () => {
    /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
    const PROFILE_TZ = 'Asia/Tokyo';

    /** Midnight of a Tokyo calendar day, as the instant FullCalendar would hand over. */
    const tokyoMidnight = (y: number, m: number, d: number): Date =>
        new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0));

    const utc = (y: number, m: number, d: number, opts: Intl.DateTimeFormatOptions): string =>
        new Date(Date.UTC(y, m - 1, d)).toLocaleString(undefined, { ...opts, timeZone: 'UTC' });

    let dtf: DateTimeFormatService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [{
                provide:  UserCalendarPreferencesService,
                useValue: {
                    ensureLoaded: () => undefined,
                    tz:           () => PROFILE_TZ,
                    dateFormat:   () => 'yyyy-MM-dd',
                    timeFormat:   () => '24h',
                },
            }],
        });
        dtf = TestBed.inject(DateTimeFormatService);
    });

    it('titles the month view with the PROFILE\'s month, not the browser\'s', () => {
        // Tokyo's 1 September begins on 31 August, 15:00 UTC.
        const start = tokyoMidnight(2026, 9, 1);

        expect(start.getMonth())
            .withContext('this spec is vacuous unless the browser puts the instant in the previous month')
            .not.toBe(8);

        const title = viewTitle('dayGridMonth', start, tokyoMidnight(2026, 10, 1), dtf);
        expect(title).toBe(utc(2026, 9, 1, { month: 'long', year: 'numeric' }));
        expect(title).not.toBe(utc(2026, 8, 1, { month: 'long', year: 'numeric' }));
    });

    it('titles the day view with the PROFILE\'s day', () => {
        // Tokyo's Tuesday 15 September begins on Monday the 14th, 15:00 UTC.
        const start = tokyoMidnight(2026, 9, 15);

        expect(start.getDate())
            .withContext('this spec is vacuous unless the browser puts the instant on the previous day')
            .not.toBe(15);

        const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        const title = viewTitle('timeGridDay', start, tokyoMidnight(2026, 9, 16), dtf);
        expect(title).toBe(utc(2026, 9, 15, opts));
        expect(title).not.toBe(utc(2026, 9, 14, opts));
    });

    it('titles a week inside one month with its first and last day, the exclusive end stepped back', () => {
        const title = viewTitle('timeGridWeek', tokyoMidnight(2026, 9, 7), tokyoMidnight(2026, 9, 14), dtf);
        expect(title).toBe(`${utc(2026, 9, 7, { month: 'long' })} 7 – 13, 2026`);
    });

    it('titles a week that crosses a month with both ends spelled out', () => {
        const title = viewTitle('timeGridWeek', tokyoMidnight(2026, 9, 28), tokyoMidnight(2026, 10, 5), dtf);
        const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
        expect(title).toBe(`${utc(2026, 9, 28, fmt)} – ${utc(2026, 10, 4, fmt)}`);
    });
});
