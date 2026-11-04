import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { CheckboxFieldWidgetComponent, ToastService } from '@coolms/ui-angular';
import { IdentityApiService } from '../identity/identity-api.service';
import { FieldDefinitionFormComponent } from './field-definition-form.component';
import { SchemaService } from './schema.service';

/**
 * A switch is the kit's own control. Bootstrap's `.form-switch` draws its knob as a background image, and the kit's global
 * checkbox rules reset the image's no-repeat and remove it when checked, so it showed two dots off and a tick on.
 */
describe('Switches are the kit\'s control', () => {
    function expectKitSwitches(host: HTMLElement, count: number): HTMLInputElement[] {
        const inputs = [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
        expect(inputs.length).toBe(count);
        for (const input of inputs) {
            expect(input.closest('.cms-toggle')).withContext('inside the kit control').not.toBeNull();
            expect(input.nextElementSibling?.classList.contains('cms-toggle__slider')).withContext('with its slider').toBeTrue();
        }
        expect(host.querySelector('.form-switch')).withContext('no Bootstrap switch').toBeNull();

        return inputs;
    }

    it('the Override Field form: each switch sets its value, and its name toggles it', () => {
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { mode: 'override', entityAlias: 'reach', field: { name: 'channel', type: 'string', source: 'entity' } } },
                { provide: DialogRef, useValue: { close: (): void => {} } },
                { provide: SchemaService, useValue: { getFormTypes: () => of([]) } },
                { provide: IdentityApiService, useValue: { getRoles: () => of([]) } },
                { provide: ToastService, useValue: {} },
                { provide: Store, useValue: { selectSnapshot: () => null } },
            ],
        });
        const fixture = TestBed.createComponent(FieldDefinitionFormComponent);
        const form = fixture.componentInstance;
        fixture.detectChanges();
        form.activeTab.set(2);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;

        const inputs = expectKitSwitches(host, 4);
        expect(inputs.map(i => i.id)).toEqual(['so-filterable', 'so-sortable', 'so-searchable', 'so-ignore']);

        const filterable = inputs[0];
        expect(filterable.checked).toBeFalse();
        (filterable.closest('label') as HTMLLabelElement).querySelector<HTMLElement>('.fdf-toggle-label')?.click();
        fixture.detectChanges();
        expect(filterable.checked).withContext('pressing its name turns it on').toBeTrue();
    });

    it('the checkbox field widget: a switch that reports its value', () => {
        const emitted: unknown[] = [];
        const fixture = TestBed.createComponent(CheckboxFieldWidgetComponent);
        fixture.componentRef.setInput('value', false);
        fixture.componentRef.setInput('valueChange', (v: unknown) => emitted.push(v));
        fixture.detectChanges();

        const [input] = expectKitSwitches(fixture.nativeElement as HTMLElement, 1);
        input.click();
        fixture.detectChanges();

        expect(emitted).toEqual([true]);
    });
});
