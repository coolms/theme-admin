import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Store } from '@ngxs/store';
import { of, Subject } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { LazySelectComponent } from '@coolms/ui-angular';
import { ScheduleFormDialogComponent } from './schedule-form-dialog.component';
import { SchedulesApiService } from './schedules-api.service';

/**
 * The New Schedule dialog draws what is set outside its template.
 *
 * Angular 22 renders it OnPush, and three of its values lived in plain fields (Dmitry's
 * sweep, 2026-09-28): the spec the trigger sub-dialog returns, the trigger kind and the
 * handler. Each spec does what the person does -- choose, type, configure, pick -- and reads
 * the PAGE after, so it holds whatever the component keeps its state in. The control is in
 * the second: typing a cron spec (a template event) does draw its summary, so this
 * instrument sees a change an event makes, and a missing one is the component's.
 */
describe('ScheduleFormDialogComponent', () => {
    let fixture: ComponentFixture<ScheduleFormDialogComponent>;
    let closed: Subject<string | undefined>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            imports: [ScheduleFormDialogComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: SchedulesApiService,
                    useValue: {
                        listScheduledHandlers: () => of([
                            { key: 'report', label: 'Daily report', description: 'Sends the daily report' },
                        ]),
                    },
                },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
                // The pickers read the access token for their own requests; nobody is signed in here.
                { provide: Store, useValue: { selectSnapshot: () => null } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                // The trigger sub-dialog: each opening answers on its own `closed`, later.
                { provide: Dialog, useValue: { open: () => ({ closed: (closed = new Subject()) }) } },
            ],
        });
        fixture = TestBed.createComponent(ScheduleFormDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const settle = async (): Promise<void> => {
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();
    };
    const specInput = (): HTMLInputElement => page().querySelector<HTMLInputElement>('.spec-row input')!;
    const summary = (): string | null => page().querySelector('.spec-row ~ .cms-field-hint')?.textContent?.trim() ?? null;
    const chooseKind = async (kind: 'cron' | 'rrule'): Promise<void> => {
        const select = page().querySelector<HTMLSelectElement>('select.cms-select')!;
        select.value = kind;
        select.dispatchEvent(new Event('change'));
        await settle();
    };
    const type = async (value: string): Promise<void> => {
        specInput().value = value;
        specInput().dispatchEvent(new Event('input'));
        await settle();
    };
    const configure = async (returned: string): Promise<void> => {
        page().querySelector<HTMLButtonElement>('.spec-row__configure')!.click();
        await settle();
        closed.next(returned);
        await settle();
    };

    it('shows every spec the trigger sub-dialog returns, in RRule mode', async () => {
        await chooseKind('rrule');
        await type('RRULE:FREQ=DAILY');
        await configure('RRULE:FREQ=WEEKLY;BYDAY=MO');
        expect(specInput().value).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO');
        await configure('RRULE:FREQ=MONTHLY;BYMONTHDAY=1');
        expect(specInput().value).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=1');
    });

    it('drops the cron summary when the kind switches to RRule', async () => {
        await type('0 9 * * 1-5');
        expect(summary()).withContext('the control: typing a cron spec draws its summary').toBeTruthy();
        await chooseKind('rrule');
        expect(summary()).toBeNull();
    });

    it('shows the description of the handler picked', async () => {
        const pickers = fixture.debugElement.queryAll(By.directive(LazySelectComponent));
        const handlerPicker = pickers[pickers.length - 1].componentInstance as LazySelectComponent;
        handlerPicker.valueChange.emit('report');
        await settle();
        expect(page().textContent).toContain('Sends the daily report');
    });
});
