import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CmsEntityPickerComponent } from '@coolms/ui-angular';
import { type ContextVariableGroup, type FormVariableInput } from '../shared/document-explorer.types';
import {
    buildGroupTree,
    getNestedValue,
    lastSegment,
    setNestedValue,
    type ContextFormValue,
} from './context-form.helpers';

/**
 * F.14c-2 — schema-driven variable input. Walks a flat
 * `FormVariableInput[]` (extracted from a `DocumentTemplate`'s
 * DTMPL contextSchema) into a recursive group tree and renders one
 * text input per variable. Submits as **nested JSON**: dotted paths
 * collapse into nested objects so the backend's DTMPL renderer can
 * resolve them without flat-key reshaping.
 *
 * Replaceable. The contract — `(variables, initialValue) -> emit
 * nested JSON` — is intentionally narrow so the future F.9 Form
 * Builder can swap this implementation without touching the dialog
 * or the page-level wire-up.
 *
 * F.14c-2 scope:
 *   - Scalar variables render `<input type="text">`. Type detection
 *     (date / number / boolean) is deferred.
 *   - Variables flagged as entity references (Phase 2 —
 *     `entityType` non-null on the schema variable) render
 *     `<cms-entity-picker>` instead, persisting the entity id (or
 *     list of ids when `collection: true`) into the same nested-JSON
 *     payload as plain inputs.
 *   - All variables are optional. The schema carries no required
 *     metadata yet; an empty value submits an empty string and the
 *     renderer formats it as `''`.
 *   - Loop-internal variables (those with a non-null `loopAlias` on
 *     the source schema) are filtered upstream; this component never
 *     sees them.
 */
@Component({
    selector: 'cms-context-input-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, NgTemplateOutlet, CmsEntityPickerComponent],
    template: `
        @if (groups().length === 0) {
            <p class="cms-context-form__empty">
                This template has no variables. Click <strong>Generate</strong>
                to render it as-is.
            </p>
        }

        @for (group of groups(); track group.path) {
            <ng-container
                *ngTemplateOutlet="groupTemplate; context: { $implicit: group }"
            ></ng-container>
        }

        <ng-template #groupTemplate let-group>
            @if (group.path === '') {
                @for (variable of group.variables; track variable.path) {
                    <ng-container
                        *ngTemplateOutlet="fieldTemplate; context: { $implicit: variable }"
                    ></ng-container>
                }
            } @else {
                <fieldset class="cms-context-form__fieldset">
                    <legend>{{ group.label }}</legend>
                    @for (variable of group.variables; track variable.path) {
                        <ng-container
                            *ngTemplateOutlet="fieldTemplate; context: { $implicit: variable }"
                        ></ng-container>
                    }
                    @for (subgroup of group.subgroups; track subgroup.path) {
                        <ng-container
                            *ngTemplateOutlet="groupTemplate; context: { $implicit: subgroup }"
                        ></ng-container>
                    }
                </fieldset>
            }
        </ng-template>

        <!--
            Per-variable field renderer. Branches on whether the
            variable carries a Phase 2 (ADR-094) entityType marker:
              - entityType set → <cms-entity-picker>, value flows as
                string | string[] | null through writeField.
              - otherwise → legacy <input type="text">.
        -->
        <ng-template #fieldTemplate let-variable>
            <div class="cms-context-form__field">
                <label class="cms-label" [for]="fieldId(variable.path)">
                    {{ variable.label ?? displayLabel(variable.path) }}
                </label>
                @if (variable.entityType) {
                    <cms-entity-picker
                        [entityType]="variable.entityType"
                        [collection]="variable.collection ?? false"
                        [inputId]="fieldId(variable.path)"
                        [value]="readEntityField(variable.path)"
                        (valueChange)="writeField(variable.path, $event)"
                    />
                } @else {
                    <input
                        type="text"
                        class="cms-input"
                        [id]="fieldId(variable.path)"
                        [name]="variable.path"
                        [ngModel]="readField(variable.path)"
                        (ngModelChange)="writeField(variable.path, $event)"
                    />
                }
            </div>
        </ng-template>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .cms-context-form__empty {
            margin: 0;
            color: var(--cms-text-muted);
            font-size: .8125rem;
        }
        .cms-context-form__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .cms-context-form__fieldset {
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            padding: 10px 12px 12px;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 0;
        }
        .cms-context-form__fieldset legend {
            font-size: .8125rem;
            font-weight: 600;
            color: var(--cms-text);
            padding: 0 6px;
        }
        .cms-context-form__fieldset .cms-context-form__fieldset {
            margin-inline-start: 8px;
        }
    `],
})
export class ContextInputFormComponent {
    readonly variables = input.required<readonly FormVariableInput[]>();
    readonly initialValue = input<ContextFormValue>({});

    readonly valueChange = output<ContextFormValue>();

    protected readonly groups = computed<readonly ContextVariableGroup[]>(() =>
        buildGroupTree(this.variables()),
    );

    private readonly formData = signal<ContextFormValue>({});

    constructor() {
        // Re-seed the form whenever a fresh `initialValue` arrives. The
        // signal carries a reference; consumers that mutate-in-place
        // won't trigger this — pass a new object to reset the form.
        //
        // CRITICAL: emit the locally-cloned `seed` directly, NOT
        // `this.formData()`. Reading `formData()` inside the effect
        // creates a tracked dependency on it, so every user-driven
        // `writeField()` would trigger the effect to re-run and reset
        // `formData` back to `structuredClone(initialValue())` — i.e.
        // back to `{}` when no parent passes an initial value —
        // clobbering the user's picker selection before Generate is
        // clicked. (Phase 2 ext smoke surfaced this as `{}` POST body
        // despite the picker emitting correctly.)
        effect(() => {
            const seed = this.initialValue();
            const cloned = structuredClone(seed);
            this.formData.set(cloned);
            this.valueChange.emit(cloned);
        });
    }

    /** Public API — the dialog reads this on Generate as a fallback. */
    getValue(): ContextFormValue {
        return this.formData();
    }

    protected readField(path: string): string {
        const value = getNestedValue(this.formData(), path);
        return value === undefined || value === null ? '' : String(value);
    }

    /**
     * Entity-picker read — returns the raw value (id string, id-list,
     * or null) without the `String(...)` coercion `readField` applies
     * for text inputs. The picker's input contract is
     * `string | string[] | null`; coercing to '' would erase a
     * persisted collection.
     */
    protected readEntityField(path: string): string | string[] | null {
        const value = getNestedValue(this.formData(), path);
        if (value === undefined || value === null) {
            return null;
        }
        if (Array.isArray(value)) {
            return value.map(String);
        }
        return String(value);
    }

    /**
     * Persist a field write. Accepts:
     *   - `string`          — plain text input or single entity id.
     *   - `string[]`        — collection of entity ids (Phase 2 multi-
     *                         select picker).
     *   - `null`            — explicit clear from the entity picker
     *                         (mapped onto the path so the renderer
     *                         sees the variable as missing).
     */
    protected writeField(path: string, value: string | string[] | null): void {
        // Mutate a fresh top-level reference so OnPush parents pick up
        // the change; nested objects are mutated in place — fine here
        // since the form data is local-only and the snapshot we emit
        // is a fresh clone.
        const next = { ...this.formData() };
        setNestedValue(next, path, value);
        this.formData.set(next);
        this.valueChange.emit(structuredClone(next));
    }

    protected fieldId(path: string): string {
        return `cms-ctxvar-${path.replace(/\./g, '-')}`;
    }

    /**
     * Phase 2 extension polish — strip the leading `@` that an entity-
     * alias variable carries so the label reads as the alias name
     * itself (e.g., `user` rather than `@user`). The
     * persisted path keeps the `@` so the renderer's Context lookup
     * still resolves correctly.
     */
    protected displayLabel(path: string): string {
        const seg = lastSegment(path);
        return seg.startsWith('@') ? seg.slice(1) : seg;
    }

    protected lastSegment = lastSegment;
}
