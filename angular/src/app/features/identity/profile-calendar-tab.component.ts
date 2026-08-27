import { CommonModule, DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    Output,
    EventEmitter,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService, CalendarDto } from '../../api/api.service';
import {
    CalendarPrefs,
    LazySelectComponent,
    LazySelectOption,
    ToastService,
    UserCalendarPreferencesService,
} from '@coolms/ui-angular';

interface DateFormatChoice {
    readonly token: string;
    readonly label: string;
}

const DATE_FORMAT_CHOICES: ReadonlyArray<DateFormatChoice> = [
    { token: 'yyyy-MM-dd',   label: 'ISO 8601' },
    { token: 'dd/MM/yyyy',   label: 'European' },
    { token: 'MM/dd/yyyy',   label: 'US' },
    { token: 'dd MMM yyyy',  label: 'Short month' },
    { token: 'MMM d, yyyy',  label: 'Long' },
];

/**
 * Task #433 (M1.2.f.2) — bespoke "Calendar" tab inside My Profile.
 *
 * Renders the user's calendar preferences with a live date-format
 * preview, radio groups for binary choices (time format, week start),
 * a search-enabled timezone dropdown, and an async-loaded
 * "Default calendar" picker sourced from `api.listCalendars()`.
 *
 * Submits via `(saved)` to the parent (`ProfilePageComponent`), which
 * calls the same `updateSettings('calendar', payload)` endpoint that
 * the Preferences/Interface tabs already use. The parent also pushes
 * the merged values back into `UserCalendarPreferencesService` so the
 * topbar quick-access, mini-cal, FullCalendar config, event editor,
 * and quick panel all pick the change up immediately.
 *
 * Future-proof note: locale-related settings (number format, currency,
 * language) will land here when the i18n module ships; the placeholder
 * card at the bottom communicates that to the user.
 */
@Component({
    selector: 'app-profile-calendar-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, DatePipe, LazySelectComponent],
    styles: [`
        :host { display: block; }
        .group { display: flex; flex-direction: column; gap: 4px; }
        .group-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-width: 480px;
        }
        .group-label {
            font-size: .8rem;
            font-weight: 600;
            color: var(--cms-text, #111827);
        }
        .group-help {
            font-size: .75rem;
            color: var(--cms-text-muted, #6b7280);
            margin: 0;
        }
        .preview {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            background: #eef2ff;
            color: #1e3a8a;
            font-variant-numeric: tabular-nums;
            font-size: .8rem;
            margin-left: 6px;
        }

        select.form-select,
        input.form-control { max-width: 480px; }

        .radio-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }
        .radio-row label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            font-size: .85rem;
        }
        .radio-row input[type="radio"] { margin: 0; }

        .future-card {
            margin-top: 16px;
            padding: 12px 14px;
            border: 1px dashed var(--cms-border, #d1d5db);
            border-radius: 8px;
            color: var(--cms-text-muted, #6b7280);
            font-size: .8rem;
            background: var(--cms-bg-subtle, #f9fafb);
        }
        .future-card strong { color: var(--cms-text, #111827); }
    `],
    template: `
        <!-- Timezone — OptionSource ship: grouped picker fed by
             /api/v1/options/calendar.timezones (Region headers,
             type-search, single IANA value). Replaces the ungrouped
             ~75-entry static list that lived in iana-timezones.ts. -->
        <div class="group-row">
            <label class="group-label" for="cal-tz">Timezone</label>
            <app-lazy-select
                    [apiUrl]="'/api/v1/options/calendar.timezones'"
                    [value]="tz"
                    [valueKey]="'value'"
                    [groupKey]="'group'"
                    [labelKeys]="tzLabelKeys"
                    [pageSize]="600"
                    [entityLabel]="'timezone'"
                    [placeholder]="'UTC'"
                    (valueChange)="onTimezoneChange($event)" />
            <p class="group-help">
                Used by the calendar grid and event editor to interpret times.
            </p>
        </div>

        <!-- Date format -->
        <div class="group-row">
            <label class="group-label" for="cal-df">
                Date format
                <span class="preview">{{ today | date: dateFormat }}</span>
            </label>
            <select id="cal-df" class="form-select" [(ngModel)]="dateFormat">
                @for (c of dateFormatChoices; track c.token) {
                    <option [value]="c.token">{{ c.label }} — {{ today | date: c.token }}</option>
                }
            </select>
        </div>

        <!-- Time format -->
        <div class="group">
            <span class="group-label">Time format</span>
            <div class="radio-row">
                <label>
                    <input type="radio" name="cal-tf" value="12h" [(ngModel)]="timeFormat" />
                    12-hour ({{ sampleTime | date: 'h:mm a' }})
                </label>
                <label>
                    <input type="radio" name="cal-tf" value="24h" [(ngModel)]="timeFormat" />
                    24-hour ({{ sampleTime | date: 'HH:mm' }})
                </label>
            </div>
        </div>

        <!-- Week start -->
        <div class="group">
            <span class="group-label">Week starts on</span>
            <div class="radio-row">
                <label>
                    <input type="radio" name="cal-ws" value="monday" [(ngModel)]="weekStart" />
                    Monday (ISO)
                </label>
                <label>
                    <input type="radio" name="cal-ws" value="sunday" [(ngModel)]="weekStart" />
                    Sunday (US)
                </label>
            </div>
        </div>

        <!-- Default calendar — Task #441: lazy-select with debounced search -->
        <div class="group-row">
            <label class="group-label" for="cal-default">Default calendar</label>
            @if (loadingCalendars()) {
                <p class="group-help">Loading your calendars…</p>
            } @else {
                <app-lazy-select
                        [options]="defaultCalendarOptions()"
                        [value]="defaultCalendarSlug ?? ''"
                        [allowClear]="false"
                        [entityLabel]="'calendar'"
                        [placeholder]="'(Personal — ' + (personalSlugHint() || 'personal') + ')'"
                        (valueChange)="onDefaultCalendarChange($event)" />
            }
            <p class="group-help">
                Opens when you click the calendar icon in the top bar.
                Leave on "Personal" to use your private calendar.
            </p>
        </div>

        <!-- Future i18n placeholder -->
        <div class="future-card">
            <strong>Coming soon:</strong> language, number format, and currency
            preferences will move here when the i18n module ships.
        </div>
    `,
})
export class ProfileCalendarTabComponent implements OnInit {
    /** Initial values for the form. Provided by the parent. */
    initial = input<Partial<CalendarPrefs>>({});

    /** Whether the parent is currently persisting the form (disables submit). */
    saving = input<boolean>(false);

    /** Emitted when the user clicks Save changes (parent owns the network call). */
    @Output() saved = new EventEmitter<CalendarPrefs>();

    private readonly api    = inject(ApiService);
    private readonly toast  = inject(ToastService);
    private readonly prefs  = inject(UserCalendarPreferencesService);
    private readonly destroyRef = inject(DestroyRef);

    readonly dateFormatChoices  = DATE_FORMAT_CHOICES;
    /**
     * OptionResource label fallback chain for the timezone picker.
     * The backend exposes `label` (leaf city, e.g. "Berlin"); fall
     * back to `value` (full IANA id) so unknown rows still render.
     */
    readonly tzLabelKeys        = ['label', 'value'];
    readonly today              = new Date();
    /** A sample 14:30 timestamp so the AM/PM hint reads sensibly. */
    readonly sampleTime         = new Date(new Date().setHours(14, 30, 0, 0));

    readonly calendars        = signal<CalendarDto[]>([]);
    readonly loadingCalendars = signal<boolean>(true);

    // ngModel-bound fields. ngOnInit seeds them from `initial`.
    tz                  = 'UTC';
    dateFormat          = 'yyyy-MM-dd';
    timeFormat: '12h' | '24h' = '24h';
    weekStart:  'monday' | 'sunday' = 'monday';
    defaultCalendarSlug: string | null = null;

    /** Quick label that fills the "Personal" option hint with the resolved slug. */
    readonly personalSlugHint = computed(() => this.prefs.defaultCalendarSlug());

    /**
     * Task #441 — option projection for `<app-lazy-select>`.
     *
     * Prepends a synthetic "(Personal)" row so users can revert to the
     * personal-calendar default without scrolling. The lazy-select uses
     * `id` for both wire value and UI lookups, so the personal-slug
     * sentinel is the empty string (mapped back to `null` in
     * {@link onDefaultCalendarChange}).
     */
    readonly defaultCalendarOptions = computed<readonly LazySelectOption[]>(() => {
        const personalLabel = `(Personal — ${this.personalSlugHint() || 'personal'})`;
        const personal: LazySelectOption = { id: '', label: personalLabel };
        const rest: LazySelectOption[] = this.calendars()
            .filter(c => !!c.slug)
            .map(c => ({
                id:    c.slug!,
                label: c.label ? `${c.label} — ${c.slug}` : c.slug!,
            }));
        return [personal, ...rest];
    });

    ngOnInit(): void {
        const init = this.initial();
        this.tz                  = init.tz                  ?? this.tz;
        this.dateFormat          = init.dateFormat          ?? this.dateFormat;
        this.timeFormat          = init.timeFormat === '12h' ? '12h' : '24h';
        this.weekStart           = init.weekStart === 'sunday' ? 'sunday' : 'monday';
        this.defaultCalendarSlug = init.defaultCalendarSlug ?? null;

        this.api.listCalendars().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.calendars.set(rows);
                this.loadingCalendars.set(false);
            },
            error: () => {
                this.loadingCalendars.set(false);
                this.toast.error('Failed to load calendar list');
            },
        });
    }

    /**
     * Task #441 — bridge LazySelect's string-only valueChange to the
     * tristate `string | null` model used by the API. Empty string from
     * the lazy-select means "personal default".
     */
    onDefaultCalendarChange(slug: string): void {
        this.defaultCalendarSlug = slug === '' ? null : slug;
    }

    /**
     * OptionSource ship — guard the bound tz field against the picker
     * emitting an empty string (defensive: nothing actually clears the
     * trigger, but the form must always submit a concrete IANA id).
     */
    onTimezoneChange(value: string): void {
        if (value !== '') this.tz = value;
    }

    save(): void {
        this.saved.emit({
            tz:                  this.tz,
            dateFormat:          this.dateFormat,
            timeFormat:          this.timeFormat,
            weekStart:           this.weekStart,
            defaultCalendarSlug: this.defaultCalendarSlug,
        });
    }
}
