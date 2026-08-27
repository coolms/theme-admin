import {
    ChangeDetectionStrategy, Component, computed, input, model,
} from '@angular/core';

import { CmsEntityPickerComponent } from '@coolms/ui-angular';
import { type ContextSchemaVariable, type FormVariableInput } from '../../shared/document-explorer.types';
import { ContextInputFormComponent } from '../../explorer/context-input-form.component';
import type { ContextFormValue } from '../../explorer/context-form.helpers';
import type { WizardMode } from './mode-step.component';

/** FQCN of the canonical recipient entity (`@user` alias). */
const USER_ENTITY_FQCN = 'App\\Identity\\Domain\\Entity\\User';

/**
 * X-2.6b step 3 -- per-document audience (entity bindings + plain
 * variable inputs).
 *
 * Schema-driven layout:
 *   - Each `ContextSchemaVariable` with `entityType` set becomes a
 *     `<cms-entity-picker>`. In Filter mode, variables whose
 *     `entityType` matches the recipient class (`User`) are skipped
 *     -- they auto-bind to each iteration's recipient.
 *   - Plain variables (no `entityType`) feed into the existing
 *     `<context-input-form>` which builds the nested fieldset tree
 *     used elsewhere in the documents explorer.
 *
 * Emits two distinct model signals so the wizard state can map them
 * directly into `audienceCriteria` / `plainVariables` on submit.
 */
@Component({
    selector: 'cms-wizard-audience-step',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsEntityPickerComponent, ContextInputFormComponent],
    template: `
        <div class="cms-audience-step">
            @if (entityRefs().length > 0) {
                <section class="cms-audience-step__section">
                    <h3 class="cms-audience-step__title">Entity references</h3>
                    @if (mode() === 'filter') {
                        <p class="cms-audience-step__help">
                            Same value applied to all generated documents.
                        </p>
                    }
                    @for (ref of entityRefs(); track ref.path) {
                        <div class="cms-audience-step__field">
                            <label class="cms-audience-step__label"
                                   [attr.for]="fieldId(ref.path)">
                                {{ displayLabel(ref.path) }}
                            </label>
                            <cms-entity-picker
                                [entityType]="ref.entityType!"
                                [collection]="ref.collection ?? false"
                                [inputId]="fieldId(ref.path)"
                                [value]="readAudience(ref.path)"
                                (valueChange)="onPickerChange(ref.path, $event)" />
                        </div>
                    }
                </section>
            }

            @if (plainVariableInputs().length > 0) {
                <section class="cms-audience-step__section">
                    <h3 class="cms-audience-step__title">Variables</h3>
                    <cms-context-input-form
                        [variables]="plainVariableInputs()"
                        [initialValue]="plainVariables()"
                        (valueChange)="onPlainChange($event)" />
                </section>
            }

            @if (entityRefs().length === 0 && plainVariableInputs().length === 0) {
                <p class="cms-audience-step__empty">
                    This template declares no entity references or variables.
                </p>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }

        .cms-audience-step {
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }
        .cms-audience-step__section {
            display: flex;
            flex-direction: column;
            gap: .75rem;
        }
        .cms-audience-step__title {
            font-size: 1rem;
            font-weight: 600;
            margin: 0;
        }
        .cms-audience-step__help {
            margin: 0;
            color: var(--cms-text-secondary);
            font-size: .85rem;
        }
        .cms-audience-step__field {
            display: flex;
            flex-direction: column;
            gap: .25rem;
        }
        .cms-audience-step__label {
            font-weight: 500;
            font-size: .9rem;
            color: var(--cms-text);
        }
        .cms-audience-step__empty {
            margin: 0;
            color: var(--cms-text-secondary);
            font-size: .9rem;
        }
    `],
})
export class CmsWizardAudienceStepComponent {
    /** Context-schema variables from the parent template. */
    readonly variables = input<readonly ContextSchemaVariable[]>([]);

    /** Wizard mode -- determines whether to skip the recipient alias. */
    readonly mode = input<WizardMode>('single');

    /** Two-way bound entity-alias -> uuid map. */
    readonly audience = model<Record<string, string>>({});

    /** Two-way bound nested record for plain variables. */
    readonly plainVariables = model<Record<string, unknown>>({});

    /**
     * Entity-reference variables that should render a picker.
     * Filter mode excludes the recipient class so it auto-binds per
     * iteration.
     */
    protected readonly entityRefs = computed<readonly ContextSchemaVariable[]>(() => {
        const isFilter = this.mode() === 'filter';
        const out: ContextSchemaVariable[] = [];
        for (const v of this.variables()) {
            if (!v.entityType) {
                continue;
            }
            if (isFilter && v.entityType === USER_ENTITY_FQCN) {
                continue;
            }
            out.push(v);
        }

        return out;
    });

    /** Plain-variable form inputs (subset of `variables`, no `entityType`). */
    protected readonly plainVariableInputs = computed<readonly FormVariableInput[]>(() => {
        const out: FormVariableInput[] = [];
        for (const v of this.variables()) {
            if (v.entityType) {
                continue;
            }
            out.push({
                path: v.path,
                label: null,
                entityType: null,
                collection: false,
                fields: null,
            });
        }

        return out;
    });

    protected readAudience(path: string): string | string[] | null {
        return this.audience()[path] ?? null;
    }

    protected onPickerChange(path: string, value: string | string[] | null): void {
        const next = { ...this.audience() };
        if (null === value || '' === value) {
            delete next[path];
        } else if (Array.isArray(value)) {
            // Collection pickers emit an array of ids; serialise as a
            // comma-separated string so the audience map stays
            // `Record<string, string>` -- the backend split-on-comma
            // handles either shape today.
            if (0 === value.length) {
                delete next[path];
            } else {
                next[path] = value.join(',');
            }
        } else {
            next[path] = value;
        }
        this.audience.set(next);
    }

    protected onPlainChange(value: ContextFormValue): void {
        this.plainVariables.set(value);
    }

    protected fieldId(path: string): string {
        return 'cms-wizard-audience-' + path.replace(/[^a-zA-Z0-9]/g, '-');
    }

    protected displayLabel(path: string): string {
        // Strip the leading `@` so the entity alias reads as a name
        // (e.g., `@invoice` -> "invoice") in the picker label.
        return path.startsWith('@') ? path.slice(1) : path;
    }
}
