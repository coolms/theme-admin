import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { Observable, of, throwError } from 'rxjs';
import { ConfirmDialogService, PageTitleService, ToastService } from '@coolms/ui-angular';
import { ThemesListComponent } from './themes-list.page';
import { type ThemeDto, ThemesService } from './themes.service';

/**
 * The Themes list holds a failed read of the themes for the error banner in place of the list, never a toast or a
 * line of text; the banner's Retry reads them again, and a read that then succeeds clears the failure. The page is
 * built directly, not rendered; its construction runs the first read.
 */
describe('ThemesListComponent -- a failed read of the themes', () => {
    let answers: Array<() => Observable<ThemeDto[]>>;
    let asked: number;
    let toasts: string[];

    function build(): ThemesListComponent {
        asked = 0;
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ThemesService,
                    useValue: {
                        listThemes: () => answers[Math.min(asked++, answers.length - 1)](),
                        listSections: () => of([]),
                    },
                },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: Dialog, useValue: {} },
                { provide: PageTitleService, useValue: { set: (): void => {} } },
            ],
        });

        return TestBed.runInInjectionContext(() => new ThemesListComponent());
    }

    it('holds the failure for the banner, Retry asks again, a success clears it', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        answers = [() => throwError(() => failure), () => of([{ id: 'base' } as ThemeDto])];

        const page = build();

        expect(asked).withContext('the load asked the API').toBe(1);
        expect(page.loadFailure()).withContext('the failure is held for the banner').toBe(failure);
        expect(page.loading()).toBeFalse();
        expect(toasts).withContext('no toast for a failed load').toEqual([]);

        page.load();

        expect(asked).withContext('Retry asked the API again').toBe(2);
        expect(page.loadFailure()).withContext('a load that succeeds clears the failure').toBeNull();
        expect(page.themes().map(t => t.id)).toEqual(['base']);
        expect(toasts).toEqual([]);
    });
});
