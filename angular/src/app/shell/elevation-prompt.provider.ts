import { inject, type Provider } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { map, type Observable } from 'rxjs';
import {
    ELEVATION_NOTICE, ELEVATION_PROMPT, ElevationService,
    type ElevationNoticePort, type ElevationPromptPort, type ElevationPromptRequest,
} from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { ElevationPromptDialogComponent } from './elevation-prompt-dialog.component';

/**
 * Binds core's `ELEVATION_PROMPT` port to the admin's dialog.
 *
 * The dialog opens only when a person asks for elevation: an Elevate button (a section's inline
 * state, the notice below), or a control that already knows its action needs it. Core shares one
 * in-flight question; this is the HOW -- a CDK dialog in the platform modal chrome. The dialog
 * closes with `true` once the server has elevated the session; a close by any other means (Cancel,
 * Esc, backdrop) is `false`.
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

/**
 * Binds core's `ELEVATION_NOTICE` port: a write the person made was refused for want of elevation.
 * A toast says so, with the server's sentence, and offers Elevate; only that click opens the dialog.
 * The refused action is not repeated by itself -- after elevating, the person repeats it.
 */
class ElevationNoticeToast implements ElevationNoticePort {
    private readonly toast     = inject(ToastService);
    private readonly elevation = inject(ElevationService);

    refused(refusal: string): void {
        this.toast.show({
            type:    'warning',
            title:   'This needs an elevated session',
            message: refusal,
            action:  {
                label: 'Elevate',
                run:   () => this.elevation.offerFor(refusal).subscribe(),
            },
        }, 12000);
    }
}

export function provideElevationPrompt(): Provider[] {
    return [
        { provide: ELEVATION_PROMPT, useClass: ElevationPromptDialogPort },
        { provide: ELEVATION_NOTICE, useClass: ElevationNoticeToast },
    ];
}
