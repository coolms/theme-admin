import { inject, Injectable } from '@angular/core';
import { ElevationService } from '@coolms/core-angular';
import { ConfirmDialogService } from '@coolms/ui-angular';

/**
 * Ending an elevation, asked for in one place.
 *
 * Two surfaces offer it -- the topbar badge and the profile menu's session
 * line -- and the words matter: they tell the person what they lose. Written
 * twice they would drift, and the one that drifted would be the one nobody
 * read again. So the sentence lives here and both callers ask this.
 *
 * It does NOT decide anything: the server drops the elevation and the state
 * endpoint is still the only source of what happened afterwards. This is a
 * dialog and a DELETE, nothing more.
 */
@Injectable({ providedIn: 'root' })
export class EndElevationAction {
    private readonly elevation = inject(ElevationService);
    private readonly confirm   = inject(ConfirmDialogService);

    /** Ask, and drop if the answer is yes. Errors are swallowed: the state endpoint stays the truth. */
    run(): void {
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
