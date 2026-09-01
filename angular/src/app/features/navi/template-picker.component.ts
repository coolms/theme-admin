import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { ApiService, ThemeTemplateDto } from '../../api/api.service';

/**
 * Free-text template path input enhanced with native `<datalist>` suggestions
 * drawn from the resolved theme's `templates/` directory (Task D1, restored
 * ). Bound directly to the NaviNode form's `template` FormControl.
 *
 * Deliberately a free-text input (NOT a select): a node may point at a custom
 * template that isn't listed yet, so the datalist only *suggests* — it never
 * restricts. When `themeSlug` is empty (e.g. an admin nav tree that maps to no
 * site theme) there are no suggestions, but the input still accepts a path.
 *
 * Lives in the dialog (not the field-widget registry) because the suggestion
 * scope depends on the node's tree -> section -> theme chain, which only the
 * {@link NaviNodeFormComponent} can resolve.
 */
@Component({
    selector: 'app-template-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule],
    template: `
        <input
            type="text"
            class="form-control"
            [formControl]="control()"
            [attr.list]="listId"
            placeholder="e.g. pages/home.html.dtmpl"
            autocomplete="off" />
        <datalist [id]="listId">
            @for (t of templates(); track t.path) {
                <option [value]="t.path">{{ t.label || t.path }}</option>
            }
        </datalist>
    `,
})
export class TemplatePickerComponent {
    readonly control   = input.required<FormControl<string | null>>();
    readonly themeSlug = input<string>('');

    private readonly api = inject(ApiService);

    readonly templates = signal<ThemeTemplateDto[]>([]);
    readonly listId = `tpl-list-${this.seq()}`;

    constructor() {
        // Refetch suggestions whenever the resolved theme changes. The subscription
        // is torn down on the next run / destroy so a slow response can't leak.
        effect((onCleanup) => {
            const slug = this.themeSlug();
            if (slug === '') {
                this.templates.set([]);
                return;
            }
            const sub = this.api.getThemeTemplates(slug).subscribe({
                next: list => this.templates.set(list),
                error: () => this.templates.set([]),
            });
            onCleanup(() => sub.unsubscribe());
        });
    }

    /** Monotonic counter so two pickers on one page get distinct datalist ids. */
    private seq(): number {
        return (TemplatePickerComponent.counter += 1);
    }

    private static counter = 0;
}
