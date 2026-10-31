import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Observable, of, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_PROBLEM_TYPE, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { GroupRoleGrantsDialogComponent } from './group-role-grants-dialog.component';
import { IdentityApiService } from './identity-api.service';
import { type IdentityGroupDto } from './identity.types';

/**
 * A group's role grants are people's data, read in an elevated session only. A read refused for want of elevation
 * puts the Elevate state in place of the editor, never the toast, and the grants are read again after Elevate. Any
 * other failure keeps its reason in the body with Retry, never a toast, and then nothing is offered for saving: grants
 * never read are not "grants nothing", and saving them would clear every edge. The dialog is built directly, not
 * rendered.
 */
describe('GroupRoleGrantsDialogComponent -- reading the grants', () => {
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });

    let answers: Array<() => Observable<IdentityGroupDto>>;
    let asked: number;
    let toasts: string[];

    function build(): GroupRoleGrantsDialogComponent {
        asked = 0;
        toasts = [];
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { id: 'g1', name: 'editors', role: 'ROLE_EDITORS' } },
                { provide: DialogRef, useValue: { close: (): void => {} } },
                { provide: ToastService, useValue: { error: (m: string) => toasts.push(m) } },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => 'refused' } },
                {
                    provide: IdentityApiService,
                    useValue: { getGroup: () => answers[Math.min(asked++, answers.length - 1)]() },
                },
            ],
        });

        const dialog = TestBed.runInInjectionContext(() => new GroupRoleGrantsDialogComponent());
        dialog.ngOnInit();

        return dialog;
    }

    const state = (d: GroupRoleGrantsDialogComponent) => ({
        loaded: d['loaded'](),
        elevate: d['elevationRequired'](),
        failure: d['loadFailureText'](),
        granted: d['granted'](),
    });
    const failed = () => new HttpErrorResponse({ status: 500 });
    const read = () => of({ id: 'g1', grantsGroupIds: ['g2'] } as IdentityGroupDto);

    it('shows the Elevate state in place of the editor, not the toast, and offers nothing to save', () => {
        answers = [() => throwError(stamped)];

        const dialog = build();

        expect(state(dialog)).toEqual({ loaded: false, elevate: true, failure: '', granted: [] });
        expect(toasts).toEqual([]);
    });

    it('reads the grants again after Elevate, and shows them', () => {
        answers = [() => throwError(stamped), read];
        const dialog = build();

        dialog['loadGrants']();

        expect(asked).toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failure: '', granted: ['g2'] });
    });

    it('keeps any other failure in the body, not a toast, and offers nothing to save over grants never read', () => {
        answers = [() => throwError(failed)];

        const dialog = build();

        expect(state(dialog)).toEqual({ loaded: false, elevate: false, failure: 'refused', granted: [] });
        expect(toasts).toEqual([]);
    });

    it('reads the grants again from Retry, and a success clears the failure', () => {
        answers = [() => throwError(failed), read];
        const dialog = build();

        dialog['loadGrants']();

        expect(asked).toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failure: '', granted: ['g2'] });
    });
});
