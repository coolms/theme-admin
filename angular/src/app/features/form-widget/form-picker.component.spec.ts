import { DialogRef } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { FormService } from '../forms/form.service';
import { FormPickerComponent } from './form-picker.component';

/**
 * The form picker filters as the person types. `filtered` is a computed, and it read the
 * filter as a plain field: a computed re-runs only when a signal it read changes, so the list
 * kept its first answer whatever was typed (the 2026-09-28 sweep). The spec types and reads
 * the PAGE.
 */
describe('FormPickerComponent', () => {
    let fixture: ComponentFixture<FormPickerComponent>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            imports: [FormPickerComponent],
            providers: [
                { provide: FormService, useValue: { listForms: () => of([{ id: 'contact-us' }, { id: 'newsletter' }]) } },
                { provide: DialogRef, useValue: { close: () => undefined } },
            ],
        });
        fixture = TestBed.createComponent(FormPickerComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    const items = (): string[] =>
        [...(fixture.nativeElement as HTMLElement).querySelectorAll('.fp__id')].map(e => e.textContent?.trim() ?? '');

    it('narrows the list to the forms that match what is typed', async () => {
        expect(items()).withContext('both forms before any filter').toEqual(['contact-us', 'newsletter']);
        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.fp__search')!;
        input.value = 'news';
        input.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        fixture.detectChanges();
        expect(items()).toEqual(['newsletter']);
    });
});
