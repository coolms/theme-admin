import { TestBed } from '@angular/core/testing';
import { PREFERENCES_NOTICE } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { providePreferencesNotice } from './preferences-notice.provider';

/** A refusal to store the person's preferences is an error toast in core's sentence, one while it is on screen. */
describe('providePreferencesNotice', () => {
    it('shows the sentence as an error toast, and a second refusal replaces it rather than stacking', () => {
        TestBed.configureTestingModule({ providers: [providePreferencesNotice()] });
        const notice = TestBed.inject(PREFERENCES_NOTICE);
        const toasts = TestBed.inject(ToastService);

        notice.refused('Your preferences could not be saved: Nothing was stored.');
        notice.refused('Your preferences could not be saved: Nothing was stored.');

        expect(toasts.toasts().map(t => [t.type, t.message])).toEqual([
            ['error', 'Your preferences could not be saved: Nothing was stored.'],
        ]);
        toasts.toasts().forEach(t => toasts.dismiss(t.id));
    });
});
