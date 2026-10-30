import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { Observable, of, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_PROBLEM_TYPE } from '@coolms/core-angular';
import { ConfirmDialogService, PageTitleService, RELOAD_PAGE, ToastService } from '@coolms/ui-angular';
import { GroupsListComponent } from './groups-list.component';
import { IdentityApiService } from './identity-api.service';
import { type IdentityGroupDto } from './identity.types';

/**
 * Groups are people's data, read in an elevated session only. A read refused for want of elevation puts the Elevate
 * state in place of the list, never the "Failed to load groups" toast; after Elevate the page is made anew where the
 * shell provides that, or else the list is read again. Any other failure is the toast, as before. Pages are built
 * directly, not rendered: only what construction reaches for is stubbed.
 */
describe('GroupsListComponent -- refused for want of elevation', () => {
    const FIRST = { offset: 0, sort: null, reset: true, columnFilters: [] as string[] };
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });

    let answers: Array<() => Observable<IdentityGroupDto[]>>;
    let asked: number;
    let toasts: string[];
    let reloaded: number;

    function build(withShell: boolean): GroupsListComponent {
        asked = 0;
        toasts = [];
        reloaded = 0;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: Dialog, useValue: {} },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: ToastService, useValue: { error: (m: string) => toasts.push(m) } },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
                {
                    provide: IdentityApiService,
                    useValue: { listGroups: () => answers[Math.min(asked++, answers.length - 1)]() },
                },
                ...(withShell ? [{ provide: RELOAD_PAGE, useValue: () => { reloaded++; } }] : []),
            ],
        });

        return TestBed.runInInjectionContext(() => new GroupsListComponent());
    }

    it('shows the Elevate state in place of the list, not the toast', () => {
        answers = [() => throwError(stamped)];
        const page = build(false);
        page.onLoadMore(FIRST);

        expect(page.elevationRequired()).toBeTrue();
        expect(toasts).toEqual([]);
    });

    it('reads the list again after Elevate, and shows it', () => {
        answers = [() => throwError(stamped), () => of([{ id: 'g1' } as IdentityGroupDto])];
        const page = build(false);
        page.onLoadMore(FIRST);

        page.loadAgain();

        expect(asked).toBe(2);
        expect(page.elevationRequired()).toBeFalse();
        expect(page.loaded()).toBeTrue();
    });

    it('makes the page anew after Elevate where the shell provides that', () => {
        answers = [() => throwError(stamped)];
        const page = build(true);
        page.onLoadMore(FIRST);

        page.loadAgain();

        expect(reloaded).toBe(1);
        expect(asked).toBe(1);
    });

    it('keeps the toast for any other failure', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 }))];
        const page = build(false);
        page.onLoadMore(FIRST);

        expect(page.elevationRequired()).toBeFalse();
        expect(toasts).toEqual(['Failed to load groups']);
    });
});
