import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';

import { DrawerService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { CalendarQuickPanelComponent } from './calendar-quick-panel.component';

/**
 * / / Task — Personal calendar quick-access icon
 * button for the admin topbar. Opens the `CalendarQuickPanelComponent`
 * in the global right drawer (mini-cal + upcoming events). The button
 * no longer navigates directly to the full Calendar Detail page — the
 * drawer panel offers an "Open full" link for that.
 *
 * Slug resolution (Task ): the slug now comes from
 * `UserCalendarPreferencesService.defaultCalendarSlug()`, which falls
 * back to `personal-{currentUserId}` (the canonical personal-calendar
 * slug minted by `PersonalCalendarSeeder` on user creation,)
 * when the user has not explicitly chosen a different default.
 *
 * Hidden when no user is in scope (e.g., login-page render before
 * AuthState hydrates) — the prefs service returns `null` for the slug
 * in that case.
 *
 * Styling mirrors the notification bell (rounded pill, white-on-dark)
 * so the topbar's right-side actions read as a consistent cluster.
 */
@Component({
    selector: 'app-calendar-quick-access',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (slug()) {
            <button type="button"
                    class="btn btn-sm position-relative text-white"
                    style="background: rgba(255,255,255,.08);
                           border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px"
                    title="My Calendar"
                    aria-label="My Calendar"
                    (click)="openPanel()">
                <i class="bi bi-calendar3" style="font-size:.9rem"></i>
            </button>
        }
    `,
})
export class CalendarQuickAccessComponent implements OnInit {
    private readonly drawer    = inject(DrawerService);
    private readonly userPrefs = inject(UserCalendarPreferencesService);

    /** User's chosen default calendar, or `personal-{uid}` fallback. */
    readonly slug = computed<string | null>(() => this.userPrefs.defaultCalendarSlug());

    ngOnInit(): void {
        // Kick off the prefs load if no consumer has yet — this avoids the
        // topbar reading "Personal" before the saved default lands.
        this.userPrefs.ensureLoaded().subscribe({ error: () => { /* defaults take over */ } });
    }

    openPanel(): void {
        const s = this.slug();
        if (!s) return;
        this.drawer.open(
            CalendarQuickPanelComponent,
            { personalCalendarSlug: s },
            'Calendar',
        );
    }
}
