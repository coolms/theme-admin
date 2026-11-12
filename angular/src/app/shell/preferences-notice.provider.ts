import { inject, type Provider } from '@angular/core';
import { PREFERENCES_NOTICE, type PreferencesNoticePort } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

/**
 * Binds core's `PREFERENCES_NOTICE` port: the server refused to store the person's interface preferences (a 422).
 * An error toast says so in the sentence core wrote ("Your preferences could not be saved: ..."), once while it is
 * on screen.
 */
export class PreferencesNoticeToast implements PreferencesNoticePort {
    private readonly toast = inject(ToastService);

    refused(sentence: string): void {
        this.toast.show({ type: 'error', message: sentence, groupKey: 'preferences-refused' }, 8000);
    }
}

export function providePreferencesNotice(): Provider[] {
    return [{ provide: PREFERENCES_NOTICE, useClass: PreferencesNoticeToast }];
}
