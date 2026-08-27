import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DynamicFormComponent, MultiselectSearchComponent, ToastService } from '@coolms/ui-angular';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { Store } from '@ngxs/store';
import { FieldSchemaItem, SchemaService } from './schema.service';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
import { ApiService } from '../../api/api.service';

// ── Static-override tab index type ───────────────────────────────────────────
type TabIndex = 0 | 1 | 2;

@Component({
    selector: 'app-field-definition-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, DynamicFormComponent, ReactiveFormsModule, MultiselectSearchComponent],
    template: `
        <div class="cms-dialog fdf-dialog">
            <div class="cms-dialog-header">
                <span>{{ isEdit ? 'Edit Field' : isOverride ? 'Override Field' : 'Add Field' }}</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <!-- ═══════════════════════════════════════════════════════════════
                 Branch A — static PHP entity / module field override
                 (mode='override' AND source !== 'runtime')
                 Restricted UI: name + type are read-only; limited fields shown.
            ════════════════════════════════════════════════════════════════ -->
            @if (isStaticOverride) {

                <!-- Read-only field identity row -->
                <div class="fdf-identity-row">
                    <span class="fdf-identity-name font-mono">{{ field.name }}</span>
                    <span class="cms-badge {{ typeBadgeClass }}">{{ field.type }}</span>
                    <span class="fdf-identity-source">{{ field.source }}</span>
                </div>

                <!-- Override banner -->
                <div class="cms-alert cms-alert--info">
                    <i class="bi bi-lock"></i>
                    Override metadata only. Name and type cannot be changed for PHP entity fields.
                </div>

                <!-- Tab navigation -->
                <div class="form-tabs__nav fdf-tabs-nav">
                    <button type="button" class="form-tabs__btn"
                            [class.form-tabs__btn--active]="activeTab() === 0"
                            (click)="activeTab.set(0)">General</button>
                    <button type="button" class="form-tabs__btn"
                            [class.form-tabs__btn--active]="activeTab() === 1"
                            (click)="activeTab.set(1)">Security</button>
                    <button type="button" class="form-tabs__btn"
                            [class.form-tabs__btn--active]="activeTab() === 2"
                            (click)="activeTab.set(2)">Advanced</button>
                </div>

                <form [formGroup]="staticForm" (ngSubmit)="onStaticOverrideSubmit()"
                      class="fdf-static-body">

                    <!-- ── Tab 0: General ─────────────────────────────────── -->
                    @if (activeTab() === 0) {
                        <div class="fdf-fields">

                            <div>
                                <label class="cms-label" for="so-label">
                                    Label <span class="text-danger">*</span>
                                </label>
                                <input id="so-label" class="cms-input" type="text"
                                       formControlName="label"
                                       placeholder="Human-readable label" />
                                @if (staticForm.get('label')!.invalid && staticForm.get('label')!.touched) {
                                    <div class="cms-field-error">Label is required.</div>
                                }
                            </div>

                            <div>
                                <label class="cms-label" for="so-form-type">Form Type</label>
                                <select id="so-form-type" class="cms-input" formControlName="formType">
                                    <option value="">— default (auto-detected) —</option>
                                    @for (ft of formTypes(); track ft.value) {
                                        <option [value]="ft.value">{{ ft.label }}</option>
                                    }
                                </select>
                                <div class="cms-field-hint">
                                    Optional Symfony form type to override the default widget.
                                </div>
                            </div>

                            <div>
                                <label class="cms-label" for="so-placeholder">Placeholder</label>
                                <input id="so-placeholder" class="cms-input" type="text"
                                       formControlName="placeholder"
                                       placeholder="Hint text shown inside the input" />
                            </div>

                            <div>
                                <label class="cms-label" for="so-help-text">Help Text</label>
                                <input id="so-help-text" class="cms-input" type="text"
                                       formControlName="helpText"
                                       placeholder="Displayed below the field in forms" />
                            </div>

                            @if (isNumeric(field.type)) {
                                <div>
                                    <div class="cms-label" style="margin-bottom:8px">Number Options</div>
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                                        <div>
                                            <label class="cms-label" for="so-min">Min</label>
                                            <input id="so-min" class="cms-input" type="number"
                                                   formControlName="min" />
                                        </div>
                                        <div>
                                            <label class="cms-label" for="so-max">Max</label>
                                            <input id="so-max" class="cms-input" type="number"
                                                   formControlName="max" />
                                        </div>
                                        <div>
                                            <label class="cms-label" for="so-step">Step</label>
                                            <input id="so-step" class="cms-input" type="number"
                                                   formControlName="step" />
                                        </div>
                                        <div>
                                            <label class="cms-label" for="so-precision">Decimal Places</label>
                                            <input id="so-precision" class="cms-input" type="number"
                                                   formControlName="precision" />
                                        </div>
                                    </div>
                                </div>
                            }

                            <div class="form-check form-switch fdf-toggle-row">
                                <input id="so-required" class="form-check-input" type="checkbox"
                                       role="switch" formControlName="isRequired" />
                                <label for="so-required" class="form-check-label">Required</label>
                            </div>

                        </div>
                    }

                    <!-- ── Tab 1: Security ────────────────────────────────── -->
                    @if (activeTab() === 1) {
                        <div class="fdf-fields">

                            <div>
                                <div class="cms-label" style="margin-bottom:8px">Read roles</div>
                                <div class="cms-field-hint" style="margin-bottom:8px">
                                    Users with any of these roles can read this field. Leave all unchecked to allow everyone.
                                </div>
                                @if (roles().length > 0) {
                                    <app-multiselect-search
                                        [options]="roles()"
                                        [value]="staticForm.controls['securityRead'].value ?? []"
                                        placeholder="— No restrictions (all users) —"
                                        (valueChange)="staticForm.controls['securityRead'].setValue($event)" />
                                } @else {
                                    <div class="cms-field-hint fdf-no-roles">
                                        <i class="bi bi-exclamation-circle"></i>
                                        No groups defined. Create groups in Identity → Groups to set role restrictions.
                                    </div>
                                }
                            </div>

                            <div>
                                <div class="cms-label" style="margin-bottom:8px">Write roles</div>
                                <div class="cms-field-hint" style="margin-bottom:8px">
                                    Users with any of these roles can write this field. Leave all unchecked to allow everyone.
                                </div>
                                @if (roles().length > 0) {
                                    <app-multiselect-search
                                        [options]="roles()"
                                        [value]="staticForm.controls['securityWrite'].value ?? []"
                                        placeholder="— No restrictions (all users) —"
                                        (valueChange)="staticForm.controls['securityWrite'].setValue($event)" />
                                } @else {
                                    <div class="cms-field-hint fdf-no-roles">
                                        <i class="bi bi-exclamation-circle"></i>
                                        No groups defined. Create groups in Identity → Groups to set role restrictions.
                                    </div>
                                }
                            </div>

                        </div>
                    }

                    <!-- ── Tab 2: Advanced ────────────────────────────────── -->
                    @if (activeTab() === 2) {
                        <div class="fdf-fields">

                            <div>
                                <label class="cms-label" for="so-sort-order">Sort Order</label>
                                <input id="so-sort-order" class="cms-input" type="number"
                                       formControlName="sortOrder"
                                       placeholder="e.g. 10" />
                                <div class="cms-field-hint">Lower values appear first.</div>
                            </div>

                            <div class="form-check form-switch fdf-toggle-row">
                                <input id="so-filterable" class="form-check-input" type="checkbox"
                                       role="switch" formControlName="isFilterable" />
                                <label for="so-filterable" class="form-check-label">Filterable in API</label>
                            </div>

                            <div class="form-check form-switch fdf-toggle-row">
                                <input id="so-sortable" class="form-check-input" type="checkbox"
                                       role="switch" formControlName="isSortable" />
                                <label for="so-sortable" class="form-check-label">Sortable in API</label>
                            </div>

                            <div class="form-check form-switch fdf-toggle-row">
                                <input id="so-searchable" class="form-check-input" type="checkbox"
                                       role="switch" formControlName="isSearchable" />
                                <label for="so-searchable" class="form-check-label">Searchable in API</label>
                            </div>

                            <div>
                                <label class="cms-label" for="so-serial-name">Serialized name</label>
                                <input id="so-serial-name" class="cms-input" type="text"
                                       formControlName="serializedName"
                                       placeholder="e.g. meta_title" />
                                <div class="cms-field-hint">
                                    Overrides the JSON key in API responses. Leave empty to use the field name.
                                </div>
                            </div>

                            <div class="form-check form-switch fdf-toggle-row">
                                <input id="so-ignore" class="form-check-input" type="checkbox"
                                       role="switch" formControlName="ignoreInApi" />
                                <label for="so-ignore" class="form-check-label">Ignore in API responses</label>
                            </div>

                        </div>
                    }

                    <!-- Server error -->
                    @if (staticServerError()) {
                        <div class="fdf-server-error">{{ staticServerError() }}</div>
                    }

                    <!-- Footer actions -->
                    <div class="cms-dialog-footer">
                        <button type="button" class="cms-btn" (click)="close()">Cancel</button>
                        <button type="submit" class="cms-btn cms-btn-primary"
                                [disabled]="staticForm.invalid || staticSaving()">
                            @if (staticSaving()) {
                                <cms-loader [inline]="true" />
                            }
                            Override field
                        </button>
                    </div>

                </form>

            } @else {

                <!-- ═══════════════════════════════════════════════════════════
                     Branch B — create / edit / runtime-type override
                     Uses the server-driven DynamicFormComponent as before.
                ════════════════════════════════════════════════════════════ -->

                <div class="cms-dialog-body fdf-body">
                    @if (isOverride) {
                        <div class="cms-alert cms-alert--warning">
                            <i class="bi bi-info-circle"></i>
                            Inherited from parent type. Save to create a local override.
                        </div>
                    }

                    <!-- Per-locale field-LABEL translations (#706). The field's
                         own display label, persisted to the XLIFF catalogue
                         (key definition.{uuid}.label) — NOT stored on the row.
                         Shown only in edit mode when >1 locale is configured;
                         the default-locale source label is edited in the form
                         below. This answers "translate the field Label". -->
                    @if (showLabelTranslations()) {
                        <div class="fdf-opt-i18n">
                            <div class="fdf-opt-i18n__head">
                                <i class="bi bi-translate"></i>
                                <span>Label translations</span>
                            </div>
                            <div class="cms-field-hint fdf-opt-i18n__hint">
                                The field label is the source text in the default
                                locale ({{ defaultLocaleCode() }}); existing
                                translations are shown below. Edit, add, or clear the
                                label for other locales here — emptying a box removes
                                that translation, reverting to the source label.
                            </div>
                            <div class="fdf-opt-i18n__table">
                                <div class="fdf-opt-i18n__row fdf-opt-i18n__row--head">
                                    <div class="fdf-opt-i18n__opt">Label</div>
                                    @for (loc of nonDefaultLocales(); track loc.code) {
                                        <div class="fdf-opt-i18n__cell">{{ loc.label }}</div>
                                    }
                                </div>
                                <div class="fdf-opt-i18n__row">
                                    <div class="fdf-opt-i18n__opt">
                                        <span class="fdf-opt-i18n__src">{{ sourceLabel() }}</span>
                                    </div>
                                    @for (loc of nonDefaultLocales(); track loc.code) {
                                        <div class="fdf-opt-i18n__cell">
                                            <input class="cms-input cms-input--sm" type="text"
                                                   [placeholder]="sourceLabel()"
                                                   [value]="labelTranslation(loc.code)"
                                                   (input)="updateLabelTranslation(loc.code, $any($event.target).value)" />
                                        </div>
                                    }
                                </div>
                            </div>
                        </div>
                    }

                    <!-- Per-locale option-label translations (F5.b Phase 5).
                         Decoupled from the server-driven options widget below;
                         shown only in edit mode when >1 locale is configured. -->
                    @if (showOptionTranslations()) {
                        <div class="fdf-opt-i18n">
                            <div class="fdf-opt-i18n__head">
                                <i class="bi bi-translate"></i>
                                <span>Option label translations</span>
                            </div>
                            <div class="cms-field-hint fdf-opt-i18n__hint">
                                The option label is the source text in the default locale
                                ({{ defaultLocaleCode() }}); existing translations are shown
                                below. Edit, add, or clear labels for other locales here —
                                emptying a box removes that translation, reverting the option
                                to its source label.
                            </div>
                            <div class="fdf-opt-i18n__table">
                                <div class="fdf-opt-i18n__row fdf-opt-i18n__row--head">
                                    <div class="fdf-opt-i18n__opt">Option</div>
                                    @for (loc of nonDefaultLocales(); track loc.code) {
                                        <div class="fdf-opt-i18n__cell">{{ loc.label }}</div>
                                    }
                                </div>
                                @for (opt of optionList(); track opt.value) {
                                    <div class="fdf-opt-i18n__row">
                                        <div class="fdf-opt-i18n__opt">
                                            <span class="font-mono">{{ opt.value }}</span>
                                            <span class="fdf-opt-i18n__src">{{ opt.label }}</span>
                                        </div>
                                        @for (loc of nonDefaultLocales(); track loc.code) {
                                            <div class="fdf-opt-i18n__cell">
                                                <input class="cms-input cms-input--sm" type="text"
                                                       [placeholder]="opt.label"
                                                       [value]="optionTranslation(opt.value, loc.code)"
                                                       (input)="updateOptionTranslation(opt.value, loc.code, $any($event.target).value)" />
                                            </div>
                                        }
                                    </div>
                                }
                            </div>
                        </div>
                    }

                    <app-dynamic-form
                        #dynForm
                        formId="dynamic_entity:field_definition"
                        [context]="isEdit ? 'edit' : 'create'"
                        [initialValue]="initialValue()"
                        [extraPayload]="extraPayload()"
                        [submitLabel]="isEdit ? 'Save' : isOverride ? 'Override field' : 'Create'"
                        [submitDisabled]="isOverride && overridePristine()"
                        (formChanged)="onFormChanged()"
                        (submitted)="onSubmit($event)"
                        (cancelled)="close()" />
                </div>

            }
        </div>
    `,
    styles: [`
        :host { display: block; }

        .fdf-dialog {
            width: 640px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
        }

        /* ── Branch B body ──────────────────────────────────────────────── */
        .fdf-body { overflow-y: auto; flex: 1; padding: 20px; }

        /* ── Alert banners — shared structure, two colour variants ─────── */
        .cms-alert {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border: 1px solid;
            border-radius: var(--cms-radius);
            font-size: .8125rem;
            line-height: 1.4;
        }

        /* Yellow — runtime override (Branch B, inside padded .fdf-body) */
        .cms-alert--warning {
            background: var(--cms-warning-light);
            border-color: var(--cms-warning);
            color: var(--cms-warning);
            margin-bottom: 12px;
        }

        /* Blue — static PHP entity override (Branch A, between identity row + tabs) */
        .cms-alert--info {
            background: var(--cms-info-light);
            border-color: var(--cms-info);
            color: var(--cms-info);
            margin: 8px 20px;
        }

        /* ── Static override: identity row ─────────────────────────────── */
        .fdf-identity-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-bg);
            flex-shrink: 0;
        }

        .fdf-identity-name {
            font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
            font-size: .875rem;
            font-weight: 600;
            color: var(--cms-text);
        }

        .fdf-identity-source {
            font-size: .7rem;
            color: var(--cms-text-muted);
            text-transform: uppercase;
            letter-spacing: .05em;
            margin-left: auto;
        }

        /* ── Tab nav for static override ─────────────────────────────────
           Re-declared here because form-tabs__* is scoped to DynamicLayoutComponent
           and Angular's view encapsulation prevents it from reaching this host.
        ────────────────────────────────────────────────────────────────── */
        .fdf-tabs-nav {
            display: flex;
            gap: 0;
            border-bottom: 2px solid var(--cms-border);
            padding: 0 20px;
            flex-shrink: 0;
        }

        .fdf-tabs-nav .form-tabs__btn {
            padding: 8px 16px;
            border: none;
            background: none;
            font-size: .875rem;
            font-weight: 500;
            color: var(--cms-text-secondary);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -2px;
            transition: color .15s, border-color .15s;
        }

        .fdf-tabs-nav .form-tabs__btn:hover {
            color: var(--cms-text);
        }

        .fdf-tabs-nav .form-tabs__btn--active {
            color: var(--cms-accent-text);
            border-bottom-color: var(--cms-accent);
        }

        /* ── Static override form body ──────────────────────────────────── */
        .fdf-static-body {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }

        .fdf-fields {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }

        /* ── Toggle row alignment ───────────────────────────────────────── */
        /* Bootstrap .form-check.form-switch adds padding-left:2.5em — reset it
           so the switch aligns flush with the input fields above it.           */
        .fdf-toggle-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 0;
            padding: 4px 0;
            padding-left: 0 !important;
        }
        .fdf-toggle-row .form-check-input {
            margin-left: 0;
            float: none;
            flex-shrink: 0;
        }
        .fdf-toggle-row .form-check-label {
            font-size: .8125rem;
            font-weight: 500;
            color: var(--cms-text-secondary);
            margin: 0;
            cursor: pointer;
        }

        .fdf-no-roles {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 10px 12px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            color: var(--cms-text-muted);
            font-size: .8125rem;
        }

        /* ── Server error ───────────────────────────────────────────────── */
        .fdf-server-error {
            margin: 0 20px;
            padding: 8px 12px;
            border-radius: var(--cms-radius);
            background: var(--cms-danger-light);
            border: 1px solid var(--cms-danger);
            font-size: .8rem;
            color: var(--cms-danger);
        }

        /* ── Utility ────────────────────────────────────────────────────── */
        .font-mono { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; }
        .cms-field-error { font-size: .75rem; color: var(--cms-danger); margin-top: 4px; }

        /* ── Option-label translations panel (F5.b Phase 5) ───────────────── */
        .fdf-opt-i18n {
            margin-bottom: 16px;
            padding: 12px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-bg);
        }
        .fdf-opt-i18n__head {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: .8125rem;
            font-weight: 600;
            color: var(--cms-text);
            margin-bottom: 4px;
        }
        .fdf-opt-i18n__hint { margin-bottom: 10px; }
        .fdf-opt-i18n__table { display: flex; flex-direction: column; gap: 6px; }
        .fdf-opt-i18n__row { display: flex; gap: 8px; align-items: center; }
        .fdf-opt-i18n__row--head {
            font-size: .7rem;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
        }
        .fdf-opt-i18n__opt {
            flex: 1 1 0;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .fdf-opt-i18n__cell { flex: 1 1 0; min-width: 0; }
        .fdf-opt-i18n__cell .cms-input { width: 100%; }
        .fdf-opt-i18n__src { font-size: .75rem; color: var(--cms-text-muted); }
        .cms-input--sm { padding: 4px 8px; font-size: .8125rem; }
    `],
})
export class FieldDefinitionFormComponent implements OnInit {
    @ViewChild(DynamicFormComponent) private readonly dynForm?: DynamicFormComponent;

    private readonly dialogRef  = inject(DialogRef);
    private readonly data       = inject(DIALOG_DATA) as {
        entityAlias?: string;
        field?:       FieldSchemaItem;
        mode:         'create' | 'edit' | 'override';
    };
    private readonly schemaSvc  = inject(SchemaService);
    private readonly apiSvc     = inject(ApiService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly fb         = inject(FormBuilder);
    private readonly store      = inject(Store);

    readonly isEdit     = this.data.mode === 'edit';
    readonly isOverride = this.data.mode === 'override';

    /**
     * True when mode='override' AND the field comes from a static PHP entity
     * (source='entity' or source='module') — NOT a dynamic runtime-type override.
     * In this case we show the restricted UI with read-only name/type.
     */
    readonly isStaticOverride: boolean =
        this.isOverride &&
        (this.data.field?.source === 'entity' || this.data.field?.source === 'module');

    /**
     * Non-null only in isStaticOverride mode. Narrowed reference used throughout the template.
     * Safe because the static-override branch is only rendered when isStaticOverride is true.
     */
    readonly field: FieldSchemaItem = this.data.field ?? ({} as FieldSchemaItem);

    /** Badge CSS modifier for the read-only type pill. */
    readonly typeBadgeClass: string = typeBadgeClass(this.field.type ?? '');

    /**
     * Template-visible {@link isNumeric} — the static-override branch gates its
     * Number Options group on it, and an Angular template can only call class
     * members.
     */
    readonly isNumeric = isNumeric;

    // ── Static-override form state ────────────────────────────────────────────

    /** Available Symfony form types loaded from the API. */
    readonly formTypes = signal<Array<{ value: string; label: string }>>([]);

    /** Available security roles loaded from the identity API. */
    readonly roles = signal<Array<{ value: string; label: string }>>([]);

    /** Which tab is active in the static-override UI. */
    readonly activeTab = signal<TabIndex>(0);

    /** Submission in progress for the static-override inline form. */
    readonly staticSaving = signal(false);

    /** Server-side error message for the static-override inline form. */
    readonly staticServerError = signal<string | null>(null);

    /**
     * Inline ReactiveForm used only in isStaticOverride mode.
     * Pre-filled from the incoming FieldSchemaItem; always valid when label is present.
     * Built eagerly (not lazily) so the template can bind to it unconditionally —
     * the @if (isStaticOverride) guard prevents it from rendering in other modes.
     */
    readonly staticForm: FormGroup = (() => {
        const f   = this.data.field;
        const sec = f?.security ?? { read: [], write: [] };
        const api = (f?.apiConfig ?? {});
        const ser = (f?.serializerConfig ?? {});
        const opt = to(f?.typeOptions) ?? {};

        return this.fb.group({
            label:         [f?.label          ?? '', Validators.required],
            sortOrder:     [f?.sortOrder       ?? 0 ],
            formType:      [String(f?.formConfig?.['type'] ?? '')],
            placeholder:   [String(opt['placeholder'] ?? '')],
            helpText:      [String(opt['help']        ?? '')],
            isRequired:    [Boolean(f?.isRequired)],
            // Number options (only rendered when field.type === 'number')
            min:           [opt['min']       ?? null],
            max:           [opt['max']       ?? null],
            step:          [opt['step']      ?? null],
            precision:     [opt['precision'] ?? null],
            // Security: stored as string[] so checkbox toggles work without string splitting
            securityRead:  [sec.read  ?? []],
            securityWrite: [sec.write ?? []],
            isFilterable:  [Boolean(api['filterable'])],
            isSortable:    [Boolean(api['sortable'])],
            isSearchable:  [Boolean(api['searchable'])],
            serializedName:[String(ser['serialized_name'] ?? '')],
            ignoreInApi:   [Boolean(ser['ignore'])],
        });
    })();

    // ── Branch-B (DynamicForm) state ──────────────────────────────────────────

    /**
     * True until the user modifies at least one field in override mode.
     * Keeps the submit button disabled until a real change is made.
     */
    readonly overridePristine = signal(true);

    /**
     * Pre-populates the DynamicForm in edit/override mode.
     * Maps FieldSchemaItem properties to the flat field names in field_definition.yaml.
     */
    readonly initialValue = computed((): Record<string, unknown> => {
        const f = this.data.field;
        if ((!this.isEdit && !this.isOverride) || !f) return {};

        const opts = to(f.typeOptions) ?? {};

        // `type` is loaded VERBATIM. It used to be pushed through a
        // FORM_TYPE_MAP that folded the storage spellings onto form-select
        // values — float/int/integer → 'number', string → 'text', datetime →
        // 'date'. That map was lossy in the one direction that mattered: submit
        // spreads `...values`, so the folded word was saved BACK, and editing a
        // `float` field's LABEL rewrote its type to `number`. The dropdown now
        // offers every word Definition::$type can hold (see
        // FieldTypeMap::AUTHORABLE and field_definition.yaml), so there is
        // nothing to fold and the round-trip is lossless.
        return {
            name:                 f.name,
            label:                f.label,
            type:                 f.type,
            isRequired:           f.isRequired,
            sortOrder:            f.sortOrder,
            maxLength:            opts['maxLength']           ?? null,
            placeholder:          opts['placeholder']         ?? '',
            min:                  opts['min']                 ?? null,
            max:                  opts['max']                 ?? null,
            step:                 opts['step']                ?? null,
            precision:            opts['precision']           ?? null,
            multiple:             opts['multiple']            ?? false,
            selectOptions:        opts['selectOptions']        ?? [],
            relationTarget:       opts['relationTarget']       ?? '',
            relationCardinality:  opts['relationCardinality']  ?? 'one',
            relationWidget:       opts['relationWidget']       ?? 'select',
            relationFilter:       opts['relationFilter']       ?? '',
            relationDisplayField: opts['relationDisplayField'] ?? '',
            dateFormat:           opts['dateFormat']           ?? '',
            dateMin:              opts['dateMin']              ?? '',
            dateMax:              opts['dateMax']              ?? '',
            isFilterable:         Boolean(f.apiConfig?.['filterable']),
            isSortable:           Boolean(f.apiConfig?.['sortable']),
            isSearchable:         Boolean(f.apiConfig?.['searchable']),
            serializedName:       (f.serializerConfig?.['serialized_name']) ?? '',
            ignoreInApi:          Boolean(f.serializerConfig?.['ignore']),
            securityRead:         (f.security?.read  ?? []).join(', '),
            securityWrite:        (f.security?.write ?? []).join(', '),
        };
    });

    /**
     * Extra fields merged into the DynamicForm's submitted value.
     * Carries entityAlias plus inherited validationRules / formConfig so a
     * child-type override POST preserves the parent's full configuration
     * rather than landing with the entity-default fallbacks.
     */
    readonly extraPayload = computed((): Record<string, unknown> => {
        const f = this.data.field;
        const preservedRules = f ? { ...(f.validationRules ?? {}) } : {};
        delete preservedRules['NotBlank'];
        // NB: selectOptions is intentionally NOT carried here — it is now an
        // editable form field (the optionsEditor widget). extraPayload is
        // spread OVER the form values on submit, so listing it here would
        // clobber whatever the operator just authored. The control's value
        // (pre-filled via initialValue) is the single source of truth.
        return {
            entityAlias:     this.data.entityAlias ?? '',
            validationRules: preservedRules,
            formConfig:      f?.formConfig ?? {},
        };
    });

    // ── Option-label translations (F5.b Phase 5 authoring) ─────────────────────

    /**
     * Per-option, per-locale label translations bound to the inputs in the
     * "Option label translations" panel. Shape: `optionValue => locale => text`.
     * Seeded on open from {@link optionPrefill} (the currently-authored overrides
     * read back from the catalogue) so the operator edits what already exists;
     * on save, {@link collectOptionLabels} diffs against the baseline and sends
     * only the non-empty values that actually changed.
     */
    readonly optionTranslations = signal<Record<string, Record<string, string>>>({});

    /**
     * The currently-authored overrides as loaded from the backend on open
     * (`GET /field/definitions/{id}` → `optionLabels`), used as the diff baseline
     * so untouched inputs are never re-sent. Same shape as {@link optionTranslations};
     * stays the pristine loaded copy because every edit goes through the immutable
     * {@link updateOptionTranslation} (which never mutates this reference).
     */
    readonly optionPrefill = signal<Record<string, Record<string, string>>>({});

    // ── Field-LABEL translations (#706 authoring) ──────────────────────────────

    /**
     * Per-locale translations of the field's OWN display label, bound to the
     * inputs in the "Label translations" panel. Shape: `locale => text` (the
     * flat localized-text shape). Seeded on open from {@link labelPrefill}; on
     * save, {@link collectLabelTranslations} diffs against the baseline and
     * sends only the non-empty values that actually changed (or `null` to clear).
     */
    readonly labelTranslations = signal<Record<string, string>>({});

    /**
     * The currently-authored label overrides as loaded from the backend on open
     * (`GET /field/definitions/{id}` → `labelTranslations`), used as the diff
     * baseline so untouched inputs are never re-sent. Stays the pristine loaded
     * copy because every edit goes through the immutable
     * {@link updateLabelTranslation}.
     */
    readonly labelPrefill = signal<Record<string, string>>({});

    /**
     * The source (default-locale) label, shown as the panel's row preview and
     * each input's placeholder. Captured from the field as opened — the live
     * default-locale value is edited in the DynamicForm's own `label` field.
     */
    readonly sourceLabel = computed((): string => this.data.field?.label ?? '');

    /**
     * Show the label-translations panel in edit mode whenever >1 locale is
     * configured (unlike options, a label always exists). Single-locale
     * deployments see nothing.
     */
    readonly showLabelTranslations = computed((): boolean =>
        this.isEdit && this.nonDefaultLocales().length > 0);

    updateLabelTranslation(locale: string, text: string): void {
        this.labelTranslations.update(prev => ({ ...prev, [locale]: text }));
    }

    labelTranslation(locale: string): string {
        return this.labelTranslations()[locale] ?? '';
    }

    /**
     * Collapse the label panel into the wire shape, diffing against the loaded
     * baseline ({@link labelPrefill}) — same rules as {@link collectOptionLabels}:
     * a fresh/edited non-empty value is sent as text; a prefilled value the
     * operator emptied is sent as `null` (clear → revert to source); an untouched
     * value is omitted. Returns `locale => (text | null)`, or null when nothing
     * changed.
     */
    private collectLabelTranslations(): Record<string, string | null> | null {
        const out: Record<string, string | null> = {};
        const src  = this.labelTranslations();
        const base = this.labelPrefill();
        for (const locale of Object.keys(src)) {
            const text = src[locale].trim();
            const prev = base[locale] ?? '';
            if (text !== '' && text !== prev) {
                out[locale] = text;   // add or edit
            } else if (text === '' && prev !== '') {
                out[locale] = null;   // clear → revert to source
            }
        }
        return Object.keys(out).length > 0 ? out : null;
    }

    /** Default (source) locale — translations are authored for the OTHER locales. */
    readonly defaultLocaleCode = computed((): string => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.platformDefaults?.locale ?? m?.supportedLocales?.[0]?.code ?? 'en';
    });

    /** Supported locales minus the default — the columns of the translations panel. */
    readonly nonDefaultLocales = computed((): Array<{ code: string; label: string }> => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        const def = this.defaultLocaleCode();
        return (m?.supportedLocales ?? []).filter(l => l.code !== def);
    });

    /**
     * The select field's options as they currently stand IN THE DIALOG — seeded
     * from the saved field on open, then kept live from the options-editor
     * control by {@link onFormChanged}. Reading the live value (not the static
     * `data.field` snapshot) is what lets a just-added option become translatable
     * immediately, with no save+reopen.
     */
    readonly liveSelectOptions = signal<Array<{ value: string; label: string }>>(
        coerceOptions(to(this.data.field?.typeOptions)?.['selectOptions']),
    );

    /**
     * Rows of the option-translations panel: the live options, minus any whose
     * `value` is still blank — an option's stable `value` is the catalogue key,
     * so a half-typed row can't be translated until it has one (the editor
     * auto-derives a slug from the label).
     */
    readonly optionList = computed((): Array<{ value: string; label: string }> =>
        this.liveSelectOptions().filter(o => o.value !== ''));

    /**
     * Show the panel whenever there's something to translate INTO: at least one
     * non-default locale configured AND at least one named option (live — so it
     * works in create mode too, since the create processor writes option labels
     * after minting the new definition's UUID). Hidden for overrides, whose
     * options aren't authored here. Single-locale deployments see nothing.
     */
    readonly showOptionTranslations = computed((): boolean =>
        !this.isOverride && this.nonDefaultLocales().length > 0 && this.optionList().length > 0);

    updateOptionTranslation(optionValue: string, locale: string, text: string): void {
        this.optionTranslations.update(prev => ({
            ...prev,
            [optionValue]: { ...(prev[optionValue] ?? {}), [locale]: text },
        }));
    }

    /**
     * Current input value for an (option, locale) cell. The cast restores the
     * `| undefined` that a `Record` index access drops, so the optional read is
     * both type-correct and runtime-safe (untouched options have no entry yet).
     */
    optionTranslation(optionValue: string, locale: string): string {
        const byLocale = this.optionTranslations()[optionValue] as Record<string, string> | undefined;
        return byLocale?.[locale] ?? '';
    }

    /**
     * Collapse the panel state into the wire shape, diffing against the loaded
     * baseline ({@link optionPrefill}) so only real changes are sent:
     *  - a fresh or edited non-empty value → sent as the new text;
     *  - a prefilled value the operator emptied → sent as `null`, which the
     *    backend treats as a clear (removes the override; the locale reverts to
     *    the source label);
     *  - an untouched value → omitted (no catalogue churn).
     *
     * @returns `optionValue => locale => (text | null)`, or null when nothing changed.
     */
    private collectOptionLabels(): Record<string, Record<string, string | null>> | null {
        const out: Record<string, Record<string, string | null>> = {};
        const src  = this.optionTranslations();
        const base = this.optionPrefill();
        for (const value of Object.keys(src)) {
            const byLocale = src[value];
            const baseByLocale = base[value] as Record<string, string> | undefined;
            for (const locale of Object.keys(byLocale)) {
                const text = byLocale[locale].trim();
                const prev = baseByLocale?.[locale] ?? '';
                if (text !== '' && text !== prev) {
                    (out[value] ??= {})[locale] = text;   // add or edit
                } else if (text === '' && prev !== '') {
                    (out[value] ??= {})[locale] = null;   // clear → revert to source
                }
            }
        }
        return Object.keys(out).length > 0 ? out : null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    ngOnInit(): void {
        if (this.isStaticOverride) {
            // Load form types for the Form Type <select>
            this.schemaSvc.getFormTypes()
                .pipe(
                    catchError(() => of([] as Array<{ value: string; label: string }>)),
                    takeUntilDestroyed(this.destroyRef),
                )
                .subscribe(types => this.formTypes.set(types));

            // Load available roles for the Security tab checkboxes
            this.apiSvc.getRoles()
                .pipe(
                    catchError(() => of([] as Array<{ value: string; label: string }>)),
                    takeUntilDestroyed(this.destroyRef),
                )
                .subscribe(roles => this.roles.set(roles));

            return;
        }

        // Branch B — pre-fill the label- and option-translation panels with the
        // translations already authored for this field, so the operator edits
        // what exists rather than starting blank. One GET seeds both panels.
        // Only relevant in edit mode when at least one panel will show and the
        // field has an id.
        const fieldId = this.data.field?.id;
        if (fieldId && (this.showLabelTranslations() || this.showOptionTranslations())) {
            this.schemaSvc.getFieldTranslations(fieldId)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(({ labelTranslations, optionLabels }) => {
                    // *Prefill signals stay the pristine baseline; *Translations
                    // are the editable copies. Edits go through the immutable
                    // update*() setters, so the shared reference is safe.
                    this.labelPrefill.set(labelTranslations);
                    this.labelTranslations.set(labelTranslations);
                    this.optionPrefill.set(optionLabels);
                    this.optionTranslations.set(optionLabels);
                });
        }
    }

    // ── Submit handlers ───────────────────────────────────────────────────────

    /**
     * Submit handler for the static-override inline form (Branch A).
     * Only sends overrideable fields — name and type are taken from the
     * original field and passed through unchanged so the backend can
     * create/update the FieldDefinition record correctly.
     */
    onStaticOverrideSubmit(): void {
        if (this.staticForm.invalid || this.staticSaving()) return;
        this.staticSaving.set(true);
        this.staticServerError.set(null);

        const v = this.staticForm.getRawValue() as {
            label:         string;
            sortOrder:     number | null;
            formType:      string;
            placeholder:   string;
            helpText:      string;
            isRequired:    boolean;
            min:           number | null;
            max:           number | null;
            step:          number | null;
            precision:     number | null;
            securityRead:  string[];
            securityWrite: string[];
            isFilterable:  boolean;
            isSortable:    boolean;
            isSearchable:  boolean;
            serializedName:string;
            ignoreInApi:   boolean;
        };

        const validationRules: Record<string, null> = {};
        if (v.isRequired) validationRules['NotBlank'] = null;

        const apiConfig = {
            filterable: v.isFilterable,
            sortable:   v.isSortable,
            searchable: v.isSearchable,
        };

        const serializerConfig: Record<string, unknown> = {};
        if (v.serializedName) serializerConfig['serialized_name'] = v.serializedName;
        if (v.ignoreInApi)    serializerConfig['ignore']           = true;

        // Form options — only include non-empty values
        const formOptions: Record<string, unknown> = {};
        if (v.placeholder)      formOptions['placeholder'] = v.placeholder;
        if (v.helpText)         formOptions['help']        = v.helpText;
        if (v.min  !== null)    formOptions['min']         = v.min;
        if (v.max  !== null)    formOptions['max']         = v.max;
        if (v.step !== null)    formOptions['step']        = v.step;
        if (v.precision !== null) formOptions['precision'] = v.precision;

        const payload: Record<string, unknown> = {
            entityAlias:     this.data.entityAlias ?? '',
            // name and type are required by the backend to create the FieldDefinition record.
            // They are passed through unchanged — the user cannot edit them in this mode.
            name:            this.field.name,
            type:            this.field.type,
            label:           v.label,
            securityRead:    v.securityRead,
            securityWrite:   v.securityWrite,
            validationRules,
            apiConfig,
            serializerConfig,
        };

        if (v.formType)                             payload['formType']    = v.formType;
        if (Object.keys(formOptions).length > 0)    payload['formOptions'] = formOptions;
        if (v.sortOrder !== null && v.sortOrder !== undefined) {
            payload['sortOrder'] = v.sortOrder;
        }

        this.schemaSvc.createField(payload)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.toast.success('Field override created');
                    this.dialogRef.close(true);
                },
                error: (e: { error?: { detail?: string } }) => {
                    this.staticSaving.set(false);
                    this.staticServerError.set(e?.error?.detail ?? 'Save failed');
                },
            });
    }

    /**
     * Submit handler for the DynamicForm (Branch B — create / edit / runtime override).
     */
    onSubmit(values: Record<string, unknown>): void {
        const securityRead  = String(values['securityRead']  ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const securityWrite = String(values['securityWrite'] ?? '').split(',').map(s => s.trim()).filter(Boolean);

        const validationRules = { ...(values['validationRules'] as Record<string, unknown> ?? {}) };
        if (values['isRequired']) {
            validationRules['NotBlank'] = null;
        }

        const apiConfig = {
            filterable: Boolean(values['isFilterable']),
            sortable:   Boolean(values['isSortable']),
            searchable: Boolean(values['isSearchable']),
        };
        const serializerConfig: Record<string, unknown> = {};
        if (values['serializedName']) serializerConfig['serialized_name'] = values['serializedName'];
        if (values['ignoreInApi'])    serializerConfig['ignore'] = true;

        const payload: Record<string, unknown> = {
            ...values,
            securityRead, securityWrite,
            validationRules, apiConfig, serializerConfig,
        };
        for (const k of ['isRequired', 'isFilterable', 'isSortable', 'isSearchable', 'serializedName', 'ignoreInApi']) {
            delete payload[k];
        }
        if (payload['sortOrder'] === '' || payload['sortOrder'] === null || payload['sortOrder'] === undefined) {
            delete payload['sortOrder'];
        }

        // Normalise the select-options editor output: drop blank rows (a value
        // is the required key), trim, and default an empty label to the value.
        // For non-select fields the control is null/untouched → leave as-is so
        // the backend skips it (and never clobbers existing options).
        const rawOptions = payload['selectOptions'];
        if (Array.isArray(rawOptions)) {
            payload['selectOptions'] = rawOptions
                .map(o => {
                    const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
                    return {
                        value: String(obj['value'] ?? '').trim(),
                        label: String(obj['label'] ?? '').trim(),
                    };
                })
                .filter(o => o.value !== '')
                .map(o => ({ value: o.value, label: o.label === '' ? o.value : o.label }));
        }

        // Attach per-locale label translations the operator changed (#706): the
        // field's own label and each option's label. Both diff against their
        // loaded baseline; the backend persists them into the XLIFF catalogue
        // (label → definition.{uuid}.label, options → …option.{value}.label).
        // Absent = no change.
        const labelTranslations = this.collectLabelTranslations();
        if (labelTranslations) {
            payload['labelTranslations'] = labelTranslations;
        }
        const optionLabels = this.collectOptionLabels();
        if (optionLabels) {
            payload['optionLabels'] = optionLabels;
        }

        const obs = this.isEdit
            ? this.schemaSvc.updateField(this.data.field!.id!, payload)
            : this.schemaSvc.createField(payload);

        obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                const msg = this.isEdit ? 'Field updated'
                    : this.isOverride   ? 'Field override created'
                    : 'Field created';
                this.toast.success(msg);
                this.dialogRef.close(true);
            },
            error: (e: { error?: { detail?: string; violations?: Array<{ propertyPath: string; message: string }> } }) => {
                const violations = e?.error?.violations ?? [];
                if (violations.length > 0) {
                    violations.forEach(v => {
                        const ctrl = this.dynForm?.getControl(v.propertyPath);
                        if (ctrl) {
                            ctrl.markAsTouched();
                            ctrl.setErrors({ server: v.message });
                        }
                    });
                    this.dynForm?.resetSaving();
                } else {
                    this.dynForm?.setServerError(e?.error?.detail ?? 'Save failed');
                }
            },
        });
    }

    /**
     * Called on every DynamicForm value change — marks override forms dirty and
     * mirrors the options-editor control into {@link liveSelectOptions} so a
     * just-added option shows up in the translations panel without a save+reopen.
     */
    onFormChanged(): void {
        if (this.isOverride) {
            this.overridePristine.set(false);
        }
        this.liveSelectOptions.set(coerceOptions(this.dynForm?.getControl('selectOptions')?.value));
    }

    close(): void { this.dialogRef.close(null); }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/** Narrow an unknown value to a plain-object map. */
function to(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
}

/** Coerce a raw select-options value into clean {value,label} rows (tolerant of nulls/malformed entries). */
function coerceOptions(raw: unknown): Array<{ value: string; label: string }> {
    if (!Array.isArray(raw)) return [];
    return raw.map(o => {
        const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
        return { value: String(obj['value'] ?? ''), label: String(obj['label'] ?? '') };
    });
}

/**
 * The Definition::$type words that carry min/max/step/precision options, plus
 * the legacy storage spellings a pre-Version20260807120000 row may still hold.
 * Mirrors the `Number Options` showWhen in field_definition.yaml.
 */
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
    'number', 'integer', 'money', 'float', 'int',
]);

/** Whether a field type gets the numeric options group. */
export function isNumeric(type: string | null | undefined): boolean {
    return type !== null && type !== undefined && NUMERIC_TYPES.has(type);
}

/** Return the css-badge modifier class for a given field type string. */
function typeBadgeClass(type: string): string {
    switch (type) {
        case 'boolean':
        case 'checkbox': return 'cms-badge--success';
        case 'relation': return 'cms-badge--info';
        default:         return isNumeric(type) ? 'cms-badge--warning' : 'cms-badge--muted';
    }
}
