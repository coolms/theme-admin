import { inject, Injectable } from '@angular/core';
import { ElevationService } from '@coolms/core-angular';
import { DateTimeFormatService } from '@coolms/ui-angular';

/**
 * The one sentence both elevation surfaces render: when this elevation ends.
 *
 * The badge and the profile menu say the same thing in two places, which is
 * how two places start disagreeing. They do not each compute it -- they ask
 * this. Sharing the implementation is what prevents the drift; the spec that
 * compares them is the backstop for the day someone stops using it.
 *
 * A plain method rather than a `computed`, for the reason the badge
 * documents: an elevation ending is time passing, which invalidates no
 * dependency, and `ElevationService.state()` reports an elapsed grant as
 * expired on any read.
 */
@Injectable({ providedIn: 'root' })
export class ElevationDisplay {
    private readonly elevation = inject(ElevationService);
    private readonly dtf       = inject(DateTimeFormatService);

    /**
     * The clock time the live elevation ends at, in the person's own timezone
     * and 12h/24h preference -- or null when there is nothing to say.
     */
    until(): string | null {
        const state = this.elevation.state();
        if (state === null || state.elevated !== true) return null;

        const iso = state.expiresAt;
        if (iso === null || iso === undefined || iso === '') return null;

        const shown = this.dtf.time(iso);

        return shown === '' ? null : shown;
    }
}
