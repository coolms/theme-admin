import {
    ChangeDetectionStrategy, Component, DestroyRef, OnInit, Output, EventEmitter, computed, effect, inject, input,
    signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CalendarDto } from '../calendars/calendars.types';
import { CalendarsApiService } from '../calendars/calendars-api.service';
import {
    CalendarPrefs,
    LazySelectComponent,
    LazySelectOption,
    StateComponent,
    UserCalendarPreferencesService,
} from '@coolms/ui-angular';
import { NaviGraphService } from '@coolms/core-angular';
import { navOffers } from '../../shell/nav-offers';

/**
 * Task () -- bespoke "Calendar" tab inside My Profile.
 *
 * The "Default calendar" picker, sourced from `calendarsApi.listCalendars()`.
 *
 * Submits via `(saved)` to the parent (`ProfilePageComponent`), which
 * calls the same `updateSettings('calendar', payload)` endpoint that
 * every section's form uses. The parent also pushes
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
    imports: [StateComponent, LazySelectComponent],
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
            color: var(--cms-text-muted, #69707c);
            margin: 0;
        }
        .preview {
            display: inline-block;
            padding: 2px 8px;
            border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-meta-subtle);
            color: var(--cms-info-text);
            font-variant-numeric: tabular-nums;
            font-size: .8rem;
            margin-left: 6px;
        }

        select.form-select,
        input.form-control { max-width: 480px; }


    `],
    template: `
        <!-- Default calendar — Task : lazy-select with debounced search. Only where the account's navigation
             offers Calendar: the list is the calendar group's (Dmitry, 2026-10-06), and outside it the request is
             refused. -->
        @if (offered()) {
        <div class="group-row">
            <label class="group-label" for="cal-default">Default calendar</label>
            @if (loadingCalendars()) {
                <p class="group-help">Loading your calendars…</p>
            } @else if (calendarsFailure() !== null) {
                <!-- A failed read of the calendar list stands in place of the picker, with Retry. -->
                <cms-state kind="error" title="Failed to load calendar list" [error]="calendarsFailure()" actionLabel="Retry" (acted)="loadCalendars()" />
            } @else {
                <app-lazy-select
                        [options]="defaultCalendarOptions()"
                        [value]="defaultCalendarSlug ?? ''"
                        [allowClear]="false"
                        [entityLabel]="'calendar'"
                        [placeholder]="'Personal calendar'"
                        (valueChange)="onDefaultCalendarChange($event)" />
            }
            <p class="group-help">
                Opens when you click the calendar icon in the top bar.
                Leave on "Personal calendar" to use your private calendar.
            </p>
        </div>
        }
    `,
})
export class ProfileCalendarTabComponent implements OnInit {
    /** Initial values for the form. Provided by the parent. */
    initial = input<Partial<CalendarPrefs>>({});

    /** Whether the parent is currently persisting the form (disables submit). */
    saving = input<boolean>(false);

    /** Emitted when the user clicks Save changes (parent owns the network call). */
    @Output() saved = new EventEmitter<Pick<CalendarPrefs, 'defaultCalendarSlug'>>();
    private readonly calendarsApi = inject(CalendarsApiService);
    private readonly prefs  = inject(UserCalendarPreferencesService);
    private readonly destroyRef = inject(DestroyRef);

    /** Calendar's item in the admin navigation, as the server answered it to this account. */
    readonly offered = navOffers(inject(NaviGraphService).adminNav, '/api/v1/calendar');
    private calendarsAsked = false;

    constructor() {
        // The list is asked once, and only once Calendar is offered: the navigation may load after this tab.
        effect(() => {
            if (this.offered() && !this.calendarsAsked) {
                this.calendarsAsked = true;
                untracked(() => this.loadCalendars());
            }
        });
    }


    readonly calendars        = signal<CalendarDto[]>([]);
    readonly loadingCalendars = signal<boolean>(true);
    /** Why the calendar list could not be read; null once it was. The banner shows it in place of the picker. */
    readonly calendarsFailure = signal<unknown>(null);

    // ngOnInit seeds it from `initial`.
    defaultCalendarSlug: string | null = null;

    /**
     * Task -- option projection for `<app-lazy-select>`.
     *
     * Prepends a "Personal calendar" row so users can revert to the
     * personal-calendar default without scrolling, in place of that calendar's
     * own row. A row shows a name: a slug or an id means nothing to a person.
     * The lazy-select uses
     * `id` for both wire value and UI lookups, so the personal-slug
     * sentinel is the empty string (mapped back to `null` in
     * {@link onDefaultCalendarChange}).
     */
    readonly defaultCalendarOptions = computed<readonly LazySelectOption[]>(() => {
        const personal: LazySelectOption = { id: '', label: 'Personal calendar' };
        const rest: LazySelectOption[] = this.calendars()
            .filter(c => !!c.slug && !(c.isDefaultPersonal && c.currentUserAccess === 'owned'))
            .map(c => ({
                id:    c.slug!,
                label: c.label || 'Untitled calendar',
            }));
        return [personal, ...rest];
    });

    ngOnInit(): void {
        const init = this.initial();
        this.defaultCalendarSlug = init.defaultCalendarSlug ?? null;

        // Offered already (the usual case: the layout loaded the navigation first): asked now. The effect above
        // asks it when the navigation arrives later.
        if (this.offered() && !this.calendarsAsked) {
            this.calendarsAsked = true;
            this.loadCalendars();
        }
    }

    /** The calendar list read, the first time or again from the banner's Retry. */
    loadCalendars(): void {
        this.loadingCalendars.set(true);
        this.calendarsFailure.set(null);
        this.calendarsApi.listCalendars().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.calendars.set(rows);
                this.loadingCalendars.set(false);
            },
            error: (err: unknown) => {
                this.calendarsFailure.set(err);
                this.loadingCalendars.set(false);
            },
        });
    }

    /**
     * Task -- bridge LazySelect's string-only valueChange to the
     * tristate `string | null` model used by the API. Empty string from
     * the lazy-select means "personal default".
     */
    onDefaultCalendarChange(slug: string): void {
        this.defaultCalendarSlug = slug === '' ? null : slug;
    }

    save(): void {
        this.saved.emit({ defaultCalendarSlug: this.defaultCalendarSlug });
    }
}
