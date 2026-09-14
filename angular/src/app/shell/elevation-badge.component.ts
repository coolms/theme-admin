import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ElevationService } from '@coolms/core-angular';
import { ConfirmDialogService, DateTimeFormatService } from '@coolms/ui-angular';

/**
 * "Elevated until 14:47" in the topbar while the session is elevated, with
 * the hover note the elevation design asks for: the elevation ends at that time OR
 * when the panel is closed or reloaded. Clicking it drops the elevation now.
 *
 * Renders nothing while not elevated: the state that matters to an
 * unelevated person is the prompt's, and it says why it is asking.
 *
 * One read on init, so a tab that opens elevated (a sibling granted it)
 * shows it; after that the service moves the badge -- a grant, a drop from
 * anywhere, another tab's announcement, and the grant simply running out.
 *
 * That last one is why `until` is a plain method rather than a `computed`: a
 * cached derivation is recomputed when a dependency changes, and nothing
 * changes when time passes. The service reports an elapsed grant as expired
 * on any read of its state, so this asks it again rather than keeping the
 * answer it was given while the grant was still live.
 */
@Component({
    selector: 'app-elevation-badge',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (until(); as until) {
            <button type="button"
                    class="cms-badge cms-badge--warning eb-badge"
                    [title]="'Ends at ' + until + ', or when you close or reload the panel. Click to end it now.'"
                    (click)="drop()">
                <i class="bi bi-shield-lock-fill"></i>
                Elevated until {{ until }}
            </button>
        }
    `,
    styles: [`
        .eb-badge     { cursor: pointer; border: 0; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .eb-badge i   { font-size: .85em; }
    `],
})
export class ElevationBadgeComponent implements OnInit {
    private readonly elevation = inject(ElevationService);
    private readonly confirm   = inject(ConfirmDialogService);
    private readonly dtf       = inject(DateTimeFormatService);

    /**
     * The clock time the current elevation ends at, or null when not elevated.
     *
     * Through {@link DateTimeFormatService}, not `toLocaleTimeString([])`. The
     * bare call takes the BROWSER's locale and the BROWSER's timezone, so it
     * rendered `01:47 AM` to someone whose profile says 24h -- and 12-hour
     * time on a fifteen-minute grant is not a cosmetic error: `01:47` read as
     * 13:47 says the elevation has twelve more hours to run.
     */
    readonly until = (): string | null => {
        const state = this.elevation.state();
        if (!state?.elevated || !state.expiresAt) return null;

        return this.dtf.time(state.expiresAt) || null;
    };

    ngOnInit(): void {
        if (this.elevation.available) {
            this.elevation.refresh().subscribe({ error: () => undefined });
        }
    }

    drop(): void {
        this.confirm.open({
            title:        'End elevation now?',
            message:      'Actions the mode bits forbid will ask for the admin password again.',
            confirmLabel: 'End elevation',
            cancelLabel:  'Keep it',
        }).subscribe(yes => {
            if (yes) this.elevation.drop('dropped_by_user').subscribe({ error: () => undefined });
        });
    }
}
