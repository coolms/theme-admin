import { Dialog } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { filter, switchMap } from 'rxjs/operators';

import {
    ApiService,
    CalendarDto,
    HolidayRuleDto,
    WeekdayHoursDto,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    LazySelectComponent,
    LazySelectOption,
    TimeOfDayPickerComponent,
    ToastService,
    UserCalendarPreferencesService,
} from '@coolms/ui-angular';
import { CalendarSharesCardComponent } from './calendar-shares-card.component';
import { HolidayRuleFormComponent, HolidayRuleFormData } from './holiday-rule-form.component';

type SettingsTab = 'settings' | 'hours' | 'rules' | 'shares';

interface HoursInterval {
    from: string;   // HH:MM 24-hour wall-clock
    till: string;   // HH:MM 24-hour wall-clock
}

/**
 * One weekday's working intervals. An EMPTY `intervals` array means the
 * day is non-working (closed). Several intervals model a split shift /
 * lunch break (e.g. Mon 09:00–12:00 + Mon 13:00–17:00).
 *
 * The backend `WorkingHours` VO already persists a flat
 * `{day,from,till}[]` wire list that round-trips repeated `day` entries,
 * so this maps 1:1 with NO reshaping loss. The previous editor keyed a
 * `Map` by `day` on load and pushed one row per weekday on save, silently
 * DROPPING every interval after the first — opening + re-saving a
 * calendar that had a lunch break destroyed it. This grouped model fixes
 * that.
 */
interface WeekdayGroup {
    day:       WeekdayHoursDto['day'];
    label:     string;
    intervals: HoursInterval[];
}

const WEEKDAYS: ReadonlyArray<{ day: WeekdayHoursDto['day']; label: string }> = [
    { day: 'MO', label: 'Mon' },
    { day: 'TU', label: 'Tue' },
    { day: 'WE', label: 'Wed' },
    { day: 'TH', label: 'Thu' },
    { day: 'FR', label: 'Fri' },
    { day: 'SA', label: 'Sat' },
    { day: 'SU', label: 'Sun' },
];

/**
 * — Calendar settings slide-over panel content.
 *
 * Rendered inside the global right-side drawer via DrawerService.
 * Single panel, four tabs: Settings, Working Hours, Holiday Rules,
 * Shares — each section corresponds to one of the 4 cards from the
 * previous layout, now consolidated so the main viewport is
 * dedicated to the calendar grid itself.
 *
 * Inputs:
 *   - `calendar`      — current CalendarDto
 *   - `allCalendars`  — list for the parent dropdown
 *   - `canEdit`       — settings + working hours + rules require write access
 *   - `canManageShares` — shares tab requires owner / admin
 *
 * Emits `calendarChanged` after any mutation so the parent can refresh
 * its local copy (e.g., refetch events when tz changes).
 */
@Component({
    selector: 'app-calendar-settings-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, CalendarSharesCardComponent, LazySelectComponent, TimeOfDayPickerComponent],
    template: `
        <div class="panel">
            <nav class="tabs" role="tablist">
                <button type="button" role="tab"
                        [class.tabs__btn--active]="activeTab() === 'settings'"
                        (click)="setTab('settings')">
                    <i class="bi bi-sliders"></i> Settings
                </button>
                <button type="button" role="tab"
                        [class.tabs__btn--active]="activeTab() === 'hours'"
                        (click)="setTab('hours')">
                    <i class="bi bi-clock"></i> Hours
                </button>
                <button type="button" role="tab"
                        [class.tabs__btn--active]="activeTab() === 'rules'"
                        (click)="setTab('rules')">
                    <i class="bi bi-calendar-event"></i> Holidays
                </button>
                <button type="button" role="tab"
                        [class.tabs__btn--active]="activeTab() === 'shares'"
                        (click)="setTab('shares')">
                    <i class="bi bi-share"></i> Shares
                </button>
            </nav>

            @switch (activeTab()) {

                @case ('settings') {
                    <section class="tab-body">
                        <label class="field">
                            <span class="field__label">Label</span>
                            <input type="text" [(ngModel)]="settingsLabel" />
                        </label>
                        <label class="field">
                            <span class="field__label">Timezone</span>
                            <!-- OptionSource ship — grouped picker fed by
                                 /api/v1/options/calendar.timezones, replacing
                                 the ungrouped static list. Region headers +
                                 type-search; the wire value stays an IANA id. -->
                            <app-lazy-select
                                    [apiUrl]="'/api/v1/options/calendar.timezones'"
                                    [value]="settingsTz"
                                    [valueKey]="'value'"
                                    [groupKey]="'group'"
                                    [labelKeys]="tzLabelKeys"
                                    [pageSize]="600"
                                    [entityLabel]="'timezone'"
                                    [placeholder]="'UTC'"
                                    (valueChange)="settingsTz = $event || 'UTC'" />
                        </label>
                        <label class="field">
                            <span class="field__label">Parent calendar</span>
                            <!-- Task — lazy-select with debounced search.
                                 Uses static options (parent already preloaded
                                 the list); future ships with thousands of
                                 calendars can switch to apiUrl mode without
                                 changing the surrounding form. -->
                            <app-lazy-select
                                    [options]="parentCalendarOptions()"
                                    [value]="settingsParentId"
                                    [allowClear]="true"
                                    [entityLabel]="'calendar'"
                                    [placeholder]="'— None —'"
                                    (valueChange)="settingsParentId = $event" />
                        </label>
                        <div class="tab-actions">
                            <button type="button" class="cms-btn cms-btn-primary cms-btn-sm"
                                    [disabled]="!canEdit() || savingSettings()"
                                    (click)="onSaveSettings()">
                                <i class="bi bi-save"></i> Save settings
                            </button>
                        </div>
                        @if (settingsError()) {
                            <p class="error">{{ settingsError() }}</p>
                        }
                    </section>
                }

                @case ('hours') {
                    <section class="tab-body">
                        <p class="hint">
                            Pick the days this calendar treats as working hours.
                            Add more than one interval per day for a split shift
                            or lunch break (e.g. 09:00–12:00 and 13:00–17:00).
                            Intervals on a day must not overlap; back-to-back
                            (12:00 / 12:00) is fine. For a night shift that ends
                            the next morning, set “Till” earlier than “From”
                            (e.g. 22:00–06:00) — it’s tagged
                            <span class="overnight-tag"><i class="bi bi-moon-stars"></i> +1 day</span>.
                        </p>
                        <div class="hours-list">
                            @for (group of weekdayGroups(); track group.day) {
                                <div class="day-block"
                                     [class.day-block--closed]="group.intervals.length === 0">
                                    <div class="day-block__head">
                                        <label class="day-toggle">
                                            <input type="checkbox"
                                                   [checked]="group.intervals.length > 0"
                                                   [disabled]="!canEdit()"
                                                   (change)="toggleWorking(group.day, $any($event.target).checked)" />
                                            <span class="weekday">{{ group.label }}</span>
                                        </label>
                                        @if (group.intervals.length > 0) {
                                            <button type="button" class="cms-btn cms-btn-link cms-btn-sm"
                                                    [disabled]="!canEdit()"
                                                    (click)="addInterval(group.day)">
                                                <i class="bi bi-plus-lg"></i> Add interval
                                            </button>
                                        } @else {
                                            <span class="closed-tag">Closed</span>
                                        }
                                    </div>
                                    @if (group.intervals.length > 0) {
                                        <div class="intervals">
                                            @for (iv of group.intervals; track $index) {
                                                <div class="interval-row">
                                                    <!-- Preference-aware time control (24h/12h per the
                                                         user's timeFormat setting), shared with the range
                                                         pickers. Replaces the native <input type=time>,
                                                         whose AM/PM display followed the BROWSER locale and
                                                         ignored the CoolMS preference. Canonical value stays
                                                         24h HH:mm on the wire. -->
                                                    <cms-time-of-day-picker
                                                            [value]="iv.from"
                                                            [step]="5"
                                                            [disabled]="!canEdit()"
                                                            (valueChange)="updateIntervalTime(group.day, $index, 'from', $event)" />
                                                    <span class="dash">–</span>
                                                    <cms-time-of-day-picker
                                                            [value]="iv.till"
                                                            [step]="5"
                                                            [disabled]="!canEdit()"
                                                            (valueChange)="updateIntervalTime(group.day, $index, 'till', $event)" />
                                                    @if (isOvernight(iv)) {
                                                        <span class="overnight-tag"
                                                              title="This shift ends the next morning ({{ iv.till }} the day after).">
                                                            <i class="bi bi-moon-stars"></i> +1 day
                                                        </span>
                                                    }
                                                    <button type="button"
                                                            class="btn-icon btn-icon--danger"
                                                            title="Remove interval"
                                                            [disabled]="!canEdit()"
                                                            (click)="removeInterval(group.day, $index)">
                                                        <i class="bi bi-x-lg"></i>
                                                    </button>
                                                </div>
                                            }
                                        </div>
                                    }
                                </div>
                            }
                        </div>
                        <div class="tab-actions">
                            <button type="button" class="cms-btn cms-btn-primary cms-btn-sm"
                                    [disabled]="!canEdit() || savingHours()"
                                    (click)="onSaveWorkingHours()">
                                <i class="bi bi-save"></i> Save hours
                            </button>
                        </div>
                        @if (hoursError()) {
                            <p class="error">{{ hoursError() }}</p>
                        }
                    </section>
                }

                @case ('rules') {
                    <section class="tab-body">
                        <div class="rules-head">
                            <span class="hint">
                                {{ rules().length }} rule{{ rules().length === 1 ? '' : 's' }}
                            </span>
                            <button type="button" class="cms-btn cms-btn-link cms-btn-sm"
                                    [disabled]="!canEdit()"
                                    (click)="onAddHolidayRule()">
                                <i class="bi bi-plus-lg"></i> Add
                            </button>
                        </div>
                        @if (rules().length === 0) {
                            <p class="empty">No holiday rules defined.</p>
                        } @else {
                            <ul class="list">
                                @for (rule of rules(); track rule.id) {
                                    <li class="list__row">
                                        <div class="list__main">
                                            <span class="badge badge--type">{{ rule.type }}</span>
                                            <span class="list__label">{{ rule.label }}</span>
                                            @if (rule.isWorking) {
                                                <span class="badge badge--working">working</span>
                                            }
                                            @if (rule.weekendAdjustment !== null && rule.weekendAdjustment !== undefined && rule.weekendAdjustment !== 0) {
                                                <span class="badge badge--shift">shift {{ rule.weekendAdjustment > 0 ? '+1' : '-1' }}</span>
                                            }
                                        </div>
                                        <div class="actions">
                                            <button type="button" class="btn-icon"
                                                    [disabled]="!canEdit()"
                                                    title="Edit"
                                                    (click)="onEditHolidayRule(rule)">
                                                <i class="bi bi-pencil"></i>
                                            </button>
                                            <button type="button" class="btn-icon btn-icon--danger"
                                                    [disabled]="!canEdit()"
                                                    title="Delete"
                                                    (click)="onDeleteHolidayRule(rule)">
                                                <i class="bi bi-trash"></i>
                                            </button>
                                        </div>
                                    </li>
                                }
                            </ul>
                        }
                    </section>
                }

                @case ('shares') {
                    <section class="tab-body tab-body--shares">
                        @if (calendar().slug) {
                            <app-calendar-shares-card
                                    [calendarSlug]="calendar().slug!"
                                    [canManage]="canManageShares()" />
                        }
                    </section>
                }
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .panel {
            display: flex;
            flex-direction: column;
            gap: 12px;
            font-size: .85rem;
        }
        .tabs {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 2px;
            background: var(--cms-surface-muted);
            border-radius: var(--cms-radius, 6px);
            padding: 2px;
        }
        .tabs button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 6px 4px;
            font-size: .72rem;
            font-weight: 500;
            border: 0;
            background: transparent;
            border-radius: var(--cms-radius-sm, 4px);
            color: var(--cms-text-muted, #848b96);
            cursor: pointer;
            line-height: 1;
        }
        .tabs button i { font-size: .9rem; }
        .tabs button:hover { color: var(--cms-text); }
        .tabs__btn--active {
            background: var(--cms-surface, #fff) !important;
            color: var(--cms-text) !important;
            box-shadow: var(--cms-shadow-sm, 0 1px 3px rgba(0,0,0,.08));
        }

        .tab-body { display: flex; flex-direction: column; gap: 10px; }
        .tab-body--shares { padding: 0; }
        .tab-body--shares ::ng-deep .card { border: 0; }
        .tab-body--shares ::ng-deep .card__head { display: none; }
        .tab-body--shares ::ng-deep .card__body { padding: 0; }

        .field { display: flex; flex-direction: column; gap: 4px; }
        .field__label { font-size: .72rem; color: var(--cms-text-muted, #848b96); font-weight: 500; }
        .field input, .field select {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            padding: 5px 8px;
            font-size: .85rem;
            background: var(--cms-surface, #fff);
        }
        .tab-actions { display: flex; justify-content: flex-end; padding-top: 4px; }

        .hint { color: var(--cms-text-muted, #848b96); font-size: .75rem; margin: 0; }
        .error { color: var(--cms-danger, #dc2626); margin: 4px 0 0; font-size: .8rem; }
        .empty { color: var(--cms-text-muted, #848b96); margin: 0; font-size: .8rem; }

        .hours-list { display: flex; flex-direction: column; gap: 6px; }
        .day-block {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 5px;
            padding: 6px 8px;
            background: var(--cms-surface, #fff);
        }
        .day-block--closed { background: var(--cms-surface-muted); }
        .day-block__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .day-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; }
        .weekday { font-weight: 600; }
        .closed-tag { font-size: .68rem; color: var(--cms-text-muted, #848b96); text-transform: uppercase; letter-spacing: .03em; }
        .intervals { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-left: 22px; }
        /* The time-of-day pickers are wider than the old native inputs
           (2–3 selects each), so allow the row to wrap in the narrow
           settings drawer rather than overflow. */
        .interval-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
        .interval-row .dash { color: var(--cms-text-muted, #848b96); }
        .overnight-tag {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px 6px;
            border-radius: var(--cms-radius-md, 8px);
            font-size: .62rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .02em;
            background: var(--cms-meta-subtle);
            color: var(--cms-meta-text);
            white-space: nowrap;
        }
        .overnight-tag i { font-size: .72rem; }
        .hint .overnight-tag { text-transform: none; letter-spacing: 0; }

        .rules-head { display: flex; justify-content: space-between; align-items: center; }
        .list { list-style: none; margin: 0; padding: 0; }
        .list__row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 6px 0;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
        }
        .list__row:last-child { border-bottom: 0; }
        .list__main { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
        .list__label { font-size: .8rem; overflow: hidden; text-overflow: ellipsis; }
        .actions { display: flex; gap: 2px; flex-shrink: 0; }

        .badge {
            display: inline-flex;
            padding: 1px 5px;
            border-radius: var(--cms-radius-md, 8px);
            font-size: .6rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        .badge--type { background: var(--cms-meta-subtle); color: var(--cms-meta-text); }
        .badge--working { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .badge--shift { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }

        .btn-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border: 0;
            background: transparent;
            border-radius: 3px;
            color: var(--cms-text-muted, #848b96);
            cursor: pointer;
        }
        .btn-icon:hover { background: var(--cms-surface-muted); color: var(--cms-text); }
        .btn-icon:disabled { opacity: .5; cursor: not-allowed; }
        .btn-icon--danger:hover { color: var(--cms-danger-text); background: var(--cms-danger-light); }
    `],
})
export class CalendarSettingsPanelComponent implements OnInit {
    private readonly api        = inject(ApiService);
    private readonly dialog     = inject(Dialog);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly userPrefs  = inject(UserCalendarPreferencesService);

    /**
     * OptionResource label fallback chain for the timezone picker.
     * Backend exposes `label` (leaf city, e.g. "Berlin"); falling
     * through to `value` keeps display sensible if the leaf isn't
     * present.
     */
    readonly tzLabelKeys = ['label', 'value'];

    calendar         = input.required<CalendarDto>();
    allCalendars     = input<readonly CalendarDto[]>([]);
    canEdit          = input<boolean>(false);
    canManageShares  = input<boolean>(false);
    /** Initially-active tab (default: 'settings'). Lets the gear button
     *  jump directly to e.g. 'hours' if the caller wants. */
    initialTab       = input<SettingsTab>('settings');

    /**
     * Callback inputs (not Angular `output()` signals) — the panel is
     * rendered via `*ngComponentOutlet` with `inputs:`, which can't
     * subscribe to EventEmitters from outside. Plain function inputs
     * sidestep that limitation.
     */
    onCalendarChanged = input<(c: CalendarDto) => void>(() => undefined);
    onRulesChanged    = input<() => void>(() => undefined);

    readonly activeTab = signal<SettingsTab>('settings');

    readonly otherCalendars = computed(() => {
        const me = this.calendar();
        return this.allCalendars().filter(c => c.id !== me.id);
    });

    /** Task — option projection consumed by `<app-lazy-select>`. */
    readonly parentCalendarOptions = computed<readonly LazySelectOption[]>(() =>
        this.otherCalendars()
            .filter(c => !!c.id)
            .map(c => ({
                id:    c.id!,
                label: `${c.label || c.slug || c.id} (${c.slug ?? c.id})`,
            })),
    );

    readonly rules = signal<HolidayRuleDto[]>([]);

    // Settings form state
    settingsLabel    = '';
    settingsTz       = 'UTC';
    settingsParentId = '';
    readonly savingSettings = signal(false);
    readonly settingsError  = signal<string | null>(null);

    // Working hours form state. Empty `intervals` = non-working day, the
    // WorkingHours "no working hours = closed" default.
    readonly weekdayGroups = signal<WeekdayGroup[]>(WEEKDAYS.map(w => ({
        day:       w.day,
        label:     w.label,
        intervals: [],
    })));
    readonly savingHours = signal(false);
    readonly hoursError  = signal<string | null>(null);

    ngOnInit(): void {
        this.activeTab.set(this.initialTab());
        this.hydrate(this.calendar());
        this.loadRules();
    }

    setTab(tab: SettingsTab): void {
        this.activeTab.set(tab);
    }

    private hydrate(cal: CalendarDto): void {
        this.settingsLabel    = cal.label ?? '';
        // Task — Pre-select existing calendar's TZ when editing,
        // fall back to userPrefs.tz (then UTC) for newly-minted rows
        // where the entity hasn't been hydrated yet.
        this.settingsTz       = cal.tz ?? this.userPrefs.tz() ?? 'UTC';
        this.settingsParentId = cal.parentId ?? '';

        // Group ALL intervals per weekday (a day repeats in the flat wire
        // list for split shifts) — the previous Map-by-day kept only the
        // last, silently dropping lunch breaks on load. Sort each day's
        // intervals chronologically for a stable display.
        const byDay = new Map<WeekdayHoursDto['day'], HoursInterval[]>();
        for (const h of cal.workingHours ?? []) {
            const list = byDay.get(h.day) ?? [];
            list.push({ from: h.from, till: h.till });
            byDay.set(h.day, list);
        }
        this.weekdayGroups.set(WEEKDAYS.map(w => ({
            day:   w.day,
            label: w.label,
            intervals: (byDay.get(w.day) ?? [])
                .slice()
                .sort((a, b) => a.from.localeCompare(b.from)),
        })));
    }

    private loadRules(): void {
        const slug = this.calendar().slug;
        if (!slug) return;
        this.api.listHolidayRules(slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => this.rules.set(rows),
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /** Turn a day on (seed one default interval) or off (clear all). */
    toggleWorking(day: WeekdayHoursDto['day'], working: boolean): void {
        this.weekdayGroups.update(groups =>
            groups.map(g => {
                if (g.day !== day) return g;
                const intervals = working
                    ? (g.intervals.length > 0 ? g.intervals : [{ from: '09:00', till: '17:00' }])
                    : [];
                return { ...g, intervals };
            }));
    }

    addInterval(day: WeekdayHoursDto['day']): void {
        this.weekdayGroups.update(groups =>
            groups.map(g => {
                if (g.day !== day) return g;
                // Default an additional interval to the afternoon so the
                // canonical lunch-break split (09:00–12:00 + 13:00–17:00) is
                // one click; save-time validation guides the admin if it
                // happens to overlap what's already there.
                const seed = g.intervals.length > 0
                    ? { from: '13:00', till: '17:00' }
                    : { from: '09:00', till: '17:00' };
                return { ...g, intervals: [...g.intervals, seed] };
            }));
    }

    removeInterval(day: WeekdayHoursDto['day'], index: number): void {
        this.weekdayGroups.update(groups =>
            groups.map(g => g.day === day
                ? { ...g, intervals: g.intervals.filter((_, i) => i !== index) }
                : g));
    }

    updateIntervalTime(day: WeekdayHoursDto['day'], index: number, field: 'from' | 'till', value: string): void {
        this.weekdayGroups.update(groups =>
            groups.map(g => g.day === day
                ? { ...g, intervals: g.intervals.map((iv, i) => i === index ? { ...iv, [field]: value } : iv) }
                : g));
    }

    /**
     * True when this interval wraps past midnight (`till < from`, e.g.
     * 22:00–06:00 = ends the next morning). Mirrors the backend
     * `WeekdayHours::crossesMidnight()`. Both fields must be set and
     * unequal; a zero-length `till === from` is not overnight (and is
     * rejected on save). HH:MM is zero-padded, so string `<` is the
     * correct ordering.
     */
    isOvernight(iv: HoursInterval): boolean {
        return !!iv.from && !!iv.till && iv.till < iv.from;
    }

    onSaveSettings(): void {
        const slug = this.calendar().slug;
        if (!slug) return;
        this.savingSettings.set(true);
        this.settingsError.set(null);

        const patch = {
            label:    this.settingsLabel.trim(),
            tz:       this.settingsTz.trim(),
            parentId: this.settingsParentId === '' ? null : this.settingsParentId,
        } as Partial<CalendarDto>;

        this.api.updateCalendar(slug, patch).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cal => {
                this.savingSettings.set(false);
                this.hydrate(cal);
                this.toast.success('Settings saved');
                this.onCalendarChanged()(cal);
            },
            error: (err: unknown) => {
                this.savingSettings.set(false);
                this.settingsError.set(this.errors.humanize(err));
            },
        });
    }

    onSaveWorkingHours(): void {
        const slug = this.calendar().slug;
        if (!slug) return;
        this.hoursError.set(null);

        const wh: WeekdayHoursDto[] = [];
        for (const group of this.weekdayGroups()) {
            // Mirror the backend WorkingHours invariants client-side so the
            // admin gets an inline message instead of a 422. Sort a COPY by
            // `from` so the overlap check compares adjacent intervals;
            // windows are half-open [from,till), so adjacency (12:00/12:00)
            // is allowed but any true overlap is rejected. HH:MM is
            // zero-padded, so string comparison is the correct ordering.
            //
            // `till < from` is an OVERNIGHT interval (e.g. 22:00–06:00) that
            // wraps past midnight — its morning portion belongs to the NEXT
            // calendar day (backend WeekdayHours::crossesMidnight). Only a
            // ZERO-length window (`till === from`) is rejected. Overnight
            // intervals opt out of the same-day overlap check: a weekday-only
            // view can't reason about the next-day spill, mirroring the
            // backend's `overlaps()` returning false when either crosses
            // midnight (the calculator merges concrete ranges defensively).
            const sorted = [...group.intervals].sort((a, b) => a.from.localeCompare(b.from));
            let prev: HoursInterval | null = null;
            for (const iv of sorted) {
                if (!iv.from || !iv.till) {
                    this.hoursError.set(`Set both From and Till for each ${group.label} interval, or remove it.`);
                    return;
                }
                if (iv.till === iv.from) {
                    this.hoursError.set(`On ${group.label}, "From" and "Till" cannot be equal (${iv.from}). For a night shift that ends the next day, set "Till" earlier than "From" (e.g. 22:00–06:00).`);
                    return;
                }
                if (prev !== null && !this.isOvernight(iv) && !this.isOvernight(prev) && iv.from < prev.till) {
                    this.hoursError.set(`On ${group.label}, working intervals overlap. Adjust them so they don't overlap (back-to-back like 12:00 / 12:00 is fine).`);
                    return;
                }
                prev = iv;
                wh.push({ day: group.day, from: iv.from, till: iv.till });
            }
        }

        this.savingHours.set(true);
        this.api.updateCalendar(slug, { workingHours: wh }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cal => {
                this.savingHours.set(false);
                this.hydrate(cal);
                this.toast.success('Working hours saved');
                this.onCalendarChanged()(cal);
            },
            error: (err: unknown) => {
                this.savingHours.set(false);
                this.hoursError.set(this.errors.humanize(err));
            },
        });
    }

    onAddHolidayRule(): void {
        const cal = this.calendar();
        if (!cal.id) return;
        this.openHolidayRuleDialog({ mode: 'create', calendarId: cal.id, existingRules: this.rules() });
    }

    onEditHolidayRule(rule: HolidayRuleDto): void {
        const cal = this.calendar();
        if (!cal.id) return;
        this.openHolidayRuleDialog({
            mode: 'edit',
            calendarId: cal.id,
            rule,
            existingRules: this.rules(),
        });
    }

    private openHolidayRuleDialog(data: HolidayRuleFormData): void {
        this.dialog.open<HolidayRuleDto | undefined>(HolidayRuleFormComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.loadRules();
            this.onRulesChanged()();
        });
    }

    onDeleteHolidayRule(rule: HolidayRuleDto): void {
        if (!rule.id) return;
        this.confirmSvc.confirmDelete(rule.label ?? 'rule').pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteHolidayRule(rule.id!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Rule "${rule.label}" deleted`);
                this.loadRules();
                this.onRulesChanged()();
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }
}
