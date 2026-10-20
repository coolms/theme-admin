import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { ThemeTemplateDto } from '../themes/themes.types';
import { ThemesApiService } from '../themes/themes-api.service';

/**
 * The menu entry's template, chosen from the section theme's page templates (decided 2026-10-20). Bound directly to
 * the NaviNode form's `template` FormControl.
 *
 * A SELECT, no longer free text. The first option is "Default (directory index)" -- no template, so the entry's
 * page is drawn by its content (the directory index, or the page's content type). A template on an entry is an
 * administrator's explicit override, and the list offers exactly what the save accepts: the server lists what the
 * theme RESOLVES (its inheritance chain) and refuses anything else with a 422 on this field, shown under the select.
 *
 * A value the list does not hold -- an entry saved before this, naming a template the theme no longer ships -- is
 * shown as its own option, marked, rather than silently replaced by the default: saving the entry unchanged keeps it
 * (the server asks only about a CHANGED template), and choosing another option is how an administrator moves off it.
 *
 * Lives in the dialog (not the field-widget registry) because the list depends on the node's tree -> section ->
 * theme chain, which only the {@link NaviNodeFormComponent} can resolve.
 */
@Component({
    selector: 'app-template-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule],
    template: `
        <select
            class="form-select"
            [class.is-invalid]="serverError()"
            [formControl]="control()"
            aria-label="Template">
            <option [ngValue]="null">Default (directory index)</option>
            @if (unlisted(); as current) {
                <option [ngValue]="current">{{ current }} (not a template of this theme)</option>
            }
            @for (t of pageTemplates(); track t.path) {
                <option [ngValue]="t.path">{{ t.path }}</option>
            }
        </select>
        @if (serverError(); as message) {
            <div class="invalid-feedback d-block">{{ message }}</div>
        }
        @if (loadFailed()) {
            <div class="form-text text-warning">The theme's templates could not be listed.</div>
        }
    `,
})
export class TemplatePickerComponent {
    readonly control   = input.required<FormControl<string | null>>();
    readonly themeSlug = input<string>('');
    private readonly themesApi = inject(ThemesApiService);

    readonly templates  = signal<ThemeTemplateDto[]>([]);
    readonly loaded     = signal(false);
    readonly loadFailed = signal(false);
    private readonly value = signal<string | null>(null);
    private readonly errors = signal<Record<string, unknown> | null>(null);

    /** Page templates only: a menu entry draws a page, never a layout or a partial. */
    readonly pageTemplates = computed(() => this.templates().filter(t => t.path.startsWith('pages/')));

    /** The stored value when the list does not hold it -- shown, never dropped. Null until the list has loaded. */
    readonly unlisted = computed(() => {
        const current = this.value();
        if (current === null) {
            return null;
        }
        // While the list loads the stored value is still shown, so the select never flashes "Default".
        if (!this.loaded()) {
            return current;
        }
        return this.pageTemplates().some(t => t.path === current) ? null : current;
    });

    /** The server's refusal (a 422 on `template`), set on the control by the dialog. */
    readonly serverError = computed(() => {
        const server = this.errors()?.['server'];
        return typeof server === 'string' ? server : null;
    });

    constructor() {
        // The control is an input: follow its value and errors as signals, so the select's extra option and the
        // message under it track what the form holds.
        effect((onCleanup) => {
            const control = this.control();
            // An empty string is the same "no template" the server stores as null; one value for it in the select.
            if (control.value === '') {
                control.setValue(null, { emitEvent: false });
            }
            this.value.set(control.value);
            this.errors.set(control.errors);
            const sub = control.valueChanges.subscribe(v => {
                this.value.set(v === '' ? null : v);
                this.errors.set(control.errors);
            });
            const status = control.statusChanges.subscribe(() => this.errors.set(control.errors));
            onCleanup(() => {
                sub.unsubscribe();
                status.unsubscribe();
            });
        });

        // Refetch the list whenever the resolved theme changes. The subscription is torn down on the next run /
        // destroy so a slow response can't leak.
        effect((onCleanup) => {
            const slug = this.themeSlug();
            this.loaded.set(false);
            this.loadFailed.set(false);
            if (slug === '') {
                this.templates.set([]);
                return;
            }
            const sub = this.themesApi.getThemeTemplates(slug).subscribe({
                next: list => {
                    this.templates.set(list);
                    this.loaded.set(true);
                },
                error: () => {
                    this.templates.set([]);
                    this.loadFailed.set(true);
                },
            });
            onCleanup(() => sub.unsubscribe());
        });
    }
}
