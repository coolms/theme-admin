import { ChangeDetectionStrategy, Component, inject, ViewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';
import { CreateNaviNode, LoadNaviNodes, UpdateNaviNode } from './navi.actions';
import { NaviNodeDto } from './navi.types';

export interface NaviNodeFormData {
    treeSlug: string;
    node: NaviNodeDto | null;
}

/**
 * Create / edit a NaviNode. The fields come from the YAML form (`navi:navi_node`) rendered by `<app-dynamic-form>`.
 *
 * A menu entry carries no template (decided 2026-10-20): where a page lives picks its frame, and what it is picks how
 * its content draws, so there is nothing for an entry to override.
 */
@Component({
    selector: 'app-navi-node-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent],
    template: `
        <app-modal [title]="isEdit ? 'Edit Node' : 'New Node'" style="width:560px">
            <app-dynamic-form
                #dynamicForm
                [formId]="formId"
                [context]="isEdit ? 'edit' : 'create'"
                [initialValue]="initialValue"
                [extraPayload]="extraPayload"
                [submitLabel]="isEdit ? 'Save changes' : 'Create'"
                (submitted)="onSubmit($event)"
                (cancelled)="dialogRef.close()"
            />
        </app-modal>
    `,
})
export class NaviNodeFormComponent {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly store      = inject(Store);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef      = inject(DialogRef);
    readonly data: NaviNodeFormData = inject(DIALOG_DATA);

    readonly isEdit       = this.data.node !== null;
    readonly initialValue = this.data.node ? { ...this.data.node } : {};
    readonly extraPayload = this.isEdit ? {} : { treeSlug: this.data.treeSlug };

    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.navi?.nodesFormId ?? 'navi:navi_node';

    /** A refused save: each violation goes to its own control, and the message still heads the form. */
    private showSaveError(err: unknown): void {
        const violations = (err as { error?: { violations?: Array<{ propertyPath: string; message: string }> } })
            ?.error?.violations ?? [];
        for (const v of violations) {
            const ctrl = this.dynamicForm.getControl(v.propertyPath);
            if (ctrl) {
                ctrl.markAsTouched();
                ctrl.setErrors({ server: v.message });
            }
        }
        this.dynamicForm.setServerError(this.errors.humanize(err));
    }

    onSubmit(value: Record<string, unknown>): void {
        if (this.isEdit) {
            const action = new UpdateNaviNode(this.data.node!.id, {
                title:    value['title'] as string | undefined,
                isVisible: value['isVisible'] as boolean | undefined,
                sortOrder: value['sortOrder'] as number | undefined,
            });
            this.store.dispatch(action).subscribe({
                next: () => {
                    this.store.dispatch(new LoadNaviNodes(this.data.treeSlug));
                    this.dialogRef.close(true);
                },
                error: err => this.showSaveError(err),
            });
        } else {
            const action = new CreateNaviNode({
                treeSlug:         this.data.treeSlug,
                slug:             value['slug'] as string,
                title:            value['title'] as string,
                path:             value['path'] as string,
                isVisible:        (value['isVisible'] as boolean) ?? true,
                sortOrder:        (value['sortOrder'] as number) ?? 10,
            });
            this.store.dispatch(action).subscribe({
                next: () => {
                    this.store.dispatch(new LoadNaviNodes(this.data.treeSlug));
                    this.dialogRef.close(true);
                },
                error: err => this.showSaveError(err),
            });
        }
    }
}
