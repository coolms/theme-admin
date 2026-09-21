import { Dialog } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter } from 'rxjs/operators';

import { CalendarItemDto } from './calendars.types';
import { CalendarsApiService } from './calendars-api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import { DateTimeFormatService, DrawerService, ToastService } from '@coolms/ui-angular';
import {
    CalendarEventEditorComponent,
    CalendarEventEditorData,
    CalendarEventEditorResult,
} from './calendar-event-editor.component';
import { calendarDaysBetween, localDateOf, localDayKey, monthDayName, shiftDayKey, weekdayName } from './day-key.util';
import { MiniCalendarComponent } from './mini-calendar.component';

interface DayBucket {
    readonly key:    string;     // YYYY-MM-DD
    readonly date:   Date;
    readonly label:  string;     // "Today, May 30" / "Tomorrow, May 31" / "Mon, Jun 1"
    readonly items:  CalendarItemDto[];
}

/** Horizon for the upcoming-events list (days from today). */
const LOOKAHEAD_DAYS = 14;

/**
 * -- Calendar quick panel rendered in the global right-side
 * drawer. Opened from the topbar calendar icon (-era component
 * `CalendarQuickAccessComponent` now opens this instead of navigating).
 *
 * Layout, top-down:
 *  - Header: title, open-full link, close button (drawer-owned)
 *  - Mini-calendar (reuses MiniCalendarComponent -- same widget the
 *    full Calendar Detail sidebar uses)
 *  - Upcoming events list, grouped by day for the next 14 days -- the
 *    PERSON's days and clock, through DateTimeFormatService (the profile's
 *    timezone and 12h/24h choice), not the browser's
 *  - Footer: "+ New event" CTA
 *
 * Data source: ApiService.listCalendarItems({ calendarSlug, from, to }).
 * Clicking an event opens the same event editor modal the full
 * calendar page uses. Mini-cal date click scrolls the list to that
 * day (no main-grid coupling here).
 */
@Component({
    selector: 'app-calendar-quick-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MiniCalendarComponent],
    template: `
        <div class="qp">
            <header class="qp__head">
                <button type="button" class="link-btn" (click)="openFullLayout()"
                        title="Open full calendar">
                    <i class="bi bi-box-arrow-up-right"></i>
                    <span>Open full</span>
                </button>
            </header>

            <div class="qp__mini">
                <app-mini-calendar
                    [selectedDate]="selectedDate()"
                    (dateSelect)="onMiniDateSelect($event)" />
            </div>

            <div class="qp__list">
                @if (loading()) {
                    <p class="status">Loading events…</p>
                } @else if (error()) {
                    <p class="status status--error">{{ error() }}</p>
                } @else if (buckets().length === 0) {
                    <div class="empty">
                        <i class="bi bi-calendar-x"></i>
                        <p>No events in the next {{ lookaheadDays }} days.</p>
                    </div>
                } @else {
                    @for (bucket of buckets(); track bucket.key) {
                        <section class="day">
                            <h3 class="day__title">{{ bucket.label }}</h3>
                            <ul class="day__items">
                                @for (item of bucket.items; track item.id) {
                                    <li class="ev"
                                        [class.ev--cancelled]="item.status === 'cancelled'"
                                        [class.ev--tentative]="item.status === 'tentative'"
                                        (click)="openEditor(item)">
                                        <span class="ev__dot"
                                              [style.background]="item.color || defaultColor"></span>
                                        <span class="ev__title">{{ item.title }}</span>
                                        <span class="ev__time">{{ formatTime(item) }}</span>
                                    </li>
                                }
                            </ul>
                        </section>
                    }
                    <p class="horizon">
                        Showing events through {{ horizonLabel() }}
                    </p>
                }
            </div>

            <footer class="qp__foot">
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="!canEdit()"
                        (click)="openNewEvent()">
                    <i class="bi bi-plus-lg"></i> New event
                </button>
            </footer>
        </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }
        .qp {
            display: flex;
            flex-direction: column;
            height: 100%;
            gap: 10px;
            font-size: .85rem;
        }
        .qp__head {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
        }
        .link-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            border: 0;
            background: transparent;
            /*  TEXT, so it takes the ink tier. The raw accent measured 2.03
               on --cms-surface in light theme -- below even the 3:1 that
               applies to glyphs. --cms-accent-text is 7.20 light / 9.59 dark.
               No literal fallback: unlike --cms-accent this token differs
               between themes, so any single literal would disagree with one. */
            color: var(--cms-accent-text);
            font-size: .8rem;
            cursor: pointer;
            padding: 4px 6px;
            border-radius: var(--cms-radius-sm, 4px);
        }
        .link-btn:hover { background: var(--cms-info-light); }

        .qp__mini { flex-shrink: 0; }

        .qp__list {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding-right: 4px;
        }
        .qp__foot {
            flex-shrink: 0;
            padding-top: 6px;
            border-top: 1px solid var(--cms-border, #e5e7eb);
            display: flex;
            justify-content: stretch;
        }

        .status { color: var(--cms-text-muted, #848b96); padding: 8px 4px; margin: 0; }
        .status--error { color: var(--cms-danger, #dc2626); }

        .empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 24px 12px;
            color: var(--cms-text-muted, #848b96);
            text-align: center;
        }
        .empty i { font-size: 1.6rem; }
        .empty p { margin: 0; font-size: .8rem; }

        .day { display: flex; flex-direction: column; gap: 4px; }
        .day__title {
            margin: 0;
            font-size: .72rem;
            font-weight: 600;
            color: var(--cms-text-muted, #848b96);
            text-transform: uppercase;
            letter-spacing: .03em;
            padding: 2px 0;
            position: sticky;
            top: 0;
            background: var(--cms-surface, #fff);
            z-index: 1;
        }
        .day__items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }

        .ev {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 6px;
            border-radius: var(--cms-radius-sm, 4px);
            cursor: pointer;
            transition: background .1s;
        }
        .ev:hover { background: var(--cms-surface-muted); }
        .ev--cancelled .ev__title { text-decoration: line-through; opacity: .6; }
        .ev--tentative { opacity: .8; font-style: italic; }
        .ev__dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
            background: var(--cms-accent, #F5A623);
        }
        .ev__title {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: .8rem;
            color: var(--cms-text);
        }
        .ev__time {
            flex-shrink: 0;
            font-size: .72rem;
            color: var(--cms-text-muted, #848b96);
            font-variant-numeric: tabular-nums;
        }
        .horizon {
            margin: 8px 0 0;
            text-align: center;
            font-size: .7rem;
            color: var(--cms-text-muted, #848b96);
            font-style: italic;
        }
    `],
})
export class CalendarQuickPanelComponent implements OnInit {
    /** Slug of the personal calendar to drive the list. */
    personalCalendarSlug = input.required<string>();

    /** Whether the current user can create events in this calendar. Defaults to true
     *  (the personal calendar is always editable by its owner -- the topbar wires
     *  this for the current user). The drawer renders this panel without knowing
     *  about the calendar's owner so we trust the caller. */
    canEdit = input<boolean>(true);
    private readonly calendarsApi = inject(CalendarsApiService);
    private readonly dialog     = inject(Dialog);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly drawer     = inject(DrawerService);
    private readonly router     = inject(Router);
    private readonly dtf        = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);

    readonly lookaheadDays = LOOKAHEAD_DAYS;
    readonly defaultColor  = 'var(--cms-accent, #F5A623)';

    readonly items   = signal<CalendarItemDto[]>([]);
    readonly loading = signal<boolean>(true);
    readonly error   = signal<string | null>(null);
    /**
     * The day the list starts on, as the browser-local Date the mini-calendar
     * speaks (only its Y-M-D is read). It opens on the PERSON's today -- the
     * calendar day now falls on in the profile's timezone.
     */
    readonly selectedDate = signal<Date>(localDateOf(this.dtf.dayKey(new Date().toISOString())));

    /**
     * Items grouped by the day they start on IN THE PERSON'S TIMEZONE, for
     * LOOKAHEAD_DAYS days from the selected day. The day comes from the
     * estate's formatter (`dayKey`), not from the browser's Date getters: an
     * event at 01:00 in Tokyo is tomorrow's for a person whose profile says
     * Tokyo, whichever zone their browser sits in -- and the clock printed
     * beside it, also the profile's, has to agree with the heading above it.
     */
    readonly buckets = computed<DayBucket[]>(() => {
        const all        = this.items();
        const startKey   = localDayKey(this.selectedDate());
        const horizonKey = shiftDayKey(startKey, LOOKAHEAD_DAYS);

        // Keys are canonical YYYY-MM-DD, so the window test is a string
        // compare. Items before the panel's selection are skipped (they are
        // in the past relative to the person's current focus).
        const map = new Map<string, CalendarItemDto[]>();
        for (const item of all) {
            const key = this.dtf.dayKey(item.start);
            if (key < startKey || key >= horizonKey) continue;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(item);
        }

        const out: DayBucket[] = [];
        const today = this.dtf.dayKey(new Date().toISOString());
        for (let key = startKey; key < horizonKey; key = shiftDayKey(key, 1)) {
            const items = map.get(key);
            if (items && items.length > 0) {
                items.sort((a, b) => a.start.localeCompare(b.start));
                out.push({
                    key,
                    date: localDateOf(key),
                    label: this.dayLabel(key, today),
                    items,
                });
            }
        }
        return out;
    });

    readonly horizonLabel = computed(() =>
        monthDayName(shiftDayKey(localDayKey(this.selectedDate()), LOOKAHEAD_DAYS - 1)),
    );

    constructor() {
        // Refetch whenever the slug or the selectedDate moves.
        effect(() => {
            const slug = this.personalCalendarSlug();
            const sel  = this.selectedDate();
            untracked(() => this.fetch(slug, sel));
        });
    }

    ngOnInit(): void {
        // initial fetch is handled by the effect above.
    }

    private fetch(slug: string, selected: Date): void {
        if (!slug) return;
        this.loading.set(true);
        this.error.set(null);

        // The window is asked in browser-local days, two wider than the list
        // on each side: the list keeps an item by the day it starts on in the
        // PERSON's timezone, and that day can lie a calendar day either side
        // of the browser's (26 hours separate UTC-12 from UTC+14). What the
        // window over-fetches, `buckets` drops by key.
        const from = this.startOfDay(selected);
        from.setDate(from.getDate() - 2);
        const to   = this.startOfDay(selected);
        to.setDate(to.getDate() + LOOKAHEAD_DAYS + 2);

        this.calendarsApi.listCalendarItems({
            calendarSlug: slug,
            from: from.toISOString(),
            to:   to.toISOString(),
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.items.set(rows);
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    onMiniDateSelect(d: Date): void {
        this.selectedDate.set(d);
    }

    openEditor(item: CalendarItemDto): void {
        this.calendarsApi.getCalendarItem(item.originalItemId ?? item.id).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: fullItem => this.openEditorModal({
                mode: 'edit',
                calendarId: fullItem.calendarId,
                calendarTz: 'UTC',
                item: fullItem,
                canEdit: this.canEdit(),
            }),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    openNewEvent(): void {
        // We need a calendarId -- fetch it from the slug if we don't have
        // it cached. The simpler shortcut: every item we've loaded shares
        // it, so reuse the first one if any. Otherwise, fall back to a
        // GET-calendar call.
        const first = this.items()[0];
        if (first) {
            this.openEditorModal({
                mode: 'create',
                calendarId: first.calendarId,
                calendarTz: 'UTC',
                defaultStart: this.selectedDate().toISOString(),
            });
            return;
        }
        this.calendarsApi.getCalendar(this.personalCalendarSlug()).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cal => this.openEditorModal({
                mode: 'create',
                calendarId: cal.id ?? '',
                calendarTz: cal.tz ?? 'UTC',
                defaultStart: this.selectedDate().toISOString(),
            }),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    private openEditorModal(data: CalendarEventEditorData): void {
        this.dialog.open<CalendarEventEditorResult>(CalendarEventEditorComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is CalendarEventEditorResult => Boolean(r)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(result => {
            if (result.action !== 'cancelled') {
                // Refetch from the API to pick up the new/edited/deleted row.
                this.fetch(this.personalCalendarSlug(), this.selectedDate());
            }
        });
    }

    /** Open the full calendar layout in the main content area and close the drawer. */
    openFullLayout(): void {
        const slug = this.personalCalendarSlug();
        if (!slug) return;
        this.drawer.close();
        void this.router.navigate(['/calendars', slug]);
    }

    /**
     * The event's clock through the estate's formatter: the profile's
     * timezone and 12h/24h choice, presented the way every other surface
     * presents a time. The panel used to feed those two preferences into
     * `toLocaleTimeString(undefined, ...)`, which still left the rendering to
     * the BROWSER's locale.
     */
    formatTime(item: CalendarItemDto): string {
        return item.allDay ? 'All day' : this.dtf.time(item.start);
    }

    private startOfDay(d: Date): Date {
        const out = new Date(d);
        out.setHours(0, 0, 0, 0);
        return out;
    }

    /** "Today, Mar 10" / "Tomorrow, Mar 11" / "Mon, Mar 11" -- days of the person's calendar. */
    private dayLabel(key: string, today: string): string {
        const days = calendarDaysBetween(today, key);
        const md   = monthDayName(key);
        if (days === 0) return `Today, ${md}`;
        if (days === 1) return `Tomorrow, ${md}`;
        return `${weekdayName(key)}, ${md}`;
    }
}
