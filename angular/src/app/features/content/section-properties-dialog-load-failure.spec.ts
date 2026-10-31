import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ELEVATION_REQUIRED_PROBLEM_TYPE, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';
import { type CollectionSettings, CollectionService } from './collection.service';
import { PageService } from './page.service';
import { SectionPropertiesDialogComponent } from './section-properties-dialog.component';

/**
 * The section properties dialog reads the section's own settings for its Section tab. A read refused for want of
 * elevation is the Elevate state in that tab, read again after Elevate; any other failure keeps its reason in that
 * tab's body with Retry, never a toast. Until a read succeeds the Section tab offers nothing for saving. The Page
 * properties tab reads its own endpoint and stays as it is: a failed section read does not take it over. The dialog
 * is built directly, not rendered.
 */
describe('SectionPropertiesDialogComponent -- reading the section settings', () => {
    const stamped = () => new HttpErrorResponse({ status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE } });
    const settings: CollectionSettings = {
        collectionType: 'blog', postContentType: '', requiresReview: false, sidebarNav: false, isCollection: true,
    };

    let answers: Array<() => Observable<CollectionSettings>>;
    let asked: number;
    let localesAsked: number;
    let toasts: string[];

    function build(): SectionPropertiesDialogComponent {
        asked = 0;
        localesAsked = 0;
        toasts = [];
        const recordToast = (m: string): void => { toasts.push(m); };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { path: '/content/site/blog', siteSlug: 'site' } },
                {
                    provide: DialogRef,
                    useValue: {
                        close: (): void => {},
                        disableClose: false,
                        backdropClick: new Subject<MouseEvent>(),
                        keydownEvents: new Subject<KeyboardEvent>(),
                    },
                },
                { provide: ToastService, useValue: { error: recordToast, success: recordToast } },
                { provide: ErrorHandlerService, useValue: { humanize: (): string => 'refused' } },
                { provide: ConfirmDialogService, useValue: {} },
                {
                    provide: CollectionService,
                    useValue: {
                        getSettings: () => answers[Math.min(asked++, answers.length - 1)](),
                        getDistribution: () => of({ isCollection: true, enabledChannels: [], channelConfig: {} }),
                        listChannels: () => of([]),
                    },
                },
                { provide: PageService, useValue: { listPageTypes: () => of([]) } },
                {
                    provide: HttpClient,
                    useValue: {
                        get: () => {
                            localesAsked++;
                            return of({ member: [{ value: 'en', label: 'English' }] });
                        },
                    },
                },
            ],
        });

        const dialog = TestBed.runInInjectionContext(() => new SectionPropertiesDialogComponent());
        dialog.ngOnInit();

        return dialog;
    }

    const state = (d: SectionPropertiesDialogComponent) => ({
        loaded: d['loaded'](),
        elevate: d['elevationRequired'](),
        failed: d['loadFailure']() !== null,
    });

    /** The Page properties part: its tab is offered, the site's languages were read once, the tab is not moved. */
    const pageProperties = (d: SectionPropertiesDialogComponent) => ({
        offered: d['hasPageProperties'](),
        locales: d['locales']().map(l => l.code),
        tab: d['tab'](),
    });

    it('holds any other failure in the Section tab, not a toast, and offers no Section save', () => {
        const failure = new HttpErrorResponse({ status: 500 });
        answers = [() => throwError(() => failure)];

        const dialog = build();

        expect(asked).toBe(1);
        expect(dialog['loadFailure']()).withContext('the failure is held for the Section tab').toBe(failure);
        expect(dialog['loadFailureText']()).toBe('refused');
        expect(state(dialog)).toEqual({ loaded: false, elevate: false, failed: true });
        expect(toasts).withContext('no toast for a failed read').toEqual([]);
    });

    it('leaves the Page properties part in place after a failed section read', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 }))];

        const dialog = build();

        expect(state(dialog).failed).toBeTrue();
        expect(pageProperties(dialog)).toEqual({ offered: true, locales: ['en'], tab: 'section' });
        expect(localesAsked).toBe(1);
    });

    it('Retry asks again, a read that succeeds clears the failure, and the Page properties are not read again', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 })), () => of(settings)];
        const dialog = build();

        dialog['loadSection']();

        expect(asked).withContext('Retry asked the API again').toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failed: false });
        expect(dialog['isCollection']()).toBeTrue();
        expect(localesAsked).toBe(1);
        expect(toasts).toEqual([]);
    });

    it('shows the Elevate state for a stamped 403, offers no Section save, and reads again after Elevate', () => {
        answers = [() => throwError(stamped), () => of(settings)];
        const dialog = build();

        expect(state(dialog)).toEqual({ loaded: false, elevate: true, failed: false });
        expect(pageProperties(dialog)).toEqual({ offered: true, locales: ['en'], tab: 'section' });
        expect(toasts).toEqual([]);

        dialog['loadSection']();

        expect(asked).toBe(2);
        expect(state(dialog)).toEqual({ loaded: true, elevate: false, failed: false });
    });
});
