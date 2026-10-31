import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Observable, of, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_PROBLEM_TYPE, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { CollectionDistributionDialogComponent } from './collection-distribution-dialog.component';
import { type CollectionDistribution, CollectionService } from './collection.service';

/**
 * The distribution dialog reads the collection's settings. A read refused for want of elevation is the Elevate state
 * in place of the editor, read again after Elevate; any other failure keeps its reason in the body with Retry, never
 * a toast. Until a read succeeds nothing is offered for saving: settings never read are not "no distribution". The
 * dialog is built directly, not rendered.
 */
describe('CollectionDistributionDialogComponent -- reading the settings', () => {
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });
    const read: CollectionDistribution = { isCollection: true, enabledChannels: ['rss'], channelConfig: {} };

    let answers: Array<() => Observable<CollectionDistribution>>;
    let asked: number;
    let toasts: string[];

    function build(): CollectionDistributionDialogComponent {
        asked = 0;
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { path: '/content/site/blog' } },
                { provide: DialogRef, useValue: { close: (): void => {} } },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => 'refused' } },
                {
                    provide: CollectionService,
                    useValue: { getDistribution: () => answers[Math.min(asked++, answers.length - 1)]() },
                },
            ],
        });

        const dialog = TestBed.runInInjectionContext(() => new CollectionDistributionDialogComponent());
        dialog.ngOnInit();

        return dialog;
    }

    const state = (d: CollectionDistributionDialogComponent) => ({
        loaded: d.loaded(),
        elevate: d.elevationRequired(),
        failed: d.loadFailure() !== null,
    });

    it('holds any other failure in the body, not a toast, and offers nothing to save', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        answers = [() => throwError(() => failure)];

        const dialog = build();

        expect(asked).toBe(1);
        expect(dialog.loadFailure()).withContext('the failure is held for the body').toBe(failure);
        expect(dialog.loadFailureText()).toBe('refused');
        expect(state(dialog)).toEqual({ loaded: false, elevate: false, failed: true });
        expect(toasts).withContext('no toast for a failed read').toEqual([]);
    });

    it('Retry asks again, and a read that succeeds clears the failure and offers the save', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 })), () => of(read)];
        const dialog = build();

        dialog.load();

        expect(asked).withContext('Retry asked the API again').toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failed: false });
        expect(dialog.enabledChannels()).toEqual(['rss']);
        expect(toasts).toEqual([]);
    });

    it('shows the Elevate state for a stamped 403, offers nothing to save, and reads again after Elevate', () => {
        answers = [() => throwError(stamped), () => of(read)];
        const dialog = build();

        expect(state(dialog)).toEqual({ loaded: false, elevate: true, failed: false });
        expect(toasts).toEqual([]);

        dialog.load();

        expect(asked).toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failed: false });
    });
});
