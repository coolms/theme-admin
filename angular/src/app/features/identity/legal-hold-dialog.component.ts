import { ChangeDetectionStrategy, Component, DestroyRef, inject, ViewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorHandlerService } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent, ToastService } from '@coolms/ui-angular';
import { IdentityApiService } from './identity-api.service';

export interface LegalHoldDialogData {
    readonly userId:       string;
    readonly accountLabel: string;
}

/**
 * Place a legal hold on a person: one field, the reason, rendered from the
 * server-declared form the manifest names (`identity:legal_hold`). An
 * elevated act -- the 403 is the elevation interceptor's, which prompts and
 * re-sends the same POST; this dialog only closes on success.
 */
@Component({
    selector: 'app-legal-hold-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent],
    template: `
        <app-modal [title]="'Place a hold on ' + data.accountLabel" [width]="520">
            <app-dynamic-form
                #dynamicForm
                [formId]="formId"
                context="create"
                [initialValue]="{}"
                submitLabel="Place the hold"
                (submitted)="onSubmit($event)"
                (cancelled)="dialogRef.close(null)" />
        </app-modal>
    `,
})
export class LegalHoldDialogComponent {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;
    private readonly identityApi = inject(IdentityApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef          = inject(DialogRef);
    readonly data               = inject<LegalHoldDialogData>(DIALOG_DATA);

    /** The form id travels in the manifest; the literal is only the fallback for an older server. */
    readonly formId = this.identityApi.legalHoldFormId ?? 'identity:legal_hold';

    onSubmit(value: Record<string, unknown>): void {
        const reason = (value['reason'] as string | null | undefined)?.toString().trim() ?? '';
        this.identityApi.placeLegalHold(this.data.userId, reason)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next:  () => {
                    this.toast.success(`Hold placed on ${this.data.accountLabel}`);
                    this.dialogRef.close(true);
                },
                error: err => this.dynamicForm.setServerError(this.errors.humanize(err)),
            });
    }
}
