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
 * The dialog opens when a person's write is refused for want of elevation -- above whatever they are
 * in, an edit dialog included, which stays open beneath it -- and when they ask: an Elevate button (a
 * section's inline state, the notice below). Core shares one in-flight question and sends the refused
 * write again on a grant; this is the HOW -- a CDK dialog in the platform modal chrome. The dialog
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
 * Binds core's `ELEVATION_NOTICE` port: a write the person made was refused for want of elevation, and
 * they declined the prompt (or none could open). A toast says so -- "Elevation required", naming the
 * action (decided 2026-10-20) -- and offers Elevate. That write is not sent again; after elevating,
 * the person repeats it.
 */
class ElevationNoticeToast implements ElevationNoticePort {
    private static readonly TITLE = 'Elevation required';
    /** The sentence the client writes when the server's own says nothing more than "denied". */
    private static readonly GENERIC = 'This needs an elevated session.';

    private readonly toast     = inject(ToastService);
    private readonly elevation = inject(ElevationService);

    refused(refusal: string, action?: string): void {
        // The action first, in the person's words; the server's sentence after it when it says more.
        const message = action
            ? `${action} needs an elevated session.` + (refusal === ElevationNoticeToast.GENERIC ? '' : ` ${refusal}`)
            : refusal;
        // One notice per sentence while it is on screen: a request that repeats on a debounce (a
        // preview as the person types) would otherwise stack one toast per refusal.
        const shown = this.toast.toasts().some(t => t.title === ElevationNoticeToast.TITLE && t.message === message);
        if (shown) {
            return;
        }
        this.toast.show({
            type:    'warning',
            title:   ElevationNoticeToast.TITLE,
            message,
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
