import { Component, inject, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';
import { CreateSection, LoadSections, UpdateSection } from './section.actions';
import { SiteSectionDto } from '../../api/api.service';

@Component({
    selector: 'app-section-form',
    standalone: true,
    imports: [ModalComponent, DynamicFormComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
        <app-modal [title]="isEdit ? 'Edit Section' : 'New Section'" style="width:600px">
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
export class SectionFormComponent {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly store  = inject(Store);
    private readonly errors = inject(ErrorHandlerService);
    readonly dialogRef      = inject(DialogRef);
    readonly data: SiteSectionDto | null = inject(DIALOG_DATA);

    readonly isEdit       = this.data !== null;
    readonly initialValue = this.data ? { ...this.data } : {};

    // formId comes from manifest — no hardcoding
    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.sections?.formId ?? 'section:site_section';

    /**
     * `''` from an emptied select means "no theme" and must reach the API as
     * `null` — merge-patch treats `undefined` as "unchanged", so returning it
     * would make clearing the binding impossible.
     */
    private themeSlugFrom(value: Record<string, unknown>): string | null {
        const raw = value['themeSlug'];

        return 'string' === typeof raw && '' !== raw ? raw : null;
    }

    onSubmit(value: Record<string, unknown>): void {
        const action = this.isEdit
            ? new UpdateSection(this.data!.id ?? '', {
                label:           value['label'] as string | undefined,
                matchHost:       value['matchHost'] as string | undefined,
                matchPathPrefix: value['matchPathPrefix'] as string | undefined,
                feStack:         value['feStack'] as string | undefined,
                matchPriority:   value['matchPriority'] as number | undefined,
                // — was absent, so the one field that actually decides a
                // section's theme could not be changed from the admin at all.
                // Empty select -> null, which CLEARS the binding (fall back to the
                // active theme); leaving it undefined would silently keep the old
                // value under merge-patch and make "clear" impossible.
                themeSlug:       this.themeSlugFrom(value),
              })
            : new CreateSection({
                slug:            value['slug'] as string,
                label:           value['label'] as string,
                feStack:         (value['feStack'] as string) ?? 'ssr',
                matchHost:       value['matchHost'] as string | undefined,
                matchPathPrefix: value['matchPathPrefix'] as string | undefined,
                matchPriority:   value['matchPriority'] as number | undefined,
              });

        this.store.dispatch(action).subscribe({
            next: () => {
                this.store.dispatch(new LoadSections());
                this.dialogRef.close(true);
            },
            error: err => {
                this.dynamicForm.setServerError(this.errors.humanize(err));
            },
        });
    }
}
