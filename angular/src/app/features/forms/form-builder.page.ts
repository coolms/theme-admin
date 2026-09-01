import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
    CmsDetailFooterComponent,
    CmsPageHeaderComponent,
    DynamicFormComponent,
    LayoutActionsService,
    LayoutTreeEditorComponent,
    OrderedBuilderComponent,
    PageTitleService,
    ToastService,
    UnsavedChangesService,
    type LayoutNode,
    type OrderedElement,
    type OrderedElementFactory,
    type OrderedPaletteEntry,
    type ToolbarAction,
} from '@coolms/ui-angular';
import { ConfigService, type LayoutConfig, ErrorHandlerService } from '@coolms/core-angular';
import { FormService } from './form.service';
import type { FormFieldEntry, FormFieldsMap, FormFieldTypeDto } from './form.types';

/** One editable choice for a select-style field. */
interface ChoiceRow { label: string; value: string; }

/**
 * The builder's working model for a single field. A plain `Record` (like the
 * Page Builder's `BlockModel`) so it flows cleanly through the
 * `<app-ordered-builder>` two-way `elements` model in both directions; props
 * are read through the typed getters below. Keys:
 *   name / type / label / required / help / placeholder  — surfaced inspector fields
 *   choices         — ChoiceRow[] (static options; only for `hasOptions` types)
 *   dsType/dsClass/dsRoute/dsBindValue/dsBindLabel/dsMultiple/dsWidget
 *                   — FB-1 data-source editor state for select fields; serialised
 *                     to the canonical `options.dataSource` (static/enum/api)
 *   _extraOptions   — Symfony options we don't surface (passed through verbatim)
 *   _extraConstraints — validator constraints we don't surface (passed through)
 *   _extraEntry     — top-level field-entry keys we don't surface, e.g.
 *                     `mapping` (passed through verbatim; FB-0 replace save
 *                     no longer backfills them, so they must round-trip here)
 */
type FieldModel = Record<string, unknown>;

/**
 * Form Builder page (`/admin/forms/new`, `/admin/forms/:id`,.3).
 *
 * The second consumer of the generic {@link OrderedBuilderComponent} substrate
 * (the first is the landing Page Builder). The ordered-list machinery — type
 * palette (click / drag to place), reorder, move ↑/↓, remove — lives in the
 * substrate; this page owns the form-field *catalogue* (palette = the
 * `/form-field-types` endpoint), the per-field inspector (a projected
 * `<ng-template>`: name, label, type, required, help, placeholder, choices),
 * and the create/edit lifecycle.
 *
 * Save routes through the.2 chained writer (`POST`/`PATCH /forms`):
 * editing a module-shipped form mints a DB override; user-created forms land
 * file-when-writable else DB. After a successful save the right pane renders a
 * **live preview** via `<app-dynamic-form [formId]>` (it fetches the persisted
 * `/forms/{id}/render`), so the author sees the real rendered form.
 */
@Component({
    selector: 'coolms-admin-form-builder',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, CmsPageHeaderComponent, CmsDetailFooterComponent, OrderedBuilderComponent, DynamicFormComponent, LayoutTreeEditorComponent],
    template: `
        <div class="fb">
            <cms-page-header
                [title]="headerTitle()"
                icon="ui-checks-grid"
                [subtitle]="headerSubtitle()"
                [actions]="headerActions()"
                (actionClick)="onHeaderAction($event)">
            </cms-page-header>

            <div class="fb__body">
                <!-- LEFT: builder -->
                <section class="fb__pane fb__pane--build">
                    @if (isNew()) {
                        <div class="fb__id">
                            <label class="cms-label" for="fb-id">Form ID</label>
                            <input id="fb-id" class="cms-input cms-input-sm"
                                   placeholder="e.g. contact_us"
                                   [ngModel]="formId()"
                                   (ngModelChange)="setFormId($event)" />
                            <small class="fb__hint">snake_case · letters, digits, <code>_ . : -</code>. Used as the form's id and URL.</small>
                        </div>
                    }

                    <div class="fb__tabs">
                        <button type="button" class="fb__tab" [class.fb__tab--active]="activeTab() === 'fields'"
                                (click)="activeTab.set('fields')">Fields</button>
                        <button type="button" class="fb__tab" [class.fb__tab--active]="activeTab() === 'layout'"
                                (click)="activeTab.set('layout')">Layout</button>
                    </div>

                    @if (activeTab() === 'layout') {
                        <app-layout-tree-editor
                            [nodes]="layoutNodes()"
                            (nodesChange)="layoutNodes.set($event)"
                            [allFields]="fieldNames()"
                            [availableFields]="unplacedFields()" />
                    } @else {
                    <app-ordered-builder
                        [elements]="fields()"
                        (elementsChange)="fields.set($any($event))"
                        [palette]="palette()"
                        [factory]="makeField"
                        [labelOf]="labelOfField"
                        [embedded]="true"
                        paletteLabel="Add field"
                        emptyText="No fields yet — add one from the palette above (click or drag).">
                        <ng-template let-field let-i="index">
                            <div class="fb__field">
                                <div class="fb__row">
                                    <div class="fb__cell">
                                        <label class="cms-label cms-label--sm">Field name</label>
                                        <input class="cms-input cms-input-sm"
                                               [ngModel]="fname(field)"
                                               (ngModelChange)="setName(i, $event)" />
                                    </div>
                                    <div class="fb__cell">
                                        <label class="cms-label cms-label--sm">Label</label>
                                        <input class="cms-input cms-input-sm"
                                               [ngModel]="flabel(field)"
                                               (ngModelChange)="setLabel(i, $event)" />
                                    </div>
                                    <div class="fb__cell fb__cell--type">
                                        <label class="cms-label cms-label--sm">Type</label>
                                        <select class="cms-input cms-input-sm"
                                                [ngModel]="ftype(field)"
                                                (ngModelChange)="setType(i, $event)">
                                            @for (t of typeOptionsFor(field); track t.type) {
                                                <option [value]="t.type">{{ t.label }}</option>
                                            }
                                        </select>
                                    </div>
                                    <div class="fb__cell fb__cell--req">
                                        <label class="cms-label cms-label--sm">Required</label>
                                        <input type="checkbox"
                                               [ngModel]="frequired(field)"
                                               (ngModelChange)="setRequired(i, $event)" />
                                    </div>
                                </div>

                                <div class="fb__row">
                                    <div class="fb__cell">
                                        <label class="cms-label cms-label--sm">Help text</label>
                                        <input class="cms-input cms-input-sm"
                                               [ngModel]="fhelp(field)"
                                               (ngModelChange)="setHelp(i, $event)" />
                                    </div>
                                    <div class="fb__cell">
                                        <label class="cms-label cms-label--sm">Placeholder</label>
                                        <input class="cms-input cms-input-sm"
                                               [ngModel]="fplaceholder(field)"
                                               (ngModelChange)="setPlaceholder(i, $event)" />
                                    </div>
                                </div>

                                @if (ftype(field) === 'relation') {
                                    <div class="fb__rel">
                                        <div class="fb__row">
                                            <div class="fb__cell fb__cell--type">
                                                <label class="cms-label cms-label--sm">Cardinality</label>
                                                <select class="cms-input cms-input-sm"
                                                        [ngModel]="relCardinality(field)"
                                                        (ngModelChange)="setRelCardinality(i, $event)">
                                                    <option value="one">One</option>
                                                    <option value="many">Many</option>
                                                </select>
                                            </div>
                                            <div class="fb__cell">
                                                <label class="cms-label cms-label--sm">Max items</label>
                                                <input class="cms-input cms-input-sm" type="number" min="1" placeholder="—"
                                                       [ngModel]="relMaxItems(field)"
                                                       (ngModelChange)="setRelMaxItems(i, $event)" />
                                            </div>
                                            <div class="fb__cell">
                                                <label class="cms-label cms-label--sm">Target form (inline create)</label>
                                                <select class="cms-input cms-input-sm"
                                                        [ngModel]="relTargetFormId(field)"
                                                        (ngModelChange)="setRelTargetFormId(i, $event)">
                                                    <option value="">— none —</option>
                                                    @for (fid of formIds(); track fid) {
                                                        <option [value]="fid">{{ fid }}</option>
                                                    }
                                                </select>
                                            </div>
                                        </div>
                                        <small class="fb__hint">A related record picker; choose where its options come from below.</small>
                                    </div>
                                }
                                @if (ftype(field) === 'subform') {
                                    <div class="fb__rel">
                                        <div class="fb__row">
                                            <div class="fb__cell">
                                                <label class="cms-label cms-label--sm">Sub-form</label>
                                                <select class="cms-input cms-input-sm"
                                                        [ngModel]="subFormId(field)"
                                                        (ngModelChange)="setSubFormId(i, $event)">
                                                    <option value="">— select a form —</option>
                                                    @for (fid of formIds(); track fid) {
                                                        <option [value]="fid">{{ fid }}</option>
                                                    }
                                                </select>
                                            </div>
                                            <div class="fb__cell fb__cell--type">
                                                <label class="cms-label cms-label--sm">Relation</label>
                                                <select class="cms-input cms-input-sm"
                                                        [ngModel]="subRelation(field)"
                                                        (ngModelChange)="setSubRelation(i, $event)">
                                                    <option value="one">One</option>
                                                    <option value="many">Many</option>
                                                </select>
                                            </div>
                                            <div class="fb__cell">
                                                <label class="cms-label cms-label--sm">Max items</label>
                                                <input class="cms-input cms-input-sm" type="number" min="1" placeholder="—"
                                                       [ngModel]="subMaxItems(field)"
                                                       (ngModelChange)="setSubMaxItems(i, $event)" />
                                            </div>
                                        </div>
                                        <small class="fb__hint">Renders the selected form inline (nested records).</small>
                                    </div>
                                }

                                @if (isChoiceType(ftype(field)) || ftype(field) === 'relation') {
                                    <div class="fb__ds">
                                        <div class="fb__ds-head">
                                            <label class="cms-label cms-label--sm">Options source</label>
                                            <div class="fb__ds-tabs">
                                                @for (s of dsSources; track s.id) {
                                                    <button type="button" class="cms-btn cms-btn-sm"
                                                            [class.fb__ds-tab--active]="dsType(field) === s.id"
                                                            (click)="setDsType(i, s.id)">{{ s.label }}</button>
                                                }
                                            </div>
                                        </div>

                                        @switch (dsType(field)) {
                                            @case ('static') {
                                                <div class="fb__choices">
                                                    <div class="fb__choices-head">
                                                        <small class="fb__hint">A fixed list of options.</small>
                                                        <button type="button" class="cms-btn cms-btn-sm"
                                                                (click)="addChoice(i)">
                                                            <i class="bi bi-plus-lg"></i> Add option
                                                        </button>
                                                    </div>
                                                    @for (c of choicesOf(field); track $index; let j = $index) {
                                                        <div class="fb__choice">
                                                            <input class="cms-input cms-input-sm" placeholder="Label"
                                                                   [ngModel]="c.label"
                                                                   (ngModelChange)="setChoiceLabel(i, j, $event)" />
                                                            <input class="cms-input cms-input-sm" placeholder="Value"
                                                                   [ngModel]="c.value"
                                                                   (ngModelChange)="setChoiceValue(i, j, $event)" />
                                                            <button type="button" class="cms-btn cms-btn-sm fb__danger"
                                                                    title="Remove option" (click)="removeChoice(i, j)">
                                                                <i class="bi bi-x-lg"></i>
                                                            </button>
                                                        </div>
                                                    }
                                                </div>
                                            }
                                            @case ('enum') {
                                                <div class="fb__cell">
                                                    <label class="cms-label cms-label--sm">PHP enum class (FQCN)</label>
                                                    <input class="cms-input cms-input-sm"
                                                           placeholder="App\\…\\StatusEnum"
                                                           [ngModel]="dsClass(field)"
                                                           (ngModelChange)="setDsClass(i, $event)" />
                                                    <small class="fb__hint">A backed enum; its cases become the options. Developer-supplied.</small>
                                                </div>
                                            }
                                            @case ('api') {
                                                <div class="fb__row">
                                                    <div class="fb__cell">
                                                        <label class="cms-label cms-label--sm">API route name</label>
                                                        <input class="cms-input cms-input-sm"
                                                               placeholder="e.g. api_options_get"
                                                               [ngModel]="dsRoute(field)"
                                                               (ngModelChange)="setDsRoute(i, $event)" />
                                                    </div>
                                                    <div class="fb__cell">
                                                        <label class="cms-label cms-label--sm">Value field</label>
                                                        <input class="cms-input cms-input-sm" placeholder="value or @id"
                                                               [ngModel]="dsBindValue(field)"
                                                               (ngModelChange)="setDsBindValue(i, $event)" />
                                                    </div>
                                                    <div class="fb__cell">
                                                        <label class="cms-label cms-label--sm">Label field</label>
                                                        <input class="cms-input cms-input-sm" placeholder="label"
                                                               [ngModel]="dsBindLabel(field)"
                                                               (ngModelChange)="setDsBindLabel(i, $event)" />
                                                    </div>
                                                </div>
                                                <small class="fb__hint">Fetches options from a Symfony route. Developer-supplied.</small>
                                            }
                                        }

                                        <div class="fb__row">
                                            <div class="fb__cell fb__cell--req">
                                                <label class="cms-label cms-label--sm">Multiple</label>
                                                <input type="checkbox"
                                                       [ngModel]="dsMultiple(field)"
                                                       (ngModelChange)="setDsMultiple(i, $event)" />
                                            </div>
                                            <div class="fb__cell fb__cell--type">
                                                <label class="cms-label cms-label--sm">Widget</label>
                                                <select class="cms-input cms-input-sm"
                                                        [ngModel]="dsWidget(field)"
                                                        (ngModelChange)="setDsWidget(i, $event)">
                                                    <option value="select">Dropdown</option>
                                                    <option value="select-search">Searchable</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                }
                            </div>
                        </ng-template>
                    </app-ordered-builder>
                    }
                </section>

                <!-- RIGHT: live preview -->
                <section class="fb__pane fb__pane--preview">
                    <h3 class="fb__pane-title"><i class="bi bi-eye"></i> Live preview</h3>
                    @if (!isNew() && currentId()) {
                        @for (k of [previewNonce()]; track k) {
                            <app-dynamic-form
                                [formId]="currentId()"
                                context="create"
                                [declaredActions]="true"
                                [submitDisabled]="true" />
                        }
                    } @else {
                        <div class="fb__preview-empty">
                            Save the form to see a live preview of the rendered fields.
                        </div>
                    }
                </section>
            </div>

            <cms-detail-footer
                [actions]="footerActions()"
                (actionClick)="onHeaderAction($event)" />
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .fb { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .fb__body {
            display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
            gap: 16px; padding: 16px; flex: 1; min-height: 0; overflow: auto;
        }
        @media (max-width: 1100px) { .fb__body { grid-template-columns: 1fr; } }
        .fb__pane { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .fb__pane--preview {
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface); padding: 14px; align-self: flex-start;
            position: sticky; top: 0;
        }
        .fb__pane-title {
            margin: 0 0 4px; font-size: .8125rem; font-weight: 600;
            color: var(--cms-text-secondary); display: flex; align-items: center; gap: 6px;
        }
        .fb__preview-empty {
            padding: 18px; text-align: center; font-size: .8125rem;
            color: var(--cms-text-muted); border: 1px dashed var(--cms-border);
            border-radius: var(--cms-radius, 6px);
        }
        .fb__id {
            display: flex; flex-direction: column; gap: 3px;
            padding: 10px; border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px); background: var(--cms-border-light);
        }
        .fb__hint { font-size: .6875rem; color: var(--cms-text-muted); }
        /* FB-3 Fields / Layout tab strip */
        .fb__tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--cms-border); }
        .fb__tab {
            appearance: none; background: transparent; border: none; cursor: pointer;
            padding: 7px 14px; font-size: .8125rem; font-weight: 600;
            color: var(--cms-text-secondary); border-bottom: 2px solid transparent;
            margin-bottom: -1px;
        }
        .fb__tab:hover { color: var(--cms-text); }
        .fb__tab--active { color: var(--cms-primary, #2563eb); border-bottom-color: var(--cms-primary, #2563eb); }
        /* Per-field inspector — rendered inside the substrate's .ob__body flex row. */
        .fb__field { flex: 1 0 100%; display: flex; flex-direction: column; gap: 8px; }
        .fb__row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
        .fb__cell { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 2px; }
        .fb__cell--type { flex: 0 0 160px; }
        .fb__cell--req { flex: 0 0 70px; align-items: flex-start; }
        .cms-label--sm { font-size: .6875rem; }
        .fb__danger { color: var(--cms-danger, #dc2626); }
        .fb__choices {
            flex: 0 0 100%; display: flex; flex-direction: column; gap: 6px;
            border: 1px dashed var(--cms-border); border-radius: var(--cms-radius, 6px); padding: 8px;
        }
        .fb__choices-head { display: flex; align-items: center; justify-content: space-between; }
        .fb__choice { display: flex; gap: 8px; align-items: center; }
        .fb__choice .cms-input { flex: 1; }
        /* FB-1 data-source editor */
        .fb__ds {
            flex: 0 0 100%; display: flex; flex-direction: column; gap: 8px;
            border: 1px dashed var(--cms-border); border-radius: var(--cms-radius, 6px); padding: 8px;
        }
        .fb__ds-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .fb__ds-tabs { display: inline-flex; gap: 4px; }
        .fb__ds-tab--active {
            background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse);
            border-color: var(--cms-primary, #2563eb);
        }
        .fb__ds .fb__choices { border: none; padding: 0; }
        /* FB-2 relation / sub-form blocks */
        .fb__rel {
            flex: 0 0 100%; display: flex; flex-direction: column; gap: 6px;
            border: 1px dashed var(--cms-border); border-radius: var(--cms-radius, 6px); padding: 8px;
        }
    `],
})
export class FormBuilderPageComponent implements OnInit {
    private readonly forms      = inject(FormService);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`form:builder` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly toast      = inject(ToastService);
    private readonly unsaved    = inject(UnsavedChangesService);

    /** The serialized form as of the last load or save -- the clean point. */
    private savedSnapshot = '';

    /**
     *  NOT `OrderedBuilderComponent.dirty`. That flag only flips when the
     * CONSUMER calls `markDirty()` -- the builder cannot see inside an element,
     * as its own docblock says -- and this page never calls it. So it catches
     * add / remove / reorder and misses every CONTENT edit, which is the common
     * case: rename three fields, navigate away, work gone, guard silent.
     * (Measured in the browser: editing a label left the page reporting clean.)
     *
     * Comparing the serialized form to the last saved snapshot cannot miss a
     * category of edit the way a hand-placed markDirty() call can. PUBLIC so
     * `unsavedChangesGuard` can read it off the route component; only ever
     * called at navigation / unload time, so serializing on demand is free.
     */
    dirty(): boolean {
        try {
            return JSON.stringify(this.serializeAll()) !== this.savedSnapshot;
        } catch {
            // Mid-teardown or half-built state must not trap the user.
            return false;
        }
    }

    /** Call after a load or a successful save. */
    private markSaved(): void {
        try {
            this.savedSnapshot = JSON.stringify(this.serializeAll());
        } catch {
            this.savedSnapshot = '';
        }
    }
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    /** Field-type catalogue (palette + per-field type select). */
    readonly types = signal<FormFieldTypeDto[]>([]);
    /** The ordered working list of fields (two-way into the substrate). */
    readonly fields = signal<FieldModel[]>([]);
    /** All form ids (FB-2 relation `targetFormId` / sub-form `formId` pickers). */
    readonly formIds = signal<string[]>([]);

    /** True in create mode (route `new`/no id); the Form ID input is shown. */
    readonly isNew = signal(true);
    /** The form id once known (route id in edit mode, or after a create save). */
    readonly currentId = signal('');
    /** Create-mode Form ID input value. */
    readonly formId = signal('');
    /** Where the loaded form lives (shipped / db / file) — drives the subtitle. */
    readonly source = signal<string | null>(null);
    /**
     * The loaded form's top-level options + data_class, carried through
     * load->save UNCHANGED (the builder doesn't surface them yet — FB-3 will edit
     * `formOptions.layout`). FB-0's replace save sends the FULL definition, so
     * these MUST round-trip or a replace would wipe a form's options/dataClass.
     */
    readonly formOptions = signal<Record<string, unknown>>({});
    readonly dataClass = signal<string | null>(null);
    readonly saving = signal(false);
    /** Bumped after each save to remount the live-preview <app-dynamic-form>. */
    readonly previewNonce = signal(0);

    /** Which builder tab is active: the flat Fields editor or the Layout tree. */
    readonly activeTab = signal<'fields' | 'layout'>('fields');
    /**
     * The editable `formOptions.layout` tree (FB-3). Seeded from the loaded
     * form's `formOptions.layout`, emitted back as a whole tree by
     * `<app-layout-tree-editor>`, and merged into `formOptions` on save.
     */
    readonly layoutNodes = signal<LayoutNode[]>([]);

    /** Every field alias (the layout editor's showWhen field picker + placement). */
    readonly fieldNames = computed<string[]>(() =>
        this.fields().map(f => this.fname(f).trim()).filter(n => n !== ''),
    );

    /** Field aliases already referenced as a leaf anywhere in the layout tree. */
    readonly placedAliases = computed<Set<string>>(() => {
        const placed = new Set<string>();
        const walk = (nodes: unknown[]): void => {
            for (const node of nodes) {
                if (typeof node === 'string') { placed.add(node); continue; }
                if (node && typeof node === 'object') {
                    const children = (node as Record<string, unknown>)['children'];
                    if (Array.isArray(children)) walk(children);
                }
            }
        };
        walk(this.layoutNodes());
        return placed;
    });

    /** Fields NOT yet placed in the layout — the tray + "+ field" picker source. */
    readonly unplacedFields = computed<string[]>(() => {
        const placed = this.placedAliases();
        return this.fieldNames().filter(n => !placed.has(n));
    });

    /** Palette entries projected from the field-type catalogue. */
    readonly palette = computed<OrderedPaletteEntry[]>(() =>
        this.types().map(t => ({ id: t.type, label: t.label })),
    );

    readonly headerTitle = computed(() =>
        this.isNew() ? 'New form' : (this.currentId() || 'Form'),
    );
    readonly headerSubtitle = computed(() => {
        const src = this.source();
        if (this.isNew() || !src) return 'Form Builder';
        switch (src) {
            case 'shipped': return 'Shipped by a module — saving creates an editable override';
            case 'db':      return 'Stored as a database override';
            case 'file':    return 'Stored as a user file';
            default:        return 'Form Builder';
        }
    });

    /** Save is enabled when the id is valid (create mode) and every field is named. */
    readonly canSave = computed(() => {
        const fs = this.fields();
        if (fs.length === 0) return false;
        if (fs.some(f => this.fname(f).trim() === '')) return false;
        if (this.isNew() && !/^[a-z0-9][a-z0-9_.:-]*$/.test(this.formId().trim())) return false;
        return true;
    });

    /**
     * Header keeps navigation only and Save is pinned to the detail footer --
     * both declared in the `form:builder` layout rather than here,
     * including WHEN Save refuses: an invalid draft, or a save already running.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    readonly footerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.footerActions, this.actionContext()),
    );

    private readonly actionContext = computed((): Record<string, unknown> => ({
        _canSave: this.canSave(),
        _saving:  this.saving(),
    }));

    constructor() {
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));
    }

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions on failure so the builder itself still opens.
        this.config.layout('form:builder').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.titleSvc.set('Form Builder');
        this.loadTypes();
        this.loadForms();
        const id = this.route.snapshot.paramMap.get('id');
        if (id && id !== 'new') {
            this.isNew.set(false);
            this.currentId.set(id);
            this.formId.set(id);
            this.loadForm(id);
        } else {
            this.isNew.set(true);
        }
    }

    // -- Loads ----------------------------------------------------------------

    private loadTypes(): void {
        this.forms.getFieldTypes().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: ts => this.types.set(ts),
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** Load all form ids for the FB-2 relation/sub-form target pickers (best-effort). */
    private loadForms(): void {
        this.forms.listForms().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: list => this.formIds.set(list.map(f => f.id).sort()),
            error: () => { /* picker degrades to a free-text id; non-fatal */ },
        });
    }

    private loadForm(id: string): void {
        this.forms.getForm(id).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: dto => {
                this.source.set(dto.source ?? null);
                this.formOptions.set(dto.formOptions ?? {});
                this.dataClass.set(dto.dataClass ?? null);
                this.fields.set(
                    Object.entries(dto.fields ?? {}).map(([k, e]) => this.deserialize(k, e)),
                );
                // FB-3: seed the layout editor from `formOptions.layout` (the
                // shared/default layout; per-context `layouts.{ctx}` is a follow-up).
                const layout = dto.formOptions?.['layout'];
                this.layoutNodes.set(Array.isArray(layout) ? (layout as LayoutNode[]) : []);
                this.previewNonce.update(n => n + 1);
                // Baseline AFTER the fields land, or the page reports
                // dirty from the moment it opens.
                this.markSaved();
            },
            error: (e: unknown) => {
                // A 404 means the form was deleted (or the URL is stale) — don't sit
                // in a broken edit state with an empty builder + a "not found"
                // preview; bounce back to the list.
                if (this.isNotFound(e)) {
                    this.toast.error(`Form "${id}" no longer exists`);
                    void this.router.navigate(['/forms']);
                    return;
                }
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    private isNotFound(e: unknown): boolean {
        return typeof e === 'object' && e !== null && (e as { status?: number }).status === 404;
    }

    // -- Header actions -------------------------------------------------------

    onHeaderAction(id: string): void {
        if (id === 'back') { void this.router.navigate(['/forms']); return; }
        if (id === 'save') { this.save(); return; }
    }

    setFormId(v: string): void {
        this.formId.set(v);
    }

    private save(): void {
        if (!this.canSave() || this.saving()) return;
        const fieldsMap = this.serializeAll();
        const create = this.isNew();
        const id = (create ? this.formId() : this.currentId()).trim();
        this.saving.set(true);
        const req$ = create
            ? this.forms.createForm({ id, fields: fieldsMap, formOptions: this.buildFormOptions() })
            // FB-0: edit always REPLACES (replace: true) with the FULL definition
            // — the builder holds the complete form, so this is the only path
            // where a deleted field / reordering actually persists. formOptions +
            // dataClass round-trip unchanged (untouched until FB-3 layout).
            : this.forms.updateForm(id, {
                  fields: fieldsMap,
                  formOptions: this.buildFormOptions(),
                  dataClass: this.dataClass(),
                  replace: true,
              });
        req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: dto => {
                this.saving.set(false);
                this.source.set(dto.source ?? this.source());
                this.toast.success(`Form "${id}" saved`);
                this.markSaved();
                if (create) {
                    // Re-route to the edit URL so subsequent saves PATCH; the
                    // component recreates and loads the persisted form (and its
                    // live preview) from the server.
                    void this.router.navigate(['/forms', id], { replaceUrl: true });
                } else {
                    this.previewNonce.update(n => n + 1);
                }
            },
            error: (e: unknown) => {
                this.saving.set(false);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    /**
     * Merge the FB-3 layout-tree edits into the form's `formOptions` for a
     * replace save: spread the carried-through options, then set (or drop)
     * `layout`. An empty tree REMOVES `layout` so the renderer falls back to
     * declaration order instead of persisting an empty array.
     */
    private buildFormOptions(): Record<string, unknown> {
        const opts: Record<string, unknown> = { ...this.formOptions() };
        const layout = this.layoutNodes();
        if (Array.isArray(layout) && layout.length > 0) opts['layout'] = layout;
        else delete opts['layout'];
        return opts;
    }

    // -- Substrate config (arrow props so `this` binds when passed as inputs) --

    readonly makeField: OrderedElementFactory = (typeId: string): OrderedElement | null => {
        const t = this.types().find(x => x.type === typeId);
        const defaults = t?.defaults ?? {};
        const attr = (defaults['attr'] as Record<string, unknown> | undefined) ?? {};
        const extraOptions: Record<string, unknown> = { ...defaults };
        delete extraOptions['label'];
        delete extraOptions['required'];
        delete extraOptions['help'];
        delete extraOptions['choices'];
        delete extraOptions['attr'];
        const extraAttr = { ...attr };
        delete extraAttr['placeholder'];
        if (Object.keys(extraAttr).length > 0) extraOptions['attr'] = extraAttr;
        return {
            name: this.uniqueName(typeId),
            type: typeId,
            label: this.humanize(typeId),
            required: false,
            help: typeof defaults['help'] === 'string' ? defaults['help'] : '',
            placeholder: typeof attr['placeholder'] === 'string' ? attr['placeholder'] : '',
            choices: t?.hasOptions ? [{ label: 'Option 1', value: 'option_1' }] : [],
            // FB-1 data-source defaults. A relation almost always loads from an
            // API, so seed its (shared) ds editor to `api`; everything else static.
            dsType: typeId === 'relation' ? 'api' : 'static',
            dsClass: '',
            dsRoute: '',
            dsBindValue: '',
            dsBindLabel: '',
            dsMultiple: typeId === 'relation',
            dsWidget: typeId === 'relation' ? 'select-search' : 'select',
            // FB-2 relation / sub-form defaults (only meaningful for those types).
            relCardinality: 'one',
            relMaxItems: '',
            relTargetFormId: '',
            subFormId: '',
            subRelation: 'one',
            subMaxItems: '',
            _extraOptions: extraOptions,
            _extraConstraints: {},
            _extraEntry: {},
        };
    };

    readonly labelOfField = (el: OrderedElement): string => {
        const f = el;
        const label = String(f['label'] ?? '').trim();
        const name = String(f['name'] ?? '').trim();
        return label || name || String(f['type'] ?? 'Field');
    };

    // -- Field getters (the model is an opaque Record) ------------------------

    fname(f: FieldModel): string { return String(f['name'] ?? ''); }
    ftype(f: FieldModel): string { return String(f['type'] ?? ''); }
    flabel(f: FieldModel): string { return String(f['label'] ?? ''); }
    frequired(f: FieldModel): boolean { return f['required'] === true; }
    fhelp(f: FieldModel): string { return String(f['help'] ?? ''); }
    fplaceholder(f: FieldModel): string { return String(f['placeholder'] ?? ''); }
    choicesOf(f: FieldModel): ChoiceRow[] {
        return Array.isArray(f['choices']) ? (f['choices'] as ChoiceRow[]) : [];
    }

    isChoiceType(type: string): boolean {
        return this.types().find(t => t.type === type)?.hasOptions ?? false;
    }

    // -- FB-1: data-source editor (select fields) -----------------------------
    // The platform `dataSource` model (static / enum / api) drives how a select's
    // options come to be; the builder emits `options.dataSource` and the render
    // builder resolves it. `enum`/`api` are developer-supplied (FQCN / route name).

    readonly dsSources: ReadonlyArray<{ id: string; label: string }> = [
        { id: 'static', label: 'Static' },
        { id: 'enum',   label: 'Enum' },
        { id: 'api',    label: 'API' },
    ];

    dsType(f: FieldModel): string {
        const v = String(f['dsType'] ?? 'static');
        return ['static', 'enum', 'api'].includes(v) ? v : 'static';
    }
    dsClass(f: FieldModel): string { return String(f['dsClass'] ?? ''); }
    dsRoute(f: FieldModel): string { return String(f['dsRoute'] ?? ''); }
    dsBindValue(f: FieldModel): string { return String(f['dsBindValue'] ?? ''); }
    dsBindLabel(f: FieldModel): string { return String(f['dsBindLabel'] ?? ''); }
    dsMultiple(f: FieldModel): boolean { return f['dsMultiple'] === true; }
    dsWidget(f: FieldModel): string { return String(f['dsWidget'] ?? 'select'); }

    /**
     * Type-select options for a field: the catalogue PLUS the field's own
     * current type when the catalogue doesn't offer it (e.g. `relation`,
     * `optionsEditor`, `subform`, `localizedText` — types a real shipped form
     * uses but the builder palette doesn't surface). Without this the select
     * renders blank for such a field and SAVING would serialise an empty
     * `type` — corrupting it. Keeping the current value preserves it verbatim.
     */
    typeOptionsFor(field: FieldModel): Array<{ type: string; label: string }> {
        const opts = this.types().map(t => ({ type: t.type, label: t.label }));
        const current = this.ftype(field);
        if (current !== '' && !opts.some(o => o.type === current)) {
            opts.push({ type: current, label: `${this.humanize(current)} (current)` });
        }
        return opts;
    }

    // -- Field mutations (immutable on the signal) ----------------------------

    private patch(i: number, patch: Record<string, unknown>): void {
        this.fields.update(fs => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f));
    }

    setName(i: number, v: string): void { this.patch(i, { name: v }); }
    setLabel(i: number, v: string): void { this.patch(i, { label: v }); }
    setRequired(i: number, v: boolean): void { this.patch(i, { required: v }); }
    setHelp(i: number, v: string): void { this.patch(i, { help: v }); }
    setPlaceholder(i: number, v: string): void { this.patch(i, { placeholder: v }); }

    setType(i: number, v: string): void {
        const seedChoices = this.isChoiceType(v);
        this.fields.update(fs => fs.map((f, idx) => {
            if (idx !== i) return f;
            const next: Record<string, unknown> = { ...f, type: v };
            if (seedChoices) {
                if (next['dsType'] === undefined) next['dsType'] = 'static';
                if (this.dsType(f) === 'static' && this.choicesOf(f).length === 0) {
                    next['choices'] = [{ label: 'Option 1', value: 'option_1' }];
                }
            }
            return next;
        }));
    }

    addChoice(i: number): void {
        this.fields.update(fs => fs.map((f, idx) => idx === i
            ? { ...f, choices: [...this.choicesOf(f), { label: '', value: '' }] }
            : f));
    }

    removeChoice(i: number, j: number): void {
        this.fields.update(fs => fs.map((f, idx) => idx === i
            ? { ...f, choices: this.choicesOf(f).filter((_, k) => k !== j) }
            : f));
    }

    setChoiceLabel(i: number, j: number, v: string): void {
        this.mutateChoice(i, j, c => ({ ...c, label: v }));
    }

    setChoiceValue(i: number, j: number, v: string): void {
        this.mutateChoice(i, j, c => ({ ...c, value: v }));
    }

    private mutateChoice(i: number, j: number, fn: (c: ChoiceRow) => ChoiceRow): void {
        this.fields.update(fs => fs.map((f, idx) => idx === i
            ? { ...f, choices: this.choicesOf(f).map((c, k) => k === j ? fn(c) : c) }
            : f));
    }

    setDsType(i: number, v: string): void {
        this.fields.update(fs => fs.map((f, idx) => {
            if (idx !== i) return f;
            const next: Record<string, unknown> = { ...f, dsType: v };
            // Seed a first option when switching to Static with none yet.
            if (v === 'static' && this.choicesOf(f).length === 0) {
                next['choices'] = [{ label: 'Option 1', value: 'option_1' }];
            }
            return next;
        }));
    }
    setDsClass(i: number, v: string): void { this.patch(i, { dsClass: v }); }
    setDsRoute(i: number, v: string): void { this.patch(i, { dsRoute: v }); }
    setDsBindValue(i: number, v: string): void { this.patch(i, { dsBindValue: v }); }
    setDsBindLabel(i: number, v: string): void { this.patch(i, { dsBindLabel: v }); }
    setDsMultiple(i: number, v: boolean): void { this.patch(i, { dsMultiple: v }); }
    setDsWidget(i: number, v: string): void { this.patch(i, { dsWidget: v }); }

    // -- FB-2: relation / sub-form inspectors ---------------------------------
    // relation -> options.relation {cardinality, maxItems?, targetFormId?, dataSource}
    //   (the dataSource reuses the ds* editor above — a field is either select
    //    OR relation, so the shared fields never collide).
    // subform  -> options.subForm {formId, relation, maxItems?}.

    relCardinality(f: FieldModel): string { return f['relCardinality'] === 'many' ? 'many' : 'one'; }
    relMaxItems(f: FieldModel): string { return String(f['relMaxItems'] ?? ''); }
    relTargetFormId(f: FieldModel): string { return String(f['relTargetFormId'] ?? ''); }
    subFormId(f: FieldModel): string { return String(f['subFormId'] ?? ''); }
    subRelation(f: FieldModel): string { return f['subRelation'] === 'many' ? 'many' : 'one'; }
    subMaxItems(f: FieldModel): string { return String(f['subMaxItems'] ?? ''); }

    setRelCardinality(i: number, v: string): void { this.patch(i, { relCardinality: v }); }
    setRelMaxItems(i: number, v: string): void { this.patch(i, { relMaxItems: v }); }
    setRelTargetFormId(i: number, v: string): void { this.patch(i, { relTargetFormId: v }); }
    setSubFormId(i: number, v: string): void { this.patch(i, { subFormId: v }); }
    setSubRelation(i: number, v: string): void { this.patch(i, { subRelation: v }); }
    setSubMaxItems(i: number, v: string): void { this.patch(i, { subMaxItems: v }); }

    // -- (De)serialisation: working model ↔ wire FormFieldEntry ---------------

    private serializeAll(): FormFieldsMap {
        const out: Record<string, FormFieldEntry> = {};
        for (const f of this.fields()) {
            const name = this.fname(f).trim();
            if (name === '') continue;
            const options: Record<string, unknown> = {
                ...((f['_extraOptions'] as Record<string, unknown>) ?? {}),
            };
            const label = this.flabel(f).trim();
            if (label !== '') options['label'] = label;
            const required = this.frequired(f);
            options['required'] = required;
            const help = this.fhelp(f).trim();
            if (help !== '') options['help'] = help;
            const placeholder = this.fplaceholder(f).trim();
            if (placeholder !== '') {
                options['attr'] = {
                    ...(options['attr'] ?? {}),
                    placeholder,
                };
            }
            if (this.isChoiceType(this.ftype(f))) {
                // FB-1: emit the canonical `options.dataSource` for select fields
                // (static / enum / api). Migrate away from the legacy `choices` /
                // `enumClass` shapes (the render builder reads dataSource first).
                options['dataSource'] = this.buildDataSource(f);
                delete options['choices'];
                delete options['enumClass'];
            } else if (this.ftype(f) === 'relation') {
                // FB-2: relation -> options.relation {cardinality, maxItems?,
                // targetFormId?, dataSource} (the dataSource reuses the ds* editor).
                const rel: Record<string, unknown> = { cardinality: this.relCardinality(f) };
                const max = parseInt(this.relMaxItems(f), 10);
                if (!Number.isNaN(max) && max > 0) rel['maxItems'] = max;
                const tgt = this.relTargetFormId(f).trim();
                if (tgt !== '') rel['targetFormId'] = tgt;
                rel['dataSource'] = this.buildDataSource(f);
                options['relation'] = rel;
                delete options['dataSource'];
                delete options['choices'];
            } else if (this.ftype(f) === 'subform') {
                // FB-2: sub-form -> options.subForm {formId, relation, maxItems?}.
                const sub: Record<string, unknown> = {
                    formId: this.subFormId(f).trim(),
                    relation: this.subRelation(f),
                };
                const max = parseInt(this.subMaxItems(f), 10);
                if (!Number.isNaN(max) && max > 0) sub['maxItems'] = max;
                options['subForm'] = sub;
            }
            const constraints: Record<string, unknown> = {
                ...((f['_extraConstraints'] as Record<string, unknown>) ?? {}),
            };
            if (required) constraints['NotBlank'] = null;
            else delete constraints['NotBlank'];

            // Top-level entry keys the inspector doesn't surface (e.g.
            // `mapping.property_path`) pass through verbatim. Under FB-0's
            // replace save the merge no longer backfills them, so dropping
            // `_extraEntry` here would silently lose a field's mapping.
            const entry: Record<string, unknown> = {
                ...((f['_extraEntry'] as Record<string, unknown>) ?? {}),
                type: this.ftype(f),
                options,
            };
            if (Object.keys(constraints).length > 0) entry['constraints'] = constraints;
            out[name] = entry as unknown as FormFieldEntry;
        }
        return out;
    }

    /** Build the canonical `options.dataSource` for a select field (FB-1). */
    private buildDataSource(f: FieldModel): Record<string, unknown> {
        const type = this.dsType(f);
        const ds: Record<string, unknown> = { type };
        if (type === 'static') {
            ds['options'] = this.choicesOf(f)
                .map(c => ({ value: (c.value ?? '').trim() || (c.label ?? '').trim(), label: (c.label ?? '').trim() }))
                .filter(o => o.label !== '' || o.value !== '');
        } else if (type === 'enum') {
            const cls = this.dsClass(f).trim();
            if (cls !== '') ds['class'] = cls;
        } else if (type === 'api') {
            const route = this.dsRoute(f).trim();
            if (route !== '') ds['route'] = route;
            const bv = this.dsBindValue(f).trim();
            if (bv !== '') ds['bindValue'] = bv;
            const bl = this.dsBindLabel(f).trim();
            if (bl !== '') ds['bindLabel'] = bl;
        }
        if (this.dsMultiple(f)) ds['multiple'] = true;
        const widget = this.dsWidget(f);
        if (widget && widget !== 'select') ds['widget'] = widget;
        return ds;
    }

    /** Parse a legacy `options.choices` (map OR array of {value,label}) into rows. */
    private choicesFromRaw(raw: unknown): ChoiceRow[] {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return Object.entries(raw as Record<string, unknown>)
                .map(([l, v]) => ({ label: l, value: String(v) }));
        }
        if (Array.isArray(raw)) {
            return (raw as unknown[]).map(c => {
                if (c && typeof c === 'object') {
                    const o = c as Record<string, unknown>;
                    return { label: String(o['label'] ?? ''), value: String(o['value'] ?? '') };
                }
                return { label: String(c), value: String(c) };
            });
        }
        return [];
    }

    private deserialize(key: string, entry: FormFieldEntry): FieldModel {
        const opts = entry.options ?? {};
        const constraints = entry.constraints ?? {};
        const attr = (opts['attr'] as Record<string, unknown> | undefined) ?? {};

        // FB-2 relation / sub-form objects.
        const isRelation = entry.type === 'relation';
        const relObj = (opts['relation'] && typeof opts['relation'] === 'object' && !Array.isArray(opts['relation']))
            ? (opts['relation'] as Record<string, unknown>) : {};
        const subObj = (opts['subForm'] && typeof opts['subForm'] === 'object' && !Array.isArray(opts['subForm']))
            ? (opts['subForm'] as Record<string, unknown>) : {};

        // FB-1/FB-2 data-source — for a relation it lives at `options.relation.dataSource`;
        // for a select at `options.dataSource` (else legacy `enumClass`/`choices`).
        const dsSource = isRelation ? relObj['dataSource'] : opts['dataSource'];
        const ds = (dsSource && typeof dsSource === 'object' && !Array.isArray(dsSource))
            ? (dsSource as Record<string, unknown>) : null;
        let dsType = isRelation ? 'api' : 'static';
        let dsClass = '', dsRoute = '', dsBindValue = '', dsBindLabel = '';
        let dsMultiple = false, dsWidget = 'select';
        let choices: ChoiceRow[] = [];
        if (ds) {
            const t = String(ds['type'] ?? 'static');
            dsType = ['static', 'enum', 'api'].includes(t) ? t : 'static';
            dsMultiple = ds['multiple'] === true;
            dsWidget = typeof ds['widget'] === 'string' ? ds['widget'] : 'select';
            if (dsType === 'static') choices = this.choicesFromRaw(ds['options']);
            else if (dsType === 'enum') dsClass = String(ds['class'] ?? '');
            else if (dsType === 'api') {
                dsRoute = String(ds['route'] ?? '');
                dsBindValue = String(ds['bindValue'] ?? '');
                dsBindLabel = String(ds['bindLabel'] ?? '');
            }
        } else if (typeof opts['enumClass'] === 'string') {
            dsType = 'enum';
            dsClass = opts['enumClass'];
        } else {
            choices = this.choicesFromRaw(opts['choices']);
        }

        const relCardinality = relObj['cardinality'] === 'many' ? 'many' : 'one';
        const relMaxItems = relObj['maxItems'] != null ? String(relObj['maxItems']) : '';
        const relTargetFormId = String(relObj['targetFormId'] ?? '');
        const subFormId = String(subObj['formId'] ?? '');
        const subRelation = subObj['relation'] === 'many' ? 'many' : 'one';
        const subMaxItems = subObj['maxItems'] != null ? String(subObj['maxItems']) : '';

        const extraOptions: Record<string, unknown> = { ...opts };
        delete extraOptions['label'];
        delete extraOptions['required'];
        delete extraOptions['help'];
        delete extraOptions['choices'];
        delete extraOptions['dataSource'];
        delete extraOptions['enumClass'];
        delete extraOptions['relation'];
        delete extraOptions['subForm'];
        const extraAttr = { ...attr };
        delete extraAttr['placeholder'];
        if (Object.keys(extraAttr).length > 0) extraOptions['attr'] = extraAttr;
        else delete extraOptions['attr'];

        const extraConstraints = { ...constraints };
        delete extraConstraints['NotBlank'];

        // Capture top-level entry keys the inspector doesn't surface (notably
        // `mapping`) so the replace save can round-trip them untouched.
        const extraEntry: Record<string, unknown> = { ...(entry as unknown as Record<string, unknown>) };
        delete extraEntry['type'];
        delete extraEntry['options'];
        delete extraEntry['constraints'];

        return {
            name: key,
            type: entry.type,
            label: String(opts['label'] ?? ''),
            required: opts['required'] === true || ('NotBlank' in constraints),
            help: String(opts['help'] ?? ''),
            placeholder: String(attr['placeholder'] ?? ''),
            choices,
            dsType,
            dsClass,
            dsRoute,
            dsBindValue,
            dsBindLabel,
            dsMultiple,
            dsWidget,
            relCardinality,
            relMaxItems,
            relTargetFormId,
            subFormId,
            subRelation,
            subMaxItems,
            _extraOptions: extraOptions,
            _extraConstraints: extraConstraints,
            _extraEntry: extraEntry,
        };
    }

    // -- Helpers --------------------------------------------------------------

    private uniqueName(base: string): string {
        const clean = base.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'field';
        const existing = new Set(this.fields().map(f => this.fname(f)));
        let n = 1;
        let name = `${clean}_${n}`;
        while (existing.has(name)) { n++; name = `${clean}_${n}`; }
        return name;
    }

    private humanize(name: string): string {
        const spaced = name
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_\-.:]+/g, ' ')
            .trim();
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
}
