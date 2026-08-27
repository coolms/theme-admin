import { ChangeDetectionStrategy, Component, DestroyRef, inject, ViewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent, ToastService } from '@coolms/ui-angular';
import { ApiService, IdentityGroupDto } from '../../api/api.service';

@Component({
    selector: 'app-group-create-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent],
    template: `
        <app-modal [title]="isEdit ? 'Edit Group' : 'New Group'" style="width:480px">
            <app-dynamic-form
                #dynamicForm
                [formId]="formId"
                [context]="isEdit ? 'edit' : 'create'"
                [initialValue]="initialValue"
                [submitLabel]="isEdit ? 'Save' : 'Create'"
                (submitted)="onSubmit($event)"
                (cancelled)="dialogRef.close(null)" />
        </app-modal>
    `,
})
export class GroupCreateDialogComponent {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly store      = inject(Store);
    private readonly api        = inject(ApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef          = inject(DialogRef);
    readonly group: IdentityGroupDto | null =
        inject<IdentityGroupDto | null>(DIALOG_DATA, { optional: true }) ?? null;

    readonly isEdit       = this.group !== null;
    readonly initialValue = this.group ? { ...this.group } : {};

    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.auth?.groupFormId ?? 'identity:group';

    onSubmit(value: Record<string, unknown>): void {
        const label       = (value['label']       as string | null | undefined)?.toString().trim() || null;
        const description = (value['description'] as string | null | undefined)?.toString().trim() || null;

        const obs = this.isEdit
            ? this.api.updateGroup(this.group!.id, { label, description })
            : this.api.createGroup({
                name: value['name'] as string,
                label,
                description,
            });

        obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: g => {
                this.toast.success(this.isEdit
                    ? `Group "${g.name}" updated`
                    : `Group "${g.name}" created`);
                this.dialogRef.close(true);
            },
            error: err => this.dynamicForm.setServerError(this.errors.humanize(err)),
        });
    }
}
