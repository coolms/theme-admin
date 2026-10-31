import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { Observable, of, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_PROBLEM_TYPE, ErrorHandlerService } from '@coolms/core-angular';
import { DateTimeFormatService, ToastService } from '@coolms/ui-angular';
import { UserEditDialogComponent } from './user-edit-dialog.component';
import { IdentityApiService } from './identity-api.service';
import { type IdentityUserDto } from './identity.types';

/**
 * An account is people's data, read in an elevated session only. Opened from the users list and refused for want of
 * elevation -- the elevation ended while the list was open -- the dialog shows the Elevate state in place of the form,
 * never the "Failed to load user" toast, and reads the account again after Elevate. Any other failure is the toast, as
 * before. The dialog is built directly, not rendered.
 */
describe('UserEditDialogComponent -- reading the account', () => {
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });

    let answers: Array<() => Observable<IdentityUserDto>>;
    let asked: number;
    let toasts: string[];

    function build(): UserEditDialogComponent {
        asked = 0;
        toasts = [];
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { userId: 'u1' } },
                { provide: DialogRef, useValue: { close: (): void => {} } },
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: DateTimeFormatService, useValue: { date: () => '', dateTime: () => '' } },
                { provide: ToastService, useValue: { error: (m: string) => toasts.push(m) } },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => '' } },
                {
                    provide: IdentityApiService,
                    useValue: { getUser: () => answers[Math.min(asked++, answers.length - 1)]() },
                },
            ],
        });

        const dialog = TestBed.runInInjectionContext(() => new UserEditDialogComponent());
        dialog.ngOnInit();

        return dialog;
    }

    it('shows the Elevate state in place of the form, not the toast', () => {
        answers = [() => throwError(stamped)];

        const dialog = build();

        expect(dialog.elevationRequired()).toBeTrue();
        expect(dialog.loadingUser()).toBeFalse();
        expect(toasts).toEqual([]);
    });

    it('reads the account again after Elevate, and shows it', () => {
        answers = [() => throwError(stamped), () => of({ id: 'u1', groups: [] } as unknown as IdentityUserDto)];
        const dialog = build();

        dialog.loadUser();

        expect(asked).toBe(2);
        expect(dialog.elevationRequired()).toBeFalse();
        expect(dialog.user()?.id).toBe('u1');
    });

    it('keeps the toast for any other failure', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 }))];

        const dialog = build();

        expect(dialog.elevationRequired()).toBeFalse();
        expect(toasts).toEqual(['Failed to load user']);
    });
});
