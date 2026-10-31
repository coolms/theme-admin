import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { NaviGraphService } from '@coolms/core-angular';
import { ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { CalendarsApiService } from '../calendars/calendars-api.service';
import { type CalendarDto } from '../calendars/calendars.types';
import { ProfileCalendarTabComponent } from './profile-calendar-tab.component';

/**
 * The profile's Calendar tab reads the calendar list for its default-calendar picker. A failed read is held for the
 * error banner in place of the picker, never a toast; the banner's Retry reads the list again, and a read that then
 * succeeds clears the failure. The tab is built directly, not rendered.
 */
describe('ProfileCalendarTabComponent -- a failed read of the calendar list', () => {
    let answers: Array<() => Observable<CalendarDto[]>>;
    let asked: number;
    let toasts: string[];

    function build(): ProfileCalendarTabComponent {
        asked = 0;
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: CalendarsApiService,
                    useValue: { listCalendars: () => answers[Math.min(asked++, answers.length - 1)]() },
                },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: UserCalendarPreferencesService, useValue: { defaultCalendarSlug: signal('') } },
                { provide: NaviGraphService, useValue: { adminNav: signal([]) } },
            ],
        });

        return TestBed.runInInjectionContext(() => new ProfileCalendarTabComponent());
    }

    it('holds the failure for the banner, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        answers = [() => throwError(() => failure), () => of([{ id: 'c1', slug: 'team' } as CalendarDto])];
        const tab = build();

        tab.loadCalendars();

        expect(asked).withContext('the load asked the API').toBe(1);
        expect(tab.calendarsFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(tab.loadingCalendars()).toBeFalse();
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        tab.loadCalendars();

        expect(asked).withContext('Retry asked the API again').toBe(2);
        expect(tab.calendarsFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(tab.calendars().map(c => c.slug)).toEqual(['team']);
        expect(toasts).toEqual([]);
    });
});
