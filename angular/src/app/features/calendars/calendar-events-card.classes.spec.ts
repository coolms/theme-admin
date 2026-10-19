import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConfirmDialogService, ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { Calendar, EventInput } from 'fullcalendar';
import dayGridPlugin from 'fullcalendar/daygrid';
import classicTheme from 'fullcalendar/themes/classic';

import { CalendarEventsCardComponent } from './calendar-events-card.component';
import { CalendarLiveEventsService } from './calendar-live-events.service';
import { CalendarsApiService } from './calendars-api.service';

/**
 * The card's own classes on the events FullCalendar draws: an event's type, and whether it repeats, is tentative or
 * cancelled; a holiday's background. The card's styles hang on them (the repeat mark, the line-through, the italic,
 * the holiday text). The events the card makes are drawn by the FullCalendar the admin runs, and the classes are read
 * off the drawn page -- the field FullCalendar takes them from was renamed in 7, and a field it does not know is kept
 * as an extended prop, never drawn and never an error.
 */
describe('CalendarEventsCardComponent -- the classes of the events it draws', () => {
    let card: Record<string, (...args: unknown[]) => EventInput>;
    let host: HTMLElement;
    let fc: Calendar | null;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [CalendarEventsCardComponent],
            providers: [
                { provide: CalendarsApiService, useValue: {} },
                { provide: Dialog, useValue: { open: () => ({ closed: of(null) }) } },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'show']) },
                { provide: CalendarLiveEventsService, useValue: {} },
                {
                    provide: UserCalendarPreferencesService,
                    useValue: { timeFormat: signal('24h'), dateFormat: signal('yyyy-MM-dd'), firstDay: signal(1), tz: signal('UTC') },
                },
            ],
        });
        // The card's own calendar is not built: its events are drawn by the calendar below.
        TestBed.overrideTemplate(CalendarEventsCardComponent, '');
        const fixture = TestBed.createComponent(CalendarEventsCardComponent);
        fixture.componentRef.setInput('calendar', { id: 'cal-1', slug: 'team', tz: 'UTC' });
        card = fixture.componentInstance as unknown as typeof card;
        host = document.createElement('div');
        document.body.appendChild(host);
        fc = null;
    });

    afterEach(() => {
        fc?.destroy();
        host.remove();
    });

    /** `events` drawn in November 2026's month by the admin's FullCalendar; the drawn elements carrying `cls`. */
    async function drawn(events: EventInput[], cls: string): Promise<Element[]> {
        fc = new Calendar(host, {
            plugins: [dayGridPlugin, classicTheme],
            initialView: 'dayGridMonth',
            initialDate: '2026-11-01',
            timeZone: 'UTC',
            events,
        });
        fc.render();
        for (let i = 0; i < 50 && host.querySelectorAll('.' + cls).length === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return Array.from(host.querySelectorAll('.' + cls));
    }

    const ITEM = {
        id: 'item-1', title: 'Weekly review', start: '2026-11-09T09:00:00Z', end: '2026-11-09T10:00:00Z', allDay: false,
        color: null, type: 'event', status: 'tentative', recurrence: 'RRULE:FREQ=WEEKLY', seriesId: 'item-1',
    };

    it('an event carries its type, and that it repeats and is tentative', async () => {
        const event = card['toFcEvent'](ITEM);

        const marked = await drawn([event], 'fc-ev-recurring');

        expect(marked.length).toBe(1);
        expect(marked[0].classList).toContain('fc-ev-type-event');
        expect(marked[0].classList).toContain('fc-ev-tentative');
        expect(marked[0].textContent).toContain('Weekly review');
    });

    it('a cancelled event carries that it is cancelled', async () => {
        const event = card['toFcEvent']({ ...ITEM, status: 'cancelled', recurrence: null });

        const marked = await drawn([event], 'fc-ev-cancelled');

        expect(marked.length).toBe(1);
        expect(marked[0].classList).not.toContain('fc-ev-recurring');
    });

    it('a holiday background carries the holiday classes', async () => {
        const holiday = card['holidayToBgEvent']({ ruleId: 'r1', ruleLabel: 'Founders day', date: '2026-11-11', isWorking: false });

        const marked = await drawn([holiday], 'fc-ev-holiday-bg');

        expect(marked.length).toBe(1);
        expect(marked[0].classList).toContain('fc-ev-holiday-off');
    });

    it('the control: the same event with its classes under v6\'s `classNames` is drawn without them', async () => {
        const event = card['toFcEvent'](ITEM) as Record<string, unknown>;
        const v6 = { ...event, className: undefined, classNames: String(event['className']).split(' ') };

        // The event IS drawn (by its title), and carries none of the card's classes.
        await drawn([v6 as EventInput], 'fc-ev-recurring');
        const titled = Array.from(host.querySelectorAll('*')).filter(e => e.children.length === 0
            && (e.textContent ?? '').includes('Weekly review'));

        expect(titled.length).toBeGreaterThan(0);
        expect(host.querySelectorAll('.fc-ev-recurring, .fc-ev-type-event').length).toBe(0);
    });
});
