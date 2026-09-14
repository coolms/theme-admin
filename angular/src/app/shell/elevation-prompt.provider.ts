import { inject, type Provider } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { map, type Observable } from 'rxjs';
import { ELEVATION_PROMPT, type ElevationPromptPort, type ElevationPromptRequest } from '@coolms/core-angular';
import { ElevationPromptDialogComponent } from './elevation-prompt-dialog.component';

/**
 * Binds core's `ELEVATION_PROMPT` port to the admin's dialog.
 *
 * Core decides WHEN to ask (a 403 on a gated URL while the server says
 * unelevated) and shares one in-flight question; this is the HOW -- a CDK
 * dialog in the platform modal chrome. The dialog closes with `true` once the
 * server has elevated the session; a close by any other means (Cancel, Esc,
 * backdrop) is `false`, and the refused action stays refused.
 */
class ElevationPromptDialogPort implements ElevationPromptPort {
    private readonly dialog = inject(Dialog);

    open(request: ElevationPromptRequest): Observable<boolean> {
        return this.dialog.open<boolean, ElevationPromptRequest>(ElevationPromptDialogComponent, {
            data: request,
            // Esc and the backdrop close it as a decline; a person who lost
            // their place to a prompt can always leave it.
            disableClose: false,
        }).closed.pipe(map(result => result === true));
    }
}

export function provideElevationPrompt(): Provider {
    return { provide: ELEVATION_PROMPT, useClass: ElevationPromptDialogPort };
}
