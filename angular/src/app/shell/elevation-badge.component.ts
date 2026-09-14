import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { ElevationService } from '@coolms/core-angular';
import { ConfirmDialogService } from '@coolms/ui-angular';

/**
 * "Elevated until 14:47" in the topbar while the session is elevated, with
 * the hover note ADR-184 s.8 asks for: the elevation ends at that time OR
 * when the panel is closed or reloaded. Clicking it drops the elevation now.
 *
 * Renders nothing while not elevated: the state that matters to an
 * unelevated person is the prompt's, and it says why it is asking.
 *
 * One read on init, so a tab that opens elevated (a sibling granted it)
 * shows it; after that the service moves the badge -- a grant, a drop from
 * anywhere, the expiry read at `expiresAt`, another tab's announcement.
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

    /** The clock time the current elevation ends at, or null when not elevated. */
    readonly until = computed<string | null>(() => {
        const at = this.elevation.expiresAt();
        return this.elevation.elevated() && at
            ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;
    });

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
