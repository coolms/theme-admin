import {
    ChangeDetectionStrategy, Component, computed, input, model,
} from '@angular/core';

import { type ContextSchemaVariable } from '../../shared/document-explorer.types';

/** Wizard generation modes. CSV mode is reserved for X-3. */
export type WizardMode = 'single' | 'filter';

/** FQCN of the canonical recipient entity (`@user` alias). */
/**
 * The only entity Filter mode can materialise an audience from
 * (`FilterAudienceMaterializer` rejects anything else). Exported so the
 * wizard host can stamp it into `audienceCriteria.entityType` and the
 * Output step can find the template's recipient alias by type rather than
 * by a guessed name.
 */
export const USER_ENTITY_FQCN = 'App\\Identity\\Domain\\Entity\\User';

/**
 * X-2.6b step 1 -- pick how recipients are selected.
 *
 * Three radio options:
 *   - Single recipient: always enabled, default.
 *   - Filter entities: enabled only when the template's context schema
 *     references the canonical recipient entity (User). Without a User
 *     variable there is no recipient axis to filter on.
 *   - Upload CSV: disabled (X-3 placeholder).
 *
 * Stateless: receives the schema variables + current mode, emits new
 * mode via the `mode` model signal.
 */
@Component({
    selector: 'cms-wizard-mode-step',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <fieldset class="cms-mode-step">
            <legend class="cms-mode-step__legend">How are recipients chosen?</legend>

            <label class="cms-mode-step__option">
                <input type="radio"
                       class="form-check-input"
                       name="cms-wizard-mode"
                       value="single"
                       [checked]="mode() === 'single'"
                       (change)="mode.set('single')" />
                <span class="cms-mode-step__option-body">
                    <span class="cms-mode-step__option-title">Single recipient</span>
                    <span class="cms-mode-step__option-help">
                        Generate one document. Pick the recipient on the next step.
                    </span>
                </span>
            </label>

            <label class="cms-mode-step__option"
                   [class.cms-mode-step__option--disabled]="!filterAvailable()">
                <input type="radio"
                       class="form-check-input"
                       name="cms-wizard-mode"
                       value="filter"
                       [disabled]="!filterAvailable()"
                       [checked]="mode() === 'filter'"
                       (change)="mode.set('filter')" />
                <span class="cms-mode-step__option-body">
                    <span class="cms-mode-step__option-title">Filter entities</span>
                    <span class="cms-mode-step__option-help">
                        @if (filterAvailable()) {
                            Generate one document per user matching the filter you build next.
                        } @else {
                            This template has no user references -- only Single mode is available.
                        }
                    </span>
                </span>
            </label>

            <label class="cms-mode-step__option cms-mode-step__option--disabled"
                   title="Coming soon">
                <input type="radio"
                       class="form-check-input"
                       name="cms-wizard-mode"
                       value="csv"
                       disabled />
                <span class="cms-mode-step__option-body">
                    <span class="cms-mode-step__option-title">Upload CSV</span>
                    <span class="cms-mode-step__option-help">Coming soon.</span>
                </span>
            </label>
        </fieldset>
    `,
    styles: [`
        :host { display: block; }

        .cms-mode-step {
            display: flex;
            flex-direction: column;
            gap: .75rem;
            border: none;
            padding: 0;
            margin: 0;
        }
        .cms-mode-step__legend {
            font-weight: 600;
            font-size: 1rem;
            margin: 0 0 .25rem;
            padding: 0;
        }
        .cms-mode-step__option {
            display: flex;
            gap: .75rem;
            padding: .75rem 1rem;
            border: 1px solid var(--cms-border);
            border-radius: 6px;
            background: var(--cms-surface);
            cursor: pointer;
        }
        .cms-mode-step__option:hover:not(.cms-mode-step__option--disabled) {
            border-color: var(--cms-accent);
        }
        .cms-mode-step__option--disabled {
            opacity: .55;
            cursor: not-allowed;
        }
        /* Two-line options (title + help), so centre the control on the
           first line rather than the top of the whole block. */
        .cms-mode-step__option .form-check-input {
            margin-top: calc((1.5em - 1em) / 2);
            flex-shrink: 0;
        }
        .cms-mode-step__option-body {
            display: flex;
            flex-direction: column;
            gap: .15rem;
        }
        .cms-mode-step__option-title {
            font-weight: 600;
            color: var(--cms-text);
        }
        .cms-mode-step__option-help {
            color: var(--cms-text-secondary);
            font-size: .85rem;
        }
    `],
})
export class CmsWizardModeStepComponent {
    /** Two-way bound mode. Defaults to `'single'` so the user can
     *  always advance even on schemas without recipient refs. */
    readonly mode = model<WizardMode>('single');

    /** Context-schema variables from the parent template. */
    readonly variables = input<readonly ContextSchemaVariable[]>([]);

    /**
     * Filter mode is offered only when the template schema declares a
     * variable bound to the User entity. Matching is by FQCN because
     * `ContextSchemaVariable.entityType` is the resolved class name.
     */
    protected readonly filterAvailable = computed<boolean>(() => {
        for (const v of this.variables()) {
            if (v.entityType === USER_ENTITY_FQCN) {
                return true;
            }
        }

        return false;
    });
}
