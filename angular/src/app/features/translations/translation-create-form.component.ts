import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';

/**
 * F5.d -- "+ New translation" form wrapper.
 *
 * Thin adapter between CDK Dialog and the platform's `<app-dynamic-form>`.
 * Mirrors {@link NaviTreeFormComponent} exactly: the form definition,
 * the dataSources for the two relation fields, the validation rules,
 * and the submit button live in the YAML at
 * `config/modules/i18n/forms/i18n_translation_create.yaml`. This
 * component only:
 *
 *  - mounts the modal frame with the standard title chrome
 *  - hands the form id to `<app-dynamic-form>`
 *  - on submit, closes the dialog with the composite `{domain}:{locale}`
 *    id so the list slot can route the operator to the editor
 *
 * Submit-button copy and styling come from DynamicFormComponent, which
 * is also where the action row's button-group classes come from -- so
 * the dialog footer looks identical to every other platform create
 * dialog (Navi, Schedules, Calendar shares).
 *
 * Why no store action: the translations editor isn't entity-backed in
 * the conventional sense -- "creating" a (domain, locale) pair just
 * means navigating to the editor URL; the actual file write happens
 * when the operator Saves overrides in the editor. So this dialog's
 * job ends at routing.
 */
@Component({
    selector: 'app-translation-create-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent],
    template: `
        <app-modal title="New translation">
            <app-dynamic-form
                formId="i18n:translation_catalogue_create"
                context="create"
                submitLabel="Open editor"
                (submitted)="onSubmit($event)"
                (cancelled)="dialogRef.close()" />
        </app-modal>
    `,
})
export class TranslationCreateFormComponent {
    readonly dialogRef = inject<DialogRef<string | null>>(DialogRef);

    onSubmit(value: Record<string, unknown>): void {
        const domain = typeof value['domain'] === 'string' ? value['domain'].trim() : '';
        const locale = typeof value['locale'] === 'string' ? value['locale'].trim() : '';
        if (domain === '' || locale === '') {
            // Form constraints already enforce NotBlank, so this is
            // a defensive guard only -- bail without closing so the
            // operator can correct the input.
            return;
        }
        this.dialogRef.close(`${domain}:${locale}`);
    }
}
