import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ElevationService } from '@coolms/core-angular';
import { ElevationDisplay } from './elevation-display.service';
import { EndElevationAction } from './end-elevation.action';

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
            <!-- The separator belongs to the badge, not to the topbar: it must
                 appear and vanish with the badge, and one element owning both
                 is why a stray divider cannot be left behind in the icon run. -->
            <span class="eb-sep" aria-hidden="true"></span>
            <button type="button"
                    class="cms-badge cms-badge--session eb-badge"
                    [title]="'Ends at ' + until + ', or when you close or reload the panel. Click to end it now.'"
                    (click)="drop()">
                <i class="bi bi-shield-lock-fill"></i>
                Elevated until {{ until }}
            </button>
        }
    `,
    styles: [`
        :host         { display: contents; }
        .eb-sep       { width: 1px; height: 20px; margin: 0 2px; background: var(--cms-border-light); display: inline-block; vertical-align: middle; }
        .eb-badge     { cursor: pointer; border: 0; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .eb-badge i   { font-size: .85em; }
        /* Appearing is the event worth noticing. Expiry needs no animation of
           its own: the badge VANISHES, which the eye catches without help --
           and an interval kept only to restyle a final minute would put back
           the timer this path deliberately has none of. */
        .eb-badge     { animation: eb-in 180ms ease-out; }
        @keyframes eb-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .eb-badge { animation: none; } }
    `],
})
export class ElevationBadgeComponent implements OnInit {
    private readonly elevation = inject(ElevationService);
    private readonly display   = inject(ElevationDisplay);
    private readonly end       = inject(EndElevationAction);

    /**
     * The clock time the current elevation ends at, or null when not elevated.
     *
     * Asked of {@link ElevationDisplay}, which the profile menu also asks, so
     * the two surfaces cannot drift. It formats through the estate's seam and
     * not `toLocaleTimeString([])`: the bare call takes the BROWSER's locale
     * and the BROWSER's timezone, so it rendered `01:47 AM` to someone whose
     * profile says 24h -- and on a fifteen-minute grant that is not cosmetic,
     * because `01:47` read as 13:47 says it has twelve more hours to run.
     */
    readonly until = (): string | null => this.display.until();

    ngOnInit(): void {
        if (this.elevation.available) {
            this.elevation.refresh().subscribe({ error: () => undefined });
        }
    }

    drop(): void {
        this.end.run();
    }
}
