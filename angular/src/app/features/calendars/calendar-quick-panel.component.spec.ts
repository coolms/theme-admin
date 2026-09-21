import { Dialog } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ErrorHandlerService } from '@coolms/core-angular';
import { DrawerService, ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { of } from 'rxjs';

import { type CalendarItemDto } from './calendars.types';
import { CalendarsApiService } from './calendars-api.service';
import { CalendarQuickPanelComponent } from './calendar-quick-panel.component';

/**
 * The quick panel lists an event under a DAY and beside a CLOCK, and both have
 * to be the PERSON's: the profile's timezone for the day and the clock, the
 * profile's 12h/24h choice for the clock. The panel used to bucket by the
 * browser's calendar day and render the clock through the browser's locale.
 *
 * Each case also asserts the browser's own rendering DIFFERS -- without that
 * a case is vacuous on a machine already in the profile's zone, satisfied by
 * the very behaviour it exists to reject.
 */
describe('CalendarQuickPanelComponent', () => {
    /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
    const PROFILE_TZ = 'Asia/Tokyo';

    /** 16:00 UTC on Sunday 10 March 2030 is 01:00 on Monday 11 March in Tokyo. */
    const ISO = '2030-03-10T16:00:00.000Z';

    const item = (over: Partial<CalendarItemDto> = {}): CalendarItemDto => ({
        id: 'e1', calendarId: 'cal-1', type: 'event', title: 'Standup', description: null, location: null,
        start: ISO, end: null, allDay: false, recurrence: null, color: null,
        visibility: 'default', status: 'confirmed', organizerId: null, originalItemId: null,
        ...over,
    });

    let fixture: ComponentFixture<CalendarQuickPanelComponent>;
    let rows: CalendarItemDto[];

    const texts = (selector: string): string[] =>
        [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)]
            .map(el => (el.textContent ?? '').trim());

    beforeEach(() => {
        rows = [item()];
        TestBed.configureTestingModule({
            imports: [CalendarQuickPanelComponent],
            providers: [
                { provide: CalendarsApiService, useValue: { listCalendarItems: () => of(rows) } },
                { provide: Dialog, useValue: { open: () => ({ closed: of(undefined) }) } },
                { provide: ToastService, useValue: { error: () => undefined } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: DrawerService, useValue: { close: () => undefined } },
                { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
                // The profile this person actually has: 24h, and a timezone
                // that is NOT the browser's. Both halves matter -- the old
                // code took the browser's day AND the browser's locale.
                {
                    provide:  UserCalendarPreferencesService,
                    useValue: {
                        ensureLoaded: () => undefined,
                        tz:           () => PROFILE_TZ,
                        dateFormat:   () => 'yyyy-MM-dd',
                        timeFormat:   () => '24h',
                        weekStart:    () => 'monday',
                    },
                },
            ],
        });

        fixture = TestBed.createComponent(CalendarQuickPanelComponent);
        fixture.componentRef.setInput('personalCalendarSlug', 'personal-1');
    });

    /** What the panel did before: the browser's day for the bucket, the browser's locale for the clock. */
    const browserWould = () => ({
        day:   new Date(ISO).getDate(),
        clock: new Date(ISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    it('files the event under the PROFILE\'s day and prints the PROFILE\'s clock, not the browser\'s', () => {
        // Start the list on Sunday the 10th, the browser's own day for the instant.
        fixture.componentInstance.onMiniDateSelect(new Date(2030, 2, 10));
        fixture.detectChanges();

        expect(browserWould().day)
            .withContext('this spec is vacuous unless the browser puts the instant on another day')
            .not.toBe(11);
        expect(browserWould().clock)
            .withContext('this spec is vacuous unless the browser renders the clock differently')
            .not.toBe('01:00');

        const headings = texts('.day__title');
        expect(headings.length).toBe(1);
        expect(headings[0]).toContain('11');
        expect(headings[0]).not.toContain('10');
        expect(headings[0]).toMatch(/^\S+, /);   // "Mon, Mar 11" -- a far-off day, so never Today/Tomorrow

        expect(texts('.ev__time')).toEqual(['01:00']);
        expect(texts('.horizon')[0]).toContain('23'); // 10 March + 13 days
    });

    it('keeps an event that is already today for the person while still yesterday for the browser', () => {
        // Start the list on Monday the 11th, the person's day for the instant.
        // The old window began at the BROWSER's midnight of the 11th, which
        // the instant precedes -- the event vanished from the panel.
        fixture.componentInstance.onMiniDateSelect(new Date(2030, 2, 11));
        fixture.detectChanges();

        expect(browserWould().day)
            .withContext('this spec is vacuous unless the browser puts the instant on another day')
            .not.toBe(11);

        expect(texts('.day__title').length).toBe(1);
        expect(texts('.ev__title')).toEqual(['Standup']);
        expect(texts('.empty').length).toBe(0);
    });

    it('drops an event that is already past the horizon for the person', () => {
        // 14 days from Monday the 11th is Monday the 25th: 16:00 UTC on the
        // 24th is 01:00 on the 25th in Tokyo, one day out.
        rows = [item({ start: '2030-03-24T16:00:00.000Z' })];
        fixture.componentInstance.onMiniDateSelect(new Date(2030, 2, 11));
        fixture.detectChanges();

        expect(texts('.day__title').length).toBe(0);
        expect(texts('.empty').length).toBe(1);
    });
});
