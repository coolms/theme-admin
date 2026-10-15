import { HttpErrorResponse } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ConfirmDialogService, ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';

import { CalendarEventsCardComponent } from './calendar-events-card.component';
import { CalendarLiveEventsService } from './calendar-live-events.service';
import { CalendarsApiService } from './calendars-api.service';

/**
 * Which row each write of the calendar card addresses, and which version it names -- read off the event as it was
 * drawn from its list row. A change or a delete of what was clicked names that row's own version; an action on the
 * series (an exception, a skip, a split, a delete of this and the following, a delete of all) addresses the series'
 * base at the slot the occurrence stands for, and names the series' version. On an edited occurrence these are two
 * different rows: its exception (drawn with the exception's id) and the series it belongs to.
 */
describe('CalendarEventsCardComponent -- each write names the row and the version it was drawn from', () => {
    const EDITED = {
        id: 'exception-1',
        title: 'Standup (moved)',
        allDay: false,
        start: new Date('2026-10-20T08:30:00.000Z'),
        end: new Date('2026-10-20T09:00:00.000Z'),
        startStr: '2026-10-20T08:30:00.000Z',
        endStr: '2026-10-20T09:00:00.000Z',
        color: '',
        extendedProps: {
            kind: 'item',
            originalItemId: 'exception-1',
            seriesId: 'series-1',
            parentItemId: 'base-1',
            status: 'confirmed',
            type: 'event',
            version: 9,
            seriesVersion: 3,
            recurrenceInstant: '2026-10-20T07:00:00+00:00',
        },
    };
    // A plain occurrence a non-working-day shift moved off its slot: the slot is still what it stands for.
    const SHIFTED = {
        ...EDITED,
        id: 'base-1',
        start: new Date('2026-10-21T07:00:00.000Z'),
        end: new Date('2026-10-21T07:30:00.000Z'),
        extendedProps: {
            ...EDITED.extendedProps,
            originalItemId: 'base-1',
            parentItemId: null,
            version: 3,
            recurrenceInstant: '2026-10-20T07:00:00+00:00',
        },
    };

    let api: jasmine.SpyObj<CalendarsApiService>;
    let toast: jasmine.SpyObj<ToastService>;
    let scope: 'this' | 'following' | 'all';
    /** What the person answers when asked to confirm. */
    let confirmAnswer: boolean;
    let card: Record<string, (...args: unknown[]) => unknown>;

    beforeEach(() => {
        api = jasmine.createSpyObj<CalendarsApiService>('CalendarsApiService', [
            'updateCalendarItem',
            'deleteCalendarItem',
            'createCalendarItemException',
            'skipCalendarItemOccurrence',
            'splitCalendarItem',
            'deleteFollowingCalendarItem',
            'getCalendarItem',
            'listCalendarItems',
        ]);
        for (const m of Object.keys(api) as (keyof CalendarsApiService)[]) {
            (api[m] as jasmine.Spy).and.returnValue(of({}));
        }
        toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'show']);
        scope = 'this';
        confirmAnswer = true;
        TestBed.configureTestingModule({
            imports: [CalendarEventsCardComponent],
            providers: [
                { provide: CalendarsApiService, useValue: api },
                { provide: Dialog, useValue: { open: () => ({ closed: of(scope) }) } },
                { provide: ConfirmDialogService, useValue: { open: () => of(confirmAnswer) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                { provide: ToastService, useValue: toast },
                { provide: CalendarLiveEventsService, useValue: {} },
                {
                    provide: UserCalendarPreferencesService,
                    useValue: { timeFormat: signal('24h'), dateFormat: signal('iso'), firstDay: signal(1), tz: signal('UTC') },
                },
            ],
        });
        // Nothing is drawn: the writes are what is measured, not FullCalendar.
        TestBed.overrideTemplate(CalendarEventsCardComponent, '');
        const fixture = TestBed.createComponent(CalendarEventsCardComponent);
        fixture.componentRef.setInput('calendar', { id: 'cal-1', slug: 'team', tz: 'UTC' });
        fixture.componentRef.setInput('canEdit', true);
        card = fixture.componentInstance as unknown as typeof card;
    });

    /** Right-click on `event`, then pick `action` from the menu; the scope prompt answers `scope`. */
    async function fromTheMenu(event: object, action: () => unknown): Promise<void> {
        card['openCmenu']({ clientX: 1, clientY: 1 } as MouseEvent, event);
        action();
        await Promise.resolve();
        await Promise.resolve();
    }

    it('a status set on an edited occurrence changes its exception, naming the exception\'s version', async () => {
        await fromTheMenu(EDITED, () => card['onCmenuSetStatus']('tentative'));

        expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('exception-1', { status: 'tentative' }, 9);
    });

    it('"only this" delete of an edited occurrence skips the series\' slot it replaced, at the series\' version', async () => {
        scope = 'this';
        await fromTheMenu(EDITED, () => card['onCmenuDelete']());

        expect(api.skipCalendarItemOccurrence).toHaveBeenCalledOnceWith('base-1', '2026-10-20T07:00:00+00:00', 3);
    });

    it('"this and following" delete of an edited occurrence truncates the series at that slot', async () => {
        scope = 'following';
        await fromTheMenu(EDITED, () => card['onCmenuDelete']());

        expect(api.deleteFollowingCalendarItem).toHaveBeenCalledOnceWith('base-1', '2026-10-20T07:00:00+00:00', 3);
    });

    it('"all events" delete from an edited occurrence deletes the series, not only its exception', async () => {
        scope = 'all';
        await fromTheMenu(EDITED, () => card['onCmenuDelete']());

        expect(api.deleteCalendarItem).toHaveBeenCalledOnceWith('base-1', 3);
    });

    it('a shifted plain occurrence is skipped at its rule slot, not at the day it was shifted to', async () => {
        scope = 'this';
        await fromTheMenu(SHIFTED, () => card['onCmenuDelete']());

        expect(api.skipCalendarItemOccurrence).toHaveBeenCalledOnceWith('base-1', '2026-10-20T07:00:00+00:00', 3);
    });

    it('dragging an edited occurrence ("only this") re-edits the series\' slot, at the series\' version', async () => {
        scope = 'this';
        const moved = { ...EDITED, start: new Date('2026-10-20T10:00:00.000Z'), end: new Date('2026-10-20T10:30:00.000Z') };

        card['onEventDrop']({ event: moved, oldEvent: EDITED, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.createCalendarItemException).toHaveBeenCalledOnceWith('base-1', {
            recurrenceInstant: '2026-10-20T07:00:00+00:00',
            newStart: '2026-10-20T10:00:00.000Z',
            newEnd: '2026-10-20T10:30:00.000Z',
        }, 3);
    });

    it('dragging an edited occurrence ("this and following") splits the series at that slot', async () => {
        scope = 'following';
        const moved = { ...EDITED, start: new Date('2026-10-20T10:00:00.000Z'), end: new Date('2026-10-20T10:30:00.000Z') };

        card['onEventDrop']({ event: moved, oldEvent: EDITED, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.splitCalendarItem).toHaveBeenCalledOnceWith('base-1', {
            recurrenceInstant: '2026-10-20T07:00:00+00:00',
            newStart: '2026-10-20T10:00:00.000Z',
            newEnd: '2026-10-20T10:30:00.000Z',
        }, 3);
    });

    /**
     * The series as its own read answers it: daily from 16 Oct, 07:00-07:30 UTC, ten times, at version 7 (newer than
     * the row's 3), with no occurrence edited on its own.
     */
    const SERIES = {
        id: 'base-1', title: 'Daily', start: '2026-10-16T07:00:00.000Z', end: '2026-10-16T07:30:00.000Z', allDay: false,
        version: 7, seriesVersion: 7, effectiveTimeZone: 'UTC', recurrence: 'RRULE:FREQ=DAILY;COUNT=10',
        exceptionCount: 0,
    };
    // The 5th occurrence of that daily series, a plain one.
    const FIFTH = {
        ...SHIFTED,
        start: new Date('2026-10-20T07:00:00.000Z'),
        end: new Date('2026-10-20T07:30:00.000Z'),
        extendedProps: { ...SHIFTED.extendedProps, recurrenceInstant: '2026-10-20T07:00:00+00:00' },
    };

    it('dragging the 5th occurrence of a daily series by two days, "all events", moves the series -- the 1st included -- by two days', async () => {
        scope = 'all';
        api.getCalendarItem.and.returnValue(of(SERIES) as never);
        const moved = { ...FIFTH, start: new Date('2026-10-22T07:00:00.000Z'), end: new Date('2026-10-22T07:30:00.000Z') };

        card['onEventDrop']({ event: moved, oldEvent: FIFTH, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.getCalendarItem).toHaveBeenCalledOnceWith('base-1');
        // The series' own read says it holds no exception: the calendar's rows are never read for it.
        expect(api.listCalendarItems).not.toHaveBeenCalled();
        expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('base-1', {
            start: '2026-10-18T07:00:00.000Z',
            end: '2026-10-18T07:30:00.000Z',
            allDay: false,
            recurrence: 'RRULE:FREQ=DAILY;COUNT=10',
        }, 7);
    });

    it('a skipped date moves with the series in the same write: a skipped 07:00 occurrence moved to 08:00 stays skipped', async () => {
        scope = 'all';
        api.getCalendarItem.and.returnValue(of({ ...SERIES, recurrence: 'RRULE:FREQ=DAILY;COUNT=10\r\nEXDATE:20261018T070000Z' }) as never);
        const later = { ...FIFTH, start: new Date('2026-10-20T08:00:00.000Z'), end: new Date('2026-10-20T08:30:00.000Z') };

        card['onEventDrop']({ event: later, oldEvent: FIFTH, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('base-1', {
            start: '2026-10-16T08:00:00.000Z',
            end: '2026-10-16T08:30:00.000Z',
            allDay: false,
            recurrence: 'RRULE:FREQ=DAILY;COUNT=10\r\nEXDATE:20261018T080000Z',
        }, 7);
    });

    it('a series whose rule no move by that difference can keep is not moved: nothing is written, the reason is said', async () => {
        scope = 'all';
        api.getCalendarItem.and.returnValue(of({ ...SERIES, recurrence: 'RRULE:FREQ=MONTHLY;BYDAY=3FR' }) as never);
        const revert = jasmine.createSpy('revert');
        const nextDay = { ...FIFTH, start: new Date('2026-10-21T07:00:00.000Z'), end: new Date('2026-10-21T07:30:00.000Z') };

        card['onEventDrop']({ event: nextDay, oldEvent: FIFTH, revert });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.updateCalendarItem).not.toHaveBeenCalled();
        expect(revert).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledOnceWith(jasmine.stringContaining('numbered weekday'), 'Nothing was changed');
    });

    it('a series with occurrences edited one by one is moved, from one of them too: the server moves them with it', async () => {
        scope = 'all';
        api.getCalendarItem.and.returnValue(of({ ...SERIES, exceptionCount: 2 }) as never);
        // The edited occurrence sits at 08:30 on the 20th; dragged to 10:00 the same day.
        const edited = { ...EDITED, start: new Date('2026-10-20T10:00:00.000Z'), end: new Date('2026-10-20T10:30:00.000Z') };

        card['onEventDrop']({ event: edited, oldEvent: EDITED, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('base-1', jasmine.objectContaining({
            start: '2026-10-16T08:30:00.000Z',
        }), 7);
        expect(api.listCalendarItems).not.toHaveBeenCalled();
    });

    describe('a move the server refuses because it would leave edited occurrences behind (409)', () => {
        const LEAVES = new HttpErrorResponse({
            status: 409,
            error: {
                type: '/errors/series-change-leaves-occurrences',
                exceptions: [{ id: 'exception-1', start: '2026-10-20T22:30:00+00:00', title: 'Standup (moved)' }],
                skipDates: [],
            },
        });
        const nextDay = { ...FIFTH, start: new Date('2026-10-21T07:00:00.000Z'), end: new Date('2026-10-21T07:30:00.000Z') };

        it('asks, naming them; confirmed, sends the same change again with discardExceptions, at the same version', async () => {
            scope = 'all';
            // Shown in Moscow, dates written day first: the 409's 22:30 UTC on the 20th is the 21st there.
            const prefs = TestBed.inject(UserCalendarPreferencesService) as unknown as {
                tz: WritableSignal<string>; dateFormat: WritableSignal<string>;
            };
            prefs.tz.set('Europe/Moscow');
            prefs.dateFormat.set('dd.MM.yyyy');
            api.getCalendarItem.and.returnValue(of(SERIES) as never);
            api.updateCalendarItem.and.returnValues(throwError(() => LEAVES) as never, of(SERIES) as never);
            const confirm = TestBed.inject(ConfirmDialogService);
            const asked = spyOn(confirm, 'open').and.callThrough();

            card['onEventDrop']({ event: nextDay, oldEvent: FIFTH, revert: jasmine.createSpy('revert') });
            await Promise.resolve();
            await Promise.resolve();

            expect(asked.calls.mostRecent().args[0].message).toContain('"Standup (moved)" on 21.10.2026');
            const [first, second] = api.updateCalendarItem.calls.allArgs();
            expect(second).toEqual(['base-1', { ...(first[1] as object), discardExceptions: true }, 7]);
            expect(toast.success).toHaveBeenCalledOnceWith('All events moved');
        });

        it('declined: nothing more is sent, the drag is reverted, and it says the series was left as it is', async () => {
            scope = 'all';
            confirmAnswer = false;
            api.getCalendarItem.and.returnValue(of(SERIES) as never);
            api.updateCalendarItem.and.returnValue(throwError(() => LEAVES) as never);
            const revert = jasmine.createSpy('revert');

            card['onEventDrop']({ event: nextDay, oldEvent: FIFTH, revert });
            await Promise.resolve();
            await Promise.resolve();

            expect(api.updateCalendarItem).toHaveBeenCalledTimes(1);
            expect(revert).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledOnceWith('The series was left as it is.', 'Nothing was changed');
        });
    });

    it('resizing an occurrence, "all events", makes every occurrence as much longer', async () => {
        scope = 'all';
        api.getCalendarItem.and.returnValue(of(SERIES) as never);
        const longer = { ...FIFTH, end: new Date('2026-10-20T08:00:00.000Z') };

        card['onEventResize']({ event: longer, oldEvent: FIFTH, revert: jasmine.createSpy('revert') });
        await Promise.resolve();
        await Promise.resolve();

        expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('base-1', { end: '2026-10-16T08:00:00.000Z', allDay: false }, 7);
    });

    describe('an edited occurrence whose slot the server did not answer', () => {
        const UNSLOTTED = { ...EDITED, extendedProps: { ...EDITED.extendedProps, recurrenceInstant: null } };

        it('is not deleted from the menu in any scope, nor as a plain event: nothing is sent', async () => {
            for (const s of ['this', 'following', 'all'] as const) {
                scope = s;
                await fromTheMenu(UNSLOTTED, () => card['onCmenuDelete']());
            }

            expect(api.skipCalendarItemOccurrence).not.toHaveBeenCalled();
            expect(api.deleteFollowingCalendarItem).not.toHaveBeenCalled();
            expect(api.deleteCalendarItem).not.toHaveBeenCalled();
        });

        it('is not moved as part of its series by a drag: nothing is sent, the drag is reverted', async () => {
            const revert = jasmine.createSpy('revert');
            const moved = { ...UNSLOTTED, start: new Date('2026-10-20T10:00:00.000Z') };

            for (const s of ['this', 'following'] as const) {
                scope = s;
                card['onEventDrop']({ event: moved, oldEvent: UNSLOTTED, revert });
                await Promise.resolve();
                await Promise.resolve();
            }

            expect(api.createCalendarItemException).not.toHaveBeenCalled();
            expect(api.splitCalendarItem).not.toHaveBeenCalled();
            expect(revert).toHaveBeenCalledTimes(2);
        });

        it('still has its own change from the menu, naming its own version', async () => {
            await fromTheMenu(UNSLOTTED, () => card['onCmenuSetStatus']('tentative'));

            expect(api.updateCalendarItem).toHaveBeenCalledOnceWith('exception-1', { status: 'tentative' }, 9);
        });
    });
});
