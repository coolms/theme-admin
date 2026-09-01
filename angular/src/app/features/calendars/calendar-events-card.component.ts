import { Dialog } from '@angular/cdk/dialog';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    ViewChild,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import type { EventApi } from 'fullcalendar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, forkJoin, of } from 'rxjs';

import {
    ApiService,
    CalendarDto,
    CalendarHolidayPreviewDto,
    CalendarItemDto,
    CalendarItemStatusCode,
    CalendarItemTypeCode,
    CreateCalendarItemDto,
    HolidayPreviewItemDto,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ToastService,
    UserCalendarPreferencesService,
} from '@coolms/ui-angular';
import { switchMap } from 'rxjs/operators';
import { CalendarEventEditorComponent, CalendarEventEditorData, CalendarEventEditorResult } from './calendar-event-editor.component';
import {
    ScopePromptDialogComponent,
    type ScopePromptDialogData,
    type ScopePromptResult,
} from './recurrence-form/scope-prompt-dialog.component';
import { CalendarLiveEventsService } from './calendar-live-events.service';

import {
    Calendar,
    EventClickInfo,
    EventDropInfo,
    EventInput,
    DateSelectInfo,
    DatesSetInfo,
    FormatterInput,
} from 'fullcalendar';
import dayGridPlugin from 'fullcalendar/daygrid';
import timeGridPlugin from 'fullcalendar/timegrid';
import interactionPlugin from 'fullcalendar/interaction';
// v7 ships no built-in look: a theme is a plugin AND a stylesheet
// (the stylesheets are in angular.json). Without both, the grid
// renders as an unstyled list.
import classicTheme from 'fullcalendar/themes/classic';
import type { EventResizeDoneInfo } from 'fullcalendar';

/** Subdued background colours for the holiday-overlay events. */
const HOLIDAY_OFF_COLOR     = '#fef3c7'; // light yellow — non-working holiday
const HOLIDAY_WORKING_COLOR = '#dcfce7'; // light green — working compensation day

/**
 * — Calendar Events grid (FullCalendar wrapper, redesigned).
 *
 * Differences vs the () version:
 *  - Holiday rules are projected as **background events** behind the
 *    main grid (per visible year — cached). Non-working = light yellow,
 *    working compensation = light green. Read-only (no drag/click).
 *  - **Drag-to-reschedule** + **resize** are enabled for non-recurring
 *    events (PATCH start/end). Recurring rows render with a subtle
 *    stripe pattern + are non-editable; tap-through still opens the
 *    editor for full-row mutations.
 *  - Toolbar buttons live in the page header now — the card body is
 *    purely the grid (no card chrome at all).
 *  - `datesSet` exposed via `viewRangeChanged` so the parent (mini-cal,
 *    title) can stay in sync with the FullCalendar cursor.
 */
@Component({
    selector: 'app-calendar-events-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="fc-host">
            <div #fcRoot class="fc-root"></div>
            @if (loadError()) {
                <p class="error">{{ loadError() }}</p>
            }
        </div>

        <!-- — right-click context menu. Positioned at the viewport
             coordinates we captured from the contextmenu event. Clipped
             to the viewport in (left, top) so the menu doesn't render
             off-screen near the bottom/right edges. -->
        @if (cmenu(); as menu) {
            <div class="cmenu"
                 [style.left.px]="clampMenuX(menu.x)"
                 [style.top.px]="clampMenuY(menu.y)"
                 (click)="$event.stopPropagation()">

                <!-- — Duplicate clones the event as a brand new
                     standalone row starting one day later. Always
                     visible because cloning never depends on the
                     event's current status. -->
                <button type="button" class="cmenu__item"
                        (click)="onCmenuDuplicate()">
                    <i class="bi bi-files"></i>
                    <span>Duplicate (+1 day)</span>
                </button>

                <!-- — Status quick-set: only the two statuses the
                     event is NOT currently in are shown. Single click
                     patches the canonical row; no scope prompt because
                     status changes apply to the whole series. -->
                <div class="cmenu__sep"></div>
                @if (menu.status !== 'confirmed') {
                    <button type="button" class="cmenu__item"
                            (click)="onCmenuSetStatus('confirmed')">
                        <i class="bi bi-check-circle"></i>
                        <span>Mark as Confirmed</span>
                    </button>
                }
                @if (menu.status !== 'tentative') {
                    <button type="button" class="cmenu__item"
                            (click)="onCmenuSetStatus('tentative')">
                        <i class="bi bi-question-circle"></i>
                        <span>Mark as Tentative</span>
                    </button>
                }
                @if (menu.status !== 'cancelled') {
                    <button type="button" class="cmenu__item"
                            (click)="onCmenuSetStatus('cancelled')">
                        <i class="bi bi-slash-circle"></i>
                        <span>Mark as Cancelled</span>
                    </button>
                }

                <div class="cmenu__sep"></div>
                <button type="button" class="cmenu__item cmenu__item--danger"
                        (click)="onCmenuDelete()">
                    <i class="bi bi-trash"></i>
                    <span>Delete</span>
                </button>
            </div>
        }
    `,
    styles: [`
        /* -- FullCalendar 7 palette, bound to the admin's tokens ----------
           v7 ships no appearance and HASHES its class names, so custom
           properties are the only styling API. Binding them to --cms-*
           gives us both themes from one definition -- those tokens already
           flip under :root[data-theme='dark']. (FC's own palette.css keys
           off [data-color-scheme], which this admin never sets, so it would
           have been stuck in light mode.)

           Borders are deliberately one step softer than FC's defaults: a month
           grid draws a line every few pixels, and a weight tuned for a white
           page reads as noise here. */
        :host {
            --fc-classic-border:              var(--cms-border-light, var(--cms-border));
            --fc-classic-strong-border:       var(--cms-border);

            --fc-classic-background:          var(--cms-surface);
            --fc-classic-foreground:          var(--cms-text);
            --fc-classic-muted-foreground:    var(--cms-text-muted);
            --fc-classic-faint-foreground:    var(--cms-text-secondary, var(--cms-text-muted));

            --fc-classic-faint:               var(--cms-surface-muted, transparent);
            --fc-classic-muted:               var(--cms-surface-hover, transparent);
            --fc-classic-strong:              var(--cms-surface-alt, transparent);

            --fc-classic-primary:             var(--cms-accent);
            --fc-classic-primary-foreground:  var(--cms-accent-fg, #1a1a1a);

            /* Today / selection tints, and the current-time line. Without
               these the palette variables are undefined and today loses its
               highlight entirely. */
            --fc-classic-today:               color-mix(in srgb, var(--cms-accent) 10%, transparent);
            --fc-classic-highlight:           color-mix(in srgb, var(--cms-accent) 22%, transparent);
            --fc-classic-now:                 var(--cms-danger, #dc2626);

            /* The default event colour, for items with no colour of their own.
               The theme wires these into its eventColor / eventContrastColor
               options (themes/classic/global.js), so this is what an uncoloured
               chip gets -- previously FC's own slate blue. */
            --fc-classic-event:               var(--cms-accent);
            --fc-classic-event-contrast:      var(--cms-accent-fg, #1a1a1a);

            /*  The toolbar buttons. These were NEVER set, which is why the
               card carried a .fc .fc-button-primary rule -- a v6 selector
               that matches nothing in v7. The variables are the API; the
               selector never was. */
            --fc-classic-button:              var(--cms-btn-bg);
            --fc-classic-button-border:       var(--cms-btn-border);
            --fc-classic-button-foreground:   var(--cms-btn-text);
            --fc-classic-button-strong:       var(--cms-accent);
            --fc-classic-button-strong-border: var(--cms-accent);
            --fc-classic-button-outline:      var(--cms-accent-light, #FEF7E6);
        }
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .fc-host {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            /* Task — clip the second scrollbar that surfaced when the
               nested FC time-grid scroller + the host container scroller
               both produced overflow due to sub-pixel rounding. The FC's
               internal scroller is the authoritative one for the timeGrid
               body; the host doesn't need its own. */
            overflow: hidden;
        }
        .fc-root {
            flex: 1;
            min-height: 0;
            /* Task — no left/right padding. The 4px gutter
               previously here surfaced as an empty strip beyond
               "Sun 31/05" once the scrollbar was hidden in #461/#462.
               Edge-to-edge grid reads cleaner anyway. */
            padding: 0;
            /* Same defence-in-depth — pin the FC root so the only
               scrollable region is FC's own time-grid body. */
            overflow: hidden;
        }
        /*  v7 HASHES its class names, so .fc does not exist. Font and
           size are set on our own wrapper and inherit down; the height comes
           from the flex column above. */
        .fc-host { font-family: inherit; font-size: .85rem; }
        /* Task + -- hide every native scrollbar inside FC's
           internal scrollers. FC v6 forces overflow-y: scroll on every
           region of its scrollgrid (header, all-day row, time-grid
           body) for alignment math; browsers (especially Windows
           WebKit) then render scrollbar step-buttons in each region,
           stacked as "extra scrollbars" on the right edge. The narrow
           rule was insufficient -- only display:none on the entire
           scrollbar pseudo (plus the Firefox scrollbar-width:none)
           silences them all. The grid itself is still scrollable via
           wheel / touch / keyboard. */
        /*  .fc-scroller is a v6 name and matches nothing. Every v7 class
           IS still prefixed fc- before its hash, so an attribute-substring
           selector reaches them: this is the one selector shape that survives
           the rename. The buttons and the event cursor moved to the variables
           above -- there is no selector to write for those any more. */
        :host ::ng-deep [class*='fc-'] { scrollbar-width: none; }
        :host ::ng-deep [class*='fc-']::-webkit-scrollbar {
            width: 0; height: 0; display: none;
        }
        :host ::ng-deep [class*='fc-']::-webkit-scrollbar-button,
        :host ::ng-deep [class*='fc-']::-webkit-scrollbar-track,
        :host ::ng-deep [class*='fc-']::-webkit-scrollbar-thumb,
        :host ::ng-deep [class*='fc-']::-webkit-scrollbar-corner {
            display: none;
        }
        /* Visual cue for recurring rows — diagonal stripes overlay. */
        :host ::ng-deep .fc-ev-recurring {
            background-image: repeating-linear-gradient(
                45deg,
                transparent 0,
                transparent 6px,
                rgba(255,255,255,0.25) 6px,
                rgba(255,255,255,0.25) 12px
            ) !important;
        }
        :host ::ng-deep .fc-ev-recurring::after {
            content: '\\F4E7'; /* bi-arrow-repeat */
            font-family: 'bootstrap-icons';
            margin-left: 4px;
            opacity: .7;
        }
        :host ::ng-deep .fc-ev-cancelled { text-decoration: line-through; opacity: .6; }
        :host ::ng-deep .fc-ev-tentative { opacity: .75; font-style: italic; }

        /* Holiday backgrounds — pin the text down so it's visible. */
        /*  .fc-event-title is a v6 name. .fc-ev-holiday-bg is OURS --
           passed through eventClassNames() -- so it still applies, and the
           text styling goes on it directly. */
        :host ::ng-deep .fc-ev-holiday-bg {
            color: var(--cms-warning-text);
            font-size: .7rem;
            font-weight: 600;
            padding: 2px 4px;
            text-transform: uppercase;
            letter-spacing: .02em;
        }

        .error {
            color: var(--cms-danger, #dc2626);
            padding: 8px 16px;
            margin: 0;
            font-size: .85rem;
        }

        /* — right-click context menu. Floats above FC at the
           mouse coords; small inventory (single Delete action for
           v1). Position is fixed because we capture viewport coords
           (clientX/Y); the parent FC root is the visual anchor but
           we don't need to position relative to it. */
        .cmenu {
            position: fixed;
            z-index: 9999;
            min-width: 160px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            box-shadow: var(--cms-shadow-md, 0 4px 12px rgba(0,0,0,.15));
            padding: 4px;
            font-size: .8125rem;
        }
        .cmenu__item {
            display: flex; align-items: center; gap: 8px;
            width: 100%;
            padding: 8px 10px;
            border: none; background: transparent;
            color: var(--cms-text, #111827);
            font-size: .8125rem;
            text-align: left;
            cursor: pointer;
            border-radius: var(--cms-radius-sm, 4px);
        }
        .cmenu__item:hover { background: var(--cms-btn-hover-bg, #f3f4f6); }
        .cmenu__item--danger { color: var(--cms-danger, #dc2626); }
        .cmenu__item--danger:hover { background: var(--cms-danger-light, #fef2f2); }
        /* — thin divider between cmenu action groups (Duplicate
           / Status / Delete). 1px line that respects the 4px outer
           padding so it touches both edges visually. */
        .cmenu__sep {
            height: 1px;
            background: var(--cms-border, #e5e7eb);
            margin: 4px -4px;
        }
    `],
})
export class CalendarEventsCardComponent implements OnInit, AfterViewInit, OnDestroy {
    /** The calendar this card displays events for. */
    calendar = input.required<CalendarDto>();

    /** Whether the current user can create/edit/delete events. */
    canEdit = input<boolean>(false);

    /** Initial FullCalendar view name. */
    initialView = input<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'>('dayGridMonth');

    /** Emitted whenever an event is mutated (create / update / delete). */
    eventsChanged = output<void>();

    /**
     * Emitted on every datesSet — parent uses this to track the
     * displayed period so the sidebar mini-cal + toolbar title stay
     * in sync with the grid.
     *
     * `currentStart` is the **first day of the displayed period** (e.g.
     * May 1 for a Month view showing May 2026) — NOT `view.activeStart`,
     * which is the first cell of the rendered grid (often a previous-
     * month tail date like April 27 that fills the first row). The
     * earlier code used `activeStart` for both the title and mini-cal
     * sync; the result was the title and mini-cal lagging one month
     * behind the displayed grid for any month whose 1st isn't a Monday
     * (or Sunday on US-start weeks). See task .
     *
     * `viewType` lets the parent re-sync its Month / Week / Day toggle
     * when FullCalendar's internal view changes via nav-link clicks
     * (e.g. clicking a weekday header in Week view jumps to Day view).
     * Before this was wired, the toolbar pill stayed stuck on the
     * previous view, leaving the user no way back. See task .
     *
     * `start` / `end` retain `view.activeStart` / `view.activeEnd`
     * semantics for any consumer that needs the actual rendered range
     * (e.g. event-fetch windows).
     */
    viewRangeChanged = output<{
        start:        Date;
        end:          Date;
        currentStart: Date;
        currentEnd:   Date;
        viewType:     'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
    }>();

    private readonly api        = inject(ApiService);
    private readonly dialog     = inject(Dialog);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly userPrefs  = inject(UserCalendarPreferencesService);
    private readonly liveEvents = inject(CalendarLiveEventsService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * — Right-click context menu on calendar events. NULL when
     * closed; otherwise carries the viewport coordinates to position
     * the popover at, plus the FullCalendar event the user opened it
     * on (we need its id, title, seriesId, etc. for the delete flow).
     * Closed by outside-click, Escape, or after the chosen action
     * completes.
     */
    readonly cmenu = signal<{
        x: number;
        y: number;
        canonicalId: string;
        seriesId: string | null;
        occurrenceInstant: string | null;
        title: string;
        recurrence: string | null;
        // — snapshot of fields needed for the new actions.
        // `status` filters which "Mark as …" entries we render so the
        // user doesn't get a button to switch to the status they're
        // already in. The remaining fields are inputs for Duplicate:
        // FC's EventApi gives us start/end/allDay; the rest ride on
        // extendedProps (see `toEventInput` for the source of truth).
        status: CalendarItemStatusCode;
        type: CalendarItemTypeCode;
        startIso: string;
        endIso: string | null;
        allDay: boolean;
        description: string | null;
        location: string | null;
        color: string | null;
    } | null>(null);

    readonly loadError = signal<string | null>(null);

    @ViewChild('fcRoot', { static: true })
    private readonly fcRootRef!: ElementRef<HTMLDivElement>;

    private fc: Calendar | null = null;

    /** Per-year holiday preview cache. Keyed by `${slug}|${year}`. */
    private readonly holidayCache = new Map<string, HolidayPreviewItemDto[]>();
    /** In-flight holiday year fetches we don't want to re-trigger. */
    private readonly pendingHolidayYears = new Set<string>();

    constructor() {
        // [follow-up] — userPrefs are signals, so an effect() lets us
        // re-build the FC instance whenever the user saves a new value on
        // the Profile -> Calendar tab (or the initial /auth/me/settings
        // load lands after this component was constructed with stale
        // defaults). Without this, FC keeps whatever slotLabel / time /
        // header format the synchronous read in ngAfterViewInit captured,
        // so switching to 12h on Profile and navigating to /admin/
        // calendars/{slug} still rendered the 24h time axis until the
        // SPA was fully refreshed.
        //
        // We initially tried `fc.setOption(...)` per option, but FC v6
        // does not reliably re-render the slot-label DOM in response —
        // the option is updated internally but the rendered axis keeps
        // the old format. Destroy + rebuild is the only reliable path,
        // and only fires when the user touches Profile prefs (rare),
        // so the cost is negligible. Current view + date are preserved.
        //
        // Registered in the constructor (injection context) and guarded
        // against the pre-build window by the `if (!this.fc)` short-
        // circuit — the initial run happens before ngAfterViewInit
        // builds FC, so the first invocation is always a no-op.
        effect(() => {
            // Read the signals up-front so the effect's dependency graph
            // captures all four (Angular tracks reads done synchronously
            // inside the effect body).
            const tf = this.userPrefs.timeFormat();
            const df = this.userPrefs.dateFormat();
            const fd = this.userPrefs.firstDay();
            const tz = this.userPrefs.tz();
            if (!this.fc) return;
            const preserveView = this.fc.view.type as 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
            const preserveDate = this.fc.getDate();
            this.fc.destroy();
            this.fc = null;
            this.constructFcInstance(preserveView, preserveDate);
            // Suppress the unused-locals warning — the reads above are
            // semantically meaningful for signal tracking.
            void tf; void df; void fd; void tz;
        });
    }

    /**
     * Compute the FullCalendar configuration knobs that depend on the
     * user's Calendar preferences (time format, date format, week start,
     * timezone). Centralised so both the initial `new Calendar({...})`
     * call and the reactive `effect()` above can share one source of
     * truth, and so future per-view header format tweaks land in one
     * place.
     */
    private buildFcFormatOptions(): {
        slotHeaderFormat:      FormatterInput;
        eventTimeFormat:      FormatterInput;
        timeGridHeaderFormat: FormatterInput;
        monthHeaderFormat:    FormatterInput;
        fcLocale:             string;
        firstDay:             0 | 1;
        effectiveTz:          string;
    } {
        const is24h      = this.userPrefs.timeFormat() === '24h';
        const dateFmt    = this.userPrefs.dateFormat() || 'yyyy-MM-dd';
        const isDayFirst = dateFmt.startsWith('dd');
        const isIsoStyle = dateFmt.startsWith('yyyy');
        const timeGridHeaderFormat: FormatterInput = isIsoStyle
            ? { weekday: 'short', month: '2-digit', day: '2-digit' }
            : isDayFirst
                ? { weekday: 'short', day: 'numeric', month: 'numeric' }
                : { weekday: 'short', month: 'numeric', day: 'numeric' };
        const monthHeaderFormat: FormatterInput = { weekday: 'short' };
        // [follow-up x3] — FullCalendar's OBJECT-based slot header
        // format is partially merged with the plugin's per-view defaults,
        // and the
        // merge silently drops `hour: '2-digit'` + `meridiem` overrides
        // when the active locale's hour12 default conflicts. Function
        // formatters bypass the merge entirely and let us emit the exact
        // string we want, which is what the user-prefs contract demands.
        const pad2 = (n: number): string => String(n).padStart(2, '0');
        const formatSlotTime = (hour: number, minute: number): string => {
            if (is24h) {
                return `${pad2(hour)}:${pad2(minute)}`;
            }
            // 12h: 12 -> 12, 13–23 -> 1–11, 0 -> 12. Minute always 2-digit.
            const h12   = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            const ampm  = hour < 12 ? 'AM' : 'PM';
            return `${h12}:${pad2(minute)} ${ampm}`;
        };
        const slotHeaderFormat: FormatterInput = (arg) =>
            formatSlotTime(arg.date.hour, arg.date.minute);
        const eventTimeFormat: FormatterInput = (arg) =>
            formatSlotTime(arg.start.hour, arg.start.minute);
        const fcLocale = (isIsoStyle || isDayFirst) ? 'en-GB' : 'en-US';
        const effectiveTz = this.userPrefs.tz() || this.calendar().tz || 'local';
        const firstDay    = this.userPrefs.firstDay();
        return {
            slotHeaderFormat,
            eventTimeFormat,
            timeGridHeaderFormat,
            monthHeaderFormat,
            fcLocale,
            firstDay,
            effectiveTz,
        };
    }

    ngOnInit(): void {
        // Reset cache on calendar swap — `ngOnInit` only fires once
        // for a given route, so this is precautionary for hot reload.
        this.holidayCache.clear();

        // Calendar realtime ship — subscribe to the items channel for
        // this calendar so concurrent edits from other tabs / users
        // re-trigger a FullCalendar refetch. The backend
        // `CalendarItemChangeDispatcher` collapses multi-row flushes
        // into a single ping per calendar so we don't refetch 10×
        // for a 10-item batch create. The publication payload is a
        // thin "something changed" marker; we ignore it and just
        // refetch.
        const calendarId = this.calendar().id;
        if (calendarId) {
            this.liveEvents.watchItems(calendarId)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(() => this.fc?.refetchEvents());
        }
    }

    ngAfterViewInit(): void {
        // Task — prefer the user's chosen TZ over the calendar's TZ
        // (per-calendar TZ remains a fallback for shared/team calendars
        // that explicitly bind their own region). Same logic for
        // weekStart -> firstDay (0 = Sun, 1 = Mon).
        //
        // Task bug 2 follow-up — after prefs resolve, snap the
        // grid back to today so a TZ change between init and load
        // never leaves the user on the wrong month.
        // [follow-up x4] — use refresh() instead of ensureLoaded()
        // here so the Calendar grid always reads the most recent
        // server-side prefs, not whatever the in-memory `_prefs` cache
        // happens to hold. This closes the gap left by the original
        // shareReplay-on-loadOnce$ pattern: the Profile save handler
        // updates `_prefs` reactively on success, but if anything
        // killed that update (component-tear-down race via the
        // takeUntilDestroyed in saveCalendarPrefs, or a cross-tab
        // save), the singleton service kept the stale value forever.
        // refresh() busts the cache and re-fetches, the resulting
        // signal change feeds the constructor effect which rebuilds
        // FC with the fresh format.
        this.userPrefs.refresh().subscribe({
            next: () => this.fc?.gotoDate(new Date()),
            error: () => { /* defaults take over */ },
        });

        this.constructFcInstance();
    }

    /**
     * Build (or re-build) the FullCalendar instance. Factored out of
     * `ngAfterViewInit` so the reactive `effect()` in the constructor
     * can tear down + rebuild on prefs change without duplicating the
     * config. The effect uses rebuild rather than `setOption()` because
     * FullCalendar's `setOption('slotHeaderFormat', ...)` does not reliably
     * re-render the time-axis labels — the option is updated internally
     * but the rendered DOM keeps the old format until the calendar
     * re-renders for some other reason. Destroy + rebuild always works
     * and only fires on rare user actions (saving Profile -> Calendar
     * prefs), so the cost is negligible.
     *
     * The view + date are passed through when called from the rebuild
     * path so the user stays on the same week/day they were viewing.
     * When called from `ngAfterViewInit` we default to the
     * component-input-driven `initialView()` + "now".
     */
    private constructFcInstance(preserveView?: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay', preserveDate?: Date): void {
        // Task bug 2 — explicit initialDate. Without this,
        // FullCalendar's default `new Date()` evaluation timing is
        // ambiguous (it varies by view + TZ), and on slow page loads
        // the user occasionally landed on the prior month.
        const initialDate = preserveDate ?? new Date();
        const initialView = preserveView ?? this.initialView();

        // Tasks /+ [follow-up] — pref-driven format opts
        // come from a shared helper.
        const opts = this.buildFcFormatOptions();

        this.fc = new Calendar(this.fcRootRef.nativeElement, {
            plugins:        [dayGridPlugin, timeGridPlugin, interactionPlugin, classicTheme],
            initialView:    initialView,
            initialDate:    initialDate,
            // Header is owned by the page toolbar — turn FC's own off.
            headerToolbar:  false,
            timeZone:       opts.effectiveTz,
            firstDay:       opts.firstDay,
            // Task — user-pref-driven locale + time formats.
            locale:         opts.fcLocale,
            slotHeaderFormat: opts.slotHeaderFormat,
            eventTimeFormat: opts.eventTimeFormat,
            // Task — per-view dayHeaderFormat. Month view shows
            // weekday only because each column spans many dates;
            // Week/Day views show weekday + the column's date.
            views: {
                dayGridMonth: { dayHeaderFormat: opts.monthHeaderFormat },
                timeGridWeek: { dayHeaderFormat: opts.timeGridHeaderFormat },
                timeGridDay:  { dayHeaderFormat: opts.timeGridHeaderFormat },
            },
            // Task — `expandRows: true` makes the time grid fill
            // the host container, eliminating the small triangle
            // scroll-compensation arrows FC otherwise rendered along
            // the right edge of Week/Day views.
            expandRows:     true,
            height:         '100%',
            selectable:     this.canEdit(),
            selectMirror:   true,
            nowIndicator:   true,
            navLinks:       true,
            // Task — explicit Day-view destination for nav-link
            // clicks. Without this, FC falls back to `dayGridDay`
            // (Month-grid style, no hour axis) which rendered as a
            // single empty cell — not what the user expects when
            // clicking a weekday header.
            navLinkDayClick: 'timeGridDay',
            weekNumbers:    false,
            dayMaxEvents:   true,
            editable:       this.canEdit(), // drag enabled when user can edit
            eventResizableFromStart: true,
            events: (info, success, failure) =>
                this.loadEvents(info.start, info.end, success, failure),
            // — close the cmenu whenever any FC interaction
            // fires. FC's `select` consumes the underlying mouseup so
            // the document:click HostListener doesn't fire reliably
            // when the user clicks a date cell to open the New-event
            // dialog. Explicit dismissal here is the safest fix.
            select:       arg => { this.cmenu.set(null); this.onDateSelect(arg); },
            eventClick:   arg => { this.cmenu.set(null); this.onEventClick(arg); },
            eventDrop:    arg => { this.cmenu.set(null); this.onEventDrop(arg); },
            eventResize:  arg => { this.cmenu.set(null); this.onEventResize(arg); },
            datesSet:     arg => this.onDatesSet(arg),
            // — attach a `contextmenu` listener to every event
            // DOM node so right-click pops our cmenu. We can't use
            // FC's `eventClick` for this — it doesn't fire on
            // right-click. Holidays + background events are excluded
            // (no delete semantics).
            eventDidMount: info => {
                if (info.event.extendedProps['kind'] !== 'item') return;
                if (!this.canEdit()) return;
                info.el.addEventListener('contextmenu', (e: MouseEvent) => {
                    e.preventDefault();
                    this.openCmenu(e, info.event);
                });
            },
        });
        this.fc.render();
    }

    ngOnDestroy(): void {
        this.fc?.destroy();
        this.fc = null;
    }

    /** Public refetch — triggered by parent after Save Settings (tz changed),
     *  or after holiday rules are added / removed (background events
     *  need re-render). */
    refresh(): void {
        this.holidayCache.clear();
        this.fc?.refetchEvents();
    }

    /** Programmatic navigation — parent (mini-cal click, toolbar arrow). */
    gotoDate(d: Date): void { this.fc?.gotoDate(d); }
    prev(): void  { this.fc?.prev(); }
    next(): void  { this.fc?.next(); }
    today(): void { this.fc?.today(); }
    changeView(name: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'): void {
        this.fc?.changeView(name);
    }
    getActiveStart(): Date | null { return this.fc?.view.activeStart ?? null; }

    private loadEvents(
        from: Date,
        to: Date,
        success: (events: EventInput[]) => void,
        failure: (err: Error) => void,
    ): void {
        const slug = this.calendar().slug;
        if (!slug) {
            success([]);
            return;
        }
        this.loadError.set(null);

        const fromIso = from.toISOString();
        const toIso   = to.toISOString();

        // Holiday backgrounds: union of years touched by [from, to).
        const years = this.uniqueYearsBetween(from, to);
        const holidaysObs = forkJoin(
            years.map(y => this.fetchHolidayYear(slug, y)),
        );

        forkJoin({
            items:    this.api.listCalendarItems({ calendarSlug: slug, from: fromIso, to: toIso }),
            holidays: years.length === 0 ? of([] as HolidayPreviewItemDto[][]) : holidaysObs,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: ({ items, holidays }) => {
                const out: EventInput[] = items.map(item => this.toFcEvent(item));
                for (const yearItems of holidays) {
                    for (const h of yearItems) {
                        out.push(this.holidayToBgEvent(h));
                    }
                }
                success(out);
            },
            error: (err: unknown) => {
                const msg = this.errors.humanize(err);
                this.loadError.set(msg);
                failure(new Error(msg));
            },
        });
    }

    /** Fetch (or return cached) holiday preview for a year. */
    private fetchHolidayYear(slug: string, year: number) {
        const key = `${slug}|${year}`;
        const cached = this.holidayCache.get(key);
        if (cached) return of(cached);

        // Avoid double-fetching the same year while a request is in
        // flight (FC may re-call `events` on view switches).
        if (this.pendingHolidayYears.has(key)) {
            return of([] as HolidayPreviewItemDto[]);
        }
        this.pendingHolidayYears.add(key);

        return new Promise<HolidayPreviewItemDto[]>(resolve => {
            this.api.previewCalendarYear(slug, year).subscribe({
                next: (pv: CalendarHolidayPreviewDto) => {
                    const items = [...pv.items];
                    this.holidayCache.set(key, items);
                    this.pendingHolidayYears.delete(key);
                    resolve(items);
                },
                error: () => {
                    // Don't surface preview errors — events still render.
                    this.holidayCache.set(key, []);
                    this.pendingHolidayYears.delete(key);
                    resolve([]);
                },
            });
        });
    }

    private uniqueYearsBetween(from: Date, to: Date): number[] {
        const years = new Set<number>();
        const cursor = new Date(from.getFullYear(), 0, 1);
        const end = new Date(to.getFullYear(), 0, 1);
        while (cursor.getFullYear() <= end.getFullYear()) {
            years.add(cursor.getFullYear());
            cursor.setFullYear(cursor.getFullYear() + 1);
        }
        return [...years];
    }

    private holidayToBgEvent(h: HolidayPreviewItemDto): EventInput {
        const color = h.isWorking ? HOLIDAY_WORKING_COLOR : HOLIDAY_OFF_COLOR;
        return {
            id:              `holiday:${h.ruleId}:${h.date}`,
            title:           h.ruleLabel,
            start:           h.date,
            allDay:          true,
            display:         'background',
            color:           color,
            classNames:      ['fc-ev-holiday-bg', h.isWorking ? 'fc-ev-holiday-working' : 'fc-ev-holiday-off'],
            // Holidays are read-only; the editor key is the ruleId, not
            // a calendar item.
            editable:        false,
            extendedProps:   { kind: 'holiday', ruleId: h.ruleId, isWorking: h.isWorking },
        };
    }

    /** CalendarItemDto -> FullCalendar EventInput. */
    private toFcEvent(item: CalendarItemDto): EventInput {
        return {
            id:              item.id,
            title:           item.title,
            start:           item.start,
            end:             item.end ?? undefined,
            allDay:          item.allDay,
            //  FullCalendar 7 renamed this. `backgroundColor` / `borderColor`
            // appear in ZERO files of the installed package -- v7 reads
            // `color` and emits it as --fc-event-color. Setting the old names
            // is why a chosen colour never reached the chip.
            color:           item.color ?? undefined,
            classNames:      this.eventClassNames(item),
            // Phase 2 — recurring items are now drag/resize-enabled.
            // On drop we prompt for scope ("only this" -> POST exception;
            // "all events" -> PATCH the canonical row).
            editable:        true,
            durationEditable: true,
            startEditable:   true,
            extendedProps:   {
                kind:           'item',
                description:    item.description,
                location:       item.location,
                visibility:     item.visibility,
                status:         item.status,
                organizerId:    item.organizerId,
                originalItemId: item.originalItemId,
                type:           item.type,
                recurrence:     item.recurrence,
                // Phase 2 — flat occurrence projections strip
                // `recurrence` server-side to prevent FE re-expansion,
                // so the "is recurring?" check keys off `seriesId`
                // instead. Non-null = part of a series (base + all
                // overrides share the parent's seriesId).
                seriesId:       item.seriesId ?? null,
                parentItemId:   item.parentItemId ?? null,
            },
        };
    }

    private eventClassNames(item: CalendarItemDto): string[] {
        const cls = [`fc-ev-type-${item.type}`];
        if (item.status === 'tentative') cls.push('fc-ev-tentative');
        if (item.status === 'cancelled') cls.push('fc-ev-cancelled');
        if (item.recurrence) cls.push('fc-ev-recurring');
        return cls;
    }

    private onDateSelect(arg: DateSelectInfo): void {
        if (!this.canEdit()) {
            this.fc?.unselect();
            return;
        }
        this.openEditor({
            mode:        'create',
            calendarId:  this.calendar().id ?? '',
            calendarTz:  this.calendar().tz ?? 'UTC',
            defaultStart: arg.start.toISOString(),
            defaultEnd:   arg.end.toISOString(),
            defaultAllDay: arg.allDay,
        });
        this.fc?.unselect();
    }

    private onEventClick(arg: EventClickInfo): void {
        // Skip holiday backgrounds — they don't open the editor.
        if (arg.event.extendedProps['kind'] === 'holiday') return;

        const canonicalId = (arg.event.extendedProps['originalItemId'] as string | undefined)
            ?? arg.event.id;
        // Phase 2 — when the clicked event is an occurrence of a
        // recurring series, capture its instant so the editor can
        // route save/delete through the override endpoints (with a
        // scope prompt) instead of patching the canonical row.
        // `recurrence` is intentionally null on flat occurrence
        // projections (server strips it to prevent FE re-expansion),
        // so we key off `seriesId` instead — it's non-null for both
        // base occurrences and overrides.
        const seriesId = arg.event.extendedProps['seriesId'] as string | null | undefined;
        const occurrenceInstant = seriesId
            ? arg.event.start?.toISOString() ?? undefined
            : undefined;

        this.api.getCalendarItem(canonicalId).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: item => this.openEditor({
                mode:       'edit',
                calendarId: this.calendar().id ?? '',
                calendarTz: this.calendar().tz ?? 'UTC',
                item,
                canEdit:    this.canEdit(),
                occurrenceInstant,
            }),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /**
     * — Open the right-click context menu at the captured mouse
     * coordinates. We snapshot all the per-event data the menu actions
     * need (canonicalId, seriesId, etc.) into the signal so the menu's
     * action handlers don't need a fresh EventApi reference (which can
     * go stale after a refetch).
     */
    private openCmenu(e: MouseEvent, event: EventApi): void {
        const canonicalId       = (event.extendedProps['originalItemId'] as string | undefined) ?? event.id;
        const seriesId          = (event.extendedProps['seriesId']       as string | null | undefined) ?? null;
        const recurrence        = (event.extendedProps['recurrence']     as string | null | undefined) ?? null;
        const occurrenceInstant = seriesId ? (event.start?.toISOString() ?? null) : null;
        this.cmenu.set({
            x: e.clientX,
            y: e.clientY,
            canonicalId,
            seriesId,
            occurrenceInstant,
            title: event.title || 'Event',
            recurrence,
            // — Duplicate + Status quick-set inputs. We pull from
            // both the FC EventApi (start/end/allDay) and our
            // extendedProps (status/type/description/etc.) so the
            // menu actions don't need to fetch the canonical row
            // before firing.
            status:      (event.extendedProps['status']      as CalendarItemStatusCode | undefined) ?? 'confirmed',
            type:        (event.extendedProps['type']        as CalendarItemTypeCode   | undefined) ?? 'event',
            startIso:    event.start?.toISOString() ?? new Date().toISOString(),
            endIso:      event.end?.toISOString() ?? null,
            allDay:      event.allDay,
            description: (event.extendedProps['description'] as string | null | undefined) ?? null,
            location:    (event.extendedProps['location']    as string | null | undefined) ?? null,
            color:       event.color || null,
        });
    }

    /**
     * Close the cmenu on outside-click. We use document:click rather
     * than a backdrop element so the menu doesn't intercept clicks on
     * other events / cells — those should still be active. The menu's
     * own click is `$event.stopPropagation()`ed in the template, so
     * clicks INSIDE the menu don't reach this handler.
     */
    @HostListener('document:click')
    closeCmenuOnOutsideClick(): void {
        if (this.cmenu()) this.cmenu.set(null);
    }

    @HostListener('document:keydown.escape')
    closeCmenuOnEscape(): void {
        if (this.cmenu()) this.cmenu.set(null);
    }

    /**
     * Clamp the cmenu's left edge so it never renders off the right
     * side of the viewport. 160px is the min-width from CSS; padding
     * adds a small safety margin.
     */
    clampMenuX(x: number): number {
        const menuWidth = 180;
        return Math.min(x, window.innerWidth - menuWidth - 4);
    }

    clampMenuY(y: number): number {
        // — menu can now show up to 5 items (Duplicate + 2
        // status quick-sets + Delete + 2 separators). Pad the clamp
        // so the menu doesn't get cut off near the viewport bottom.
        const menuHeight = 220;
        return Math.min(y, window.innerHeight - menuHeight - 4);
    }

    /**
     * — Duplicate action. Clones the event as a brand-new
     * standalone (non-recurring) row starting one day later at the
     * same time-of-day. For recurring occurrences we duplicate THIS
     * occurrence's projected times — not the canonical row — because
     * the user clicked on a specific instance and that's the unit
     * they expect to be cloned. The new row is always non-recurring;
     * if the user wants to repeat-ify it, they can open the editor.
     *
     * Shift is `+1 day` rather than "next available slot" because the
     * latter is hard to compute on the client. One day is the most
     * common manual-duplicate use case (the "and again tomorrow"
     * pattern); for anything richer the user can open the editor.
     */
    onCmenuDuplicate(): void {
        const menu = this.cmenu();
        if (!menu) return;
        this.cmenu.set(null);

        const calendarId = this.calendar().id ?? '';
        if (!calendarId) {
            this.toast.error('Cannot duplicate: this view has no calendar context.');
            return;
        }

        const start = new Date(menu.startIso);
        start.setDate(start.getDate() + 1);
        const end = menu.endIso ? new Date(menu.endIso) : null;
        if (end) {
            end.setDate(end.getDate() + 1);
        }

        const payload: CreateCalendarItemDto = {
            calendarId,
            type:        menu.type,
            title:       menu.title,
            start:       start.toISOString(),
            end:         end?.toISOString() ?? null,
            allDay:      menu.allDay,
            description: menu.description,
            location:    menu.location,
            color:       menu.color,
            // Intentionally no `recurrence` — duplicates are single-
            // instance rows regardless of the source event's shape.
        };

        this.api.createCalendarItem(payload).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success('Event duplicated');
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /**
     * — Status quick-set. PATCHes the canonical row's status.
     * No scope prompt because status changes naturally apply to the
     * whole series — there's no concept of "this occurrence is
     * tentative but the rest are confirmed" in our model. (If a user
     * wants per-occurrence status, that's a Phase 2 override edit via
     * the editor dialog, not this quick-set.)
     */
    onCmenuSetStatus(newStatus: CalendarItemStatusCode): void {
        const menu = this.cmenu();
        if (!menu) return;
        this.cmenu.set(null);

        this.api.updateCalendarItem(menu.canonicalId, { status: newStatus }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Marked as ${newStatus}`);
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /**
     * — Delete action from the cmenu. Mirrors the editor's
     * onDelete flow without opening the editor dialog:
     *   - Recurring occurrence -> scope prompt -> skip / delete-
     *     following / canonical delete
     *   - Non-recurring -> confirm dialog -> canonical delete
     * On success we refetch FC + emit eventsChanged. The menu auto-
     * closes via the outside-click handler when the prompt opens.
     */
    onCmenuDelete(): void {
        const menu = this.cmenu();
        if (!menu) return;
        this.cmenu.set(null);

        if (menu.occurrenceInstant) {
            // Recurring occurrence — scope prompt.
            this.promptScope({ intent: 'delete', itemTitle: menu.title }).then(scope => {
                if (scope === undefined) return;
                if (scope === 'this') {
                    this.deleteSkipOccurrence(menu.canonicalId, menu.occurrenceInstant!);
                } else if (scope === 'following') {
                    this.deleteFollowing(menu.canonicalId, menu.occurrenceInstant!);
                } else {
                    this.deleteCanonical(menu.canonicalId, true);
                }
            });
            return;
        }

        // Non-recurring (or canonical click) — plain confirm.
        const isRecurring = !!menu.recurrence;
        this.confirmSvc.open({
            title:        `Delete "${menu.title}"?`,
            message:      isRecurring
                ? 'This will delete the entire recurring event (all occurrences).'
                : 'This event will be permanently removed.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteCalendarItem(menu.canonicalId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => this.onAfterDelete('Event deleted'),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    private deleteSkipOccurrence(parentId: string, recurrenceInstant: string): void {
        this.api.skipCalendarItemOccurrence(parentId, recurrenceInstant)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => this.onAfterDelete('This occurrence skipped'),
                error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
            });
    }

    private deleteFollowing(parentId: string, recurrenceInstant: string): void {
        this.api.deleteFollowingCalendarItem(parentId, recurrenceInstant)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => this.onAfterDelete('This and following occurrences removed'),
                error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
            });
    }

    private deleteCanonical(canonicalId: string, isRecurring: boolean): void {
        // Recurring "all events" delete still needs an explicit
        // confirm — bypassing the editor's confirm dialog from a
        // right-click would be too easy a footgun.
        this.confirmSvc.open({
            title:        'Delete entire series?',
            message:      isRecurring
                ? 'All occurrences of this recurring event will be permanently removed.'
                : 'This event will be permanently removed.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteCalendarItem(canonicalId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => this.onAfterDelete('Event deleted'),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    private onAfterDelete(message: string): void {
        this.toast.success(message);
        this.fc?.refetchEvents();
        this.eventsChanged.emit();
    }

    private onEventDrop(arg: EventDropInfo): void {
        if (!this.canEdit() || arg.event.extendedProps['kind'] !== 'item') {
            arg.revert();
            return;
        }
        const canonicalId = (arg.event.extendedProps['originalItemId'] as string | undefined)
            ?? arg.event.id;
        const newStart = arg.event.start?.toISOString();
        const newEnd   = arg.event.end?.toISOString() ?? null;
        if (!newStart) {
            arg.revert();
            return;
        }
        // The user can drag an event from the all-day strip into the timed
        // grid (or back), in which case FullCalendar flips arg.event.allDay
        // on its own. Persisting the new flag matters because the editor /
        // toFcEvent path keys off it for the picker's All-day toggle and
        // for FC's row placement on the next refetch.
        const newAllDay = arg.event.allDay;

        // Phase 2 — recurring items prompt for scope ("only this" vs
        // "all events"). The recurrenceInstant is the PRE-drag start
        // time — FullCalendar exposes it via arg.oldEvent. Detection
        // keys off `seriesId` (non-null = part of a series); see
        // `toFcEvent` for why `recurrence` can't be used here.
        const seriesId = arg.event.extendedProps['seriesId'] as string | null | undefined;
        if (seriesId) {
            const instant = arg.oldEvent.start?.toISOString();
            if (!instant) {
                arg.revert();
                return;
            }
            this.promptScope({ intent: 'edit', itemTitle: arg.event.title }).then(scope => {
                if (scope === undefined) {
                    arg.revert();
                    return;
                }
                if (scope === 'this') {
                    this.persistOccurrenceMove(canonicalId, instant, newStart, newEnd, arg);
                } else if (scope === 'following') {
                    this.persistSeriesSplit(canonicalId, instant, newStart, newEnd, arg);
                } else {
                    this.persistCanonicalMove(canonicalId, { start: newStart, end: newEnd, allDay: newAllDay }, arg, 'rescheduled');
                }
            });
            return;
        }

        this.persistCanonicalMove(canonicalId, { start: newStart, end: newEnd, allDay: newAllDay }, arg, 'rescheduled');
    }

    private onEventResize(arg: EventResizeDoneInfo): void {
        if (!this.canEdit() || arg.event.extendedProps['kind'] !== 'item') {
            arg.revert();
            return;
        }
        const canonicalId = (arg.event.extendedProps['originalItemId'] as string | undefined)
            ?? arg.event.id;
        const newStart = arg.event.start?.toISOString();
        const newEnd   = arg.event.end?.toISOString();
        if (!newEnd) {
            arg.revert();
            return;
        }
        // Same allDay-sync as onEventDrop — see that handler for why.
        const newAllDay = arg.event.allDay;

        // Phase 2 — recurring items resize prompts for scope too.
        const seriesId = arg.event.extendedProps['seriesId'] as string | null | undefined;
        if (seriesId) {
            const instant = arg.oldEvent.start?.toISOString();
            if (!instant || !newStart) {
                arg.revert();
                return;
            }
            this.promptScope({ intent: 'edit', itemTitle: arg.event.title }).then(scope => {
                if (scope === undefined) {
                    arg.revert();
                    return;
                }
                if (scope === 'this') {
                    this.persistOccurrenceMove(canonicalId, instant, newStart, newEnd, arg);
                } else {
                    this.persistCanonicalMove(canonicalId, { end: newEnd, allDay: newAllDay }, arg, 'duration updated');
                }
            });
            return;
        }

        this.persistCanonicalMove(canonicalId, { end: newEnd, allDay: newAllDay }, arg, 'duration updated');
    }

    /**
     * Phase 2 — POST /exception for an "only this" drag/resize.
     * Persists a per-occurrence override row at the new times; the
     * series rule is untouched, and the iterator-merged occurrence
     * stream picks up the override on the next refetch.
     *
     * Refetch + emit — FC's optimistic update happens to land at the
     * right spot for this path (the override IS at the dragged time),
     * but a refetch keeps us aligned with backend state on race
     * conditions (e.g. server snapped to a different minute, or a
     * prior override on the same instant was replaced).
     */
    private persistOccurrenceMove(
        parentItemId: string,
        recurrenceInstant: string,
        newStart: string,
        newEnd: string | null,
        arg: { revert: () => void },
    ): void {
        this.api.createCalendarItemException(parentItemId, {
            recurrenceInstant,
            newStart,
            newEnd,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.toast.success('This occurrence updated');
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            },
            error: (err: unknown) => {
                this.toast.error(this.errors.humanize(err));
                arg.revert();
            },
        });
    }

    /**
     * Phase 3 — POST /split on a "this and following" drag/resize.
     * The server trims the base's RRULE at `recurrenceInstant` and
     * creates a NEW base item starting at `newStart`. Both halves
     * share the original `seriesId`. FC's optimistic update only
     * moved ONE event — the new base produces N occurrences, so we
     * MUST `refetchEvents()` to get the corrected stream from the
     * backend. `eventsChanged` is still emitted for any external
     * listeners (e.g. the topbar quick-panel).
     */
    private persistSeriesSplit(
        parentItemId: string,
        recurrenceInstant: string,
        newStart: string,
        newEnd: string | null,
        arg: { revert: () => void },
    ): void {
        this.api.splitCalendarItem(parentItemId, {
            recurrenceInstant,
            newStart,
            newEnd,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.toast.success('Series split at this occurrence');
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            },
            error: (err: unknown) => {
                this.toast.error(this.errors.humanize(err));
                arg.revert();
            },
        });
    }

    /**
     * Existing path — PATCH the canonical row. Used for non-recurring
     * items and "all events" scope on recurring drag/resize.
     *
     * Refetch + emit — for non-recurring items FC's optimistic update
     * is already correct; for "all events" on a recurring item the
     * whole series shifts so we MUST refetch to re-render the entire
     * occurrence stream.
     */
    private persistCanonicalMove(
        canonicalId: string,
        patch: { start?: string; end?: string | null; allDay?: boolean },
        arg: { revert: () => void },
        successVerb: 'rescheduled' | 'duration updated',
    ): void {
        this.api.updateCalendarItem(canonicalId, patch).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Event ${successVerb}`);
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            },
            error: (err: unknown) => {
                this.toast.error(this.errors.humanize(err));
                arg.revert();
            },
        });
    }

    private promptScope(data: ScopePromptDialogData): Promise<ScopePromptResult> {
        return new Promise(resolve => {
            this.dialog.open<ScopePromptResult>(ScopePromptDialogComponent, { data })
                .closed.pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(result => resolve(result));
        });
    }

    private onDatesSet(arg: DatesSetInfo): void {
        // Task — narrow FC's `string` view name to our typed union.
        // Anything outside the supported trio falls back to Month so the
        // toolbar pill never enters an undefined state (defensive — FC
        // shouldn't emit anything else given our plugin set).
        const viewType: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' =
            arg.view.type === 'timeGridWeek'
                ? 'timeGridWeek'
                : arg.view.type === 'timeGridDay'
                    ? 'timeGridDay'
                    : 'dayGridMonth';

        this.viewRangeChanged.emit({
            start:        arg.start,
            end:          arg.end,
            // First day of the displayed period — see the JSDoc on
            // `viewRangeChanged` above for why this is currentStart
            // and not activeStart.
            currentStart: arg.view.currentStart,
            currentEnd:   arg.view.currentEnd,
            viewType,
        });
    }

    openNewEventModal(): void {
        if (!this.canEdit()) return;
        this.openEditor({
            mode:        'create',
            calendarId:  this.calendar().id ?? '',
            calendarTz:  this.calendar().tz ?? 'UTC',
        });
    }

    private openEditor(data: CalendarEventEditorData): void {
        this.dialog.open<CalendarEventEditorResult>(CalendarEventEditorComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is CalendarEventEditorResult => Boolean(r)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(result => {
            if (result.action !== 'cancelled') {
                this.fc?.refetchEvents();
                this.eventsChanged.emit();
            }
        });
    }
}
