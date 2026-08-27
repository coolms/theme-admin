import { Component, inject, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';
import { CreateNaviTree, LoadNaviTrees, UpdateNaviTree } from './navi.actions';
import { NaviTreeDto } from '../../api/api.service';

@Component({
    selector: 'app-navi-tree-form',
    standalone: true,
    imports: [ModalComponent, DynamicFormComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
        <app-modal [title]="isEdit ? 'Edit Tree' : 'New Tree'" style="width:520px">
            <app-dynamic-form
                #dynamicForm
                [formId]="formId"
                [context]="isEdit ? 'edit' : 'create'"
                [initialValue]="initialValue"
                [submitLabel]="isEdit ? 'Save changes' : 'Create'"
                (submitted)="onSubmit($event)"
                (cancelled)="dialogRef.close()"
            />
        </app-modal>
    `,
})
export class NaviTreeFormComponent {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly store  = inject(Store);
    private readonly errors = inject(ErrorHandlerService);
    readonly dialogRef      = inject(DialogRef);
    readonly data: NaviTreeDto | null = inject(DIALOG_DATA);

    readonly isEdit       = this.data !== null;
    readonly initialValue = this.data ? { ...this.data } : {};

    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.navi?.treesFormId ?? 'navi:navi_tree';

    onSubmit(value: Record<string, unknown>): void {
        const action = this.isEdit
            ? new UpdateNaviTree(this.data!.slug, {
                label: value['label'] as string | undefined,
              })
            : new CreateNaviTree({
                // Slug is now optional on POST -- backend auto-derives
                // `navi.public.{section.slug}` when siteSectionId is set
                // (task #312 Deliverable 3). Empty-string slugs would still
                // 400, so coerce blanks to undefined before sending.
                slug: NaviTreeFormComponent.optional(value['slug']),
                label: value['label'] as string,
                siteSectionId: NaviTreeFormComponent.optionalUuid(value['siteSectionId']),
              });

        this.store.dispatch(action).subscribe({
            next: () => {
                this.store.dispatch(new LoadNaviTrees());
                this.dialogRef.close(true);
            },
            error: err => {
                this.dynamicForm.setServerError(this.errors.humanize(err));
            },
        });
    }

    /** Coerce blank / whitespace-only inputs to undefined for clean POST bodies. */
    private static optional(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }

    /**
     * The select-relation widget returns the chosen item's `@id` IRI
     * (e.g. `/api/v1/sections/019cdd20-...`). The CreateNaviTree backend
     * expects a bare UUID -- strip the IRI prefix when present.
     */
    private static optionalUuid(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (trimmed === '') return undefined;
        const slash = trimmed.lastIndexOf('/');
        return slash >= 0 ? trimmed.substring(slash + 1) : trimmed;
    }
}
