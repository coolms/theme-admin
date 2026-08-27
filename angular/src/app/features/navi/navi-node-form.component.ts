import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, inject, signal, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';
import { CreateNaviNode, LoadNaviNodes, UpdateNaviNode } from './navi.actions';
import { ApiService, NaviNodeDto, NaviTreeDto, SiteSectionDto } from '../../api/api.service';
import { TemplatePickerComponent } from './template-picker.component';

export interface NaviNodeFormData {
    treeSlug: string;
    node: NaviNodeDto | null;
}

/**
 * Create / edit a NaviNode. The core fields come from the YAML form
 * (`navi:navi_node`) rendered by `<app-dynamic-form>`. The `template` override
 * is declared in that form (so its FormControl + validators exist) but NOT laid
 * out there — instead it renders here, projected into the dynamic-form's content
 * slot, as a theme-scoped {@link TemplatePickerComponent}. The picker needs the
 * tree's resolved theme (tree → section → themeSlug), which only this dialog can
 * resolve; it's shown only when a theme resolves (a public nav node that renders
 * a page), so admin nav trees — which map to no theme — get no template field.
 */
@Component({
    selector: 'app-navi-node-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent, TemplatePickerComponent],
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
            >
                @if (themeSlug() && templateControl()) {
                    <div class="form-group">
                        <label class="form-label">Template</label>
                        <app-template-picker
                            [control]="templateControl()!"
                            [themeSlug]="themeSlug()" />
                        <div class="form-text text-muted">
                            Optional template for this node's page (theme &quot;{{ themeSlug() }}&quot;). Leave empty for the default.
                        </div>
                    </div>
                }
            </app-dynamic-form>
        </app-modal>
    `,
})
export class NaviNodeFormComponent implements AfterViewInit {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly store      = inject(Store);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly api        = inject(ApiService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef      = inject(DialogRef);
    readonly data: NaviNodeFormData = inject(DIALOG_DATA);

    readonly isEdit       = this.data.node !== null;
    readonly initialValue = this.data.node ? { ...this.data.node } : {};
    readonly extraPayload = this.isEdit ? {} : { treeSlug: this.data.treeSlug };

    /** Resolved theme slug for the tree -- scopes the template picker; empty hides it. */
    readonly themeSlug = signal<string>('');

    /**
     * The dynamic-form's `template` FormControl, resolved post-render (the form
     * builds its group async). Null while loading; the picker `@if`-guards on it.
     */
    readonly templateControl = signal<FormControl<string | null> | null>(null);

    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.navi?.nodesFormId ?? 'navi:navi_node';

    ngAfterViewInit(): void {
        this.resolveActiveTheme();
        this.bindTemplateControl(0);
    }

    /**
     * Look up the active tree -> its section -> the section's theme slug. Any
     * missing soft-ref link leaves themeSlug empty and the picker stays hidden.
     */
    private resolveActiveTheme(): void {
        this.api.getNaviTrees().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (trees: NaviTreeDto[]) => {
                const tree = trees.find(t => t.slug === this.data.treeSlug);
                if (!tree?.siteSectionId) return;
                this.api.getSections().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                    next: (sections: SiteSectionDto[]) => {
                        const section = sections.find(s => s.id === tree.siteSectionId);
                        const slug = section?.themeSlug ?? '';
                        if (slug !== '') this.themeSlug.set(slug);
                    },
                });
            },
        });
    }

    /**
     * Retry-loop the `template` control lookup since DynamicFormComponent builds
     * its FormGroup after the definition fetch resolves. Caps at 10 attempts (~1s).
     */
    private bindTemplateControl(attempt: number): void {
        if (attempt > 10) return;
        const ctrl = this.dynamicForm?.getControl('template');
        if (ctrl instanceof FormControl) {
            this.templateControl.set(ctrl as FormControl<string | null>);
            return;
        }
        setTimeout(() => this.bindTemplateControl(attempt + 1), 100);
    }

    onSubmit(value: Record<string, unknown>): void {
        if (this.isEdit) {
            const action = new UpdateNaviNode(this.data.node!.id, {
                title:    value['title'] as string | undefined,
                template: value['template'] as string | null,
                isVisible: value['isVisible'] as boolean | undefined,
                sortOrder: value['sortOrder'] as number | undefined,
            });
            this.store.dispatch(action).subscribe({
                next: () => {
                    this.store.dispatch(new LoadNaviNodes(this.data.treeSlug));
                    this.dialogRef.close(true);
                },
                error: err => this.dynamicForm.setServerError(this.errors.humanize(err)),
            });
        } else {
            const action = new CreateNaviNode({
                treeSlug:         this.data.treeSlug,
                slug:             value['slug'] as string,
                title:            value['title'] as string,
                path:             value['path'] as string,
                template: value['template'] as string | undefined,
                isVisible:        (value['isVisible'] as boolean) ?? true,
                sortOrder:        (value['sortOrder'] as number) ?? 10,
            });
            this.store.dispatch(action).subscribe({
                next: () => {
                    this.store.dispatch(new LoadNaviNodes(this.data.treeSlug));
                    this.dialogRef.close(true);
                },
                error: err => this.dynamicForm.setServerError(this.errors.humanize(err)),
            });
        }
    }
}
