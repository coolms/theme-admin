import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable, of, throwError } from 'rxjs';
import { ComponentRegistry, ThemeService } from '@coolms/core-angular';
import { PageTitleService, ToastService, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { IdentityApiService } from './identity-api.service';
import { type IdentityUserDto } from './identity.types';
import { ProfilePageComponent } from './profile-page.component';

/**
 * My Profile reads the account, its settings sections and its settings together. A failed read is held for the error
 * banner in place of the profile form, never a toast; the banner's Retry reads them again, and a read that then
 * succeeds clears the failure. The page is built directly, not rendered.
 */
describe('ProfilePageComponent -- a failed read of the profile', () => {
    let answers: Array<() => Observable<IdentityUserDto>>;
    let asked: number;
    let toasts: string[];

    function build(): ProfilePageComponent {
        asked = 0;
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: IdentityApiService,
                    useValue: {
                        getMe: () => answers[Math.min(asked++, answers.length - 1)](),
                        getSettingsSections: () => of([]),
                        getSettings: () => of({}),
                    },
                },
                { provide: Store, useValue: { selectSnapshot: () => null, dispatch: () => of(null) } },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
                { provide: UserCalendarPreferencesService, useValue: { update: (): void => {} } },
                { provide: ThemeService, useValue: {} },
                { provide: ComponentRegistry, useValue: { has: () => false } },
            ],
        });

        return TestBed.runInInjectionContext(() => new ProfilePageComponent());
    }

    it('holds the failure for the banner, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        const me = { id: 'u1', identifier: 'ann@example.com', firstName: 'Ann' } as IdentityUserDto;
        answers = [() => throwError(() => failure), () => of(me)];
        const page = build();

        page.ngOnInit();

        expect(asked).withContext('the load asked the API').toBe(1);
        expect(page.loadFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        page.load();

        expect(asked).withContext('Retry asked the API again').toBe(2);
        expect(page.loadFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(page.user()).toBe(me);
        expect(toasts).toEqual([]);
    });
});
