import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { defer, EMPTY, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ContentFieldDescriptorDto, ContentFieldPanelDto, ContentFieldPanelsService } from './content-field-panels.service';
import { FieldWidgetHostComponent, FieldWidgetRegistry, ToastService } from '@coolms/ui-angular';

/**
 * Renders the module-contributed field-set panels (ADR-129, W1.d) that apply to
 * one content node and saves edits to its `extras`.
 *
 * Self-contained: given a node `path`, it fetches `/content/field-panels?path=`,
 * renders each panel (e.g. the **Blog** post-settings set: author / publish date
 * / categories / tags) as labelled inputs keyed off the field `type`, and writes
 * changes back via a generic VFS merge-patch on its own "Save fields" button.
 * Renders nothing when the node has no applicable panels — so dropping it into
 * an editor is a no-op for plain pages and lights up automatically for posts in
 * a collection that opts into a field set.
 *
 * Every input is resolved through the **field-widget registry** (`<app-field-
 * widget-host>`): a module-contributed widget by its `widget.kind` (e.g. the Tag
 * module's tags input, a taxonomy picker) when one is installed, else the
 * built-in `text` / `textarea` / `date` widget keyed off the field `type`
 * (unknown types fall back to `text`). There is no hardcoded per-type input
 * branch — the registry is the single resolution path.
 */
@Component({
    selector: 'app-content-field-panels',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FieldWidgetHostComponent],
    template: `
        @if (panels().length > 0) {
            <div class="cfp">
                @for (panel of panels(); track panel.group) {
                    <div class="cfp__panel">
                        <div class="cfp__panel-title">{{ panel.label }}</div>
                        <div class="cfp__fields">
                            @for (field of panel.fields; track field.name) {
                                <div class="cfp__field">
                                    <label class="cms-label">{{ field.label }}</label>
                                    <!-- Every input resolves through the field-widget registry:
                                         a module widget by widget.kind (e.g. tags / taxonomy),
                                         else the built-in text / textarea / date widget by the
                                         field type (unknown types fall back to text). -->
                                    <app-field-widget-host
                                        [kind]="widgetKind(field)"
                                        [value]="fieldValue(field.name)"
                                        [config]="field.widget ?? {}"
                                        [disabled]="!!field.locked"
                                        [valueChange]="changeFn(field.name)" />
                                </div>
                            }
                        </div>
                    </div>
                }
                @if (!embedded()) {
                    <div class="cfp__actions">
                        <button class="cms-btn cms-btn-primary cms-btn-sm"
                                [disabled]="!dirty() || saving()"
                                (click)="save()">
                            {{ saving() ? 'Saving…' : 'Save fields' }}
                        </button>
                    </div>
                }
            </div>
        }
    `,
    styles: [`
        .cfp { display: flex; flex-direction: column; gap: 12px; width: 100%; }
        .cfp__panel {
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
            padding: 10px 12px;
            background: var(--cms-surface);
        }
        .cfp__panel-title {
            font-size: .75rem; font-weight: 600; text-transform: uppercase;
            letter-spacing: .04em; color: var(--cms-text-muted);
            margin-bottom: 8px;
        }
        .cfp__fields { display: flex; flex-wrap: wrap; gap: 12px; }
        .cfp__field { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 2px; }
        .cfp__field textarea { resize: vertical; }
        .cfp__actions { display: flex; justify-content: flex-end; }
    `],
})
export class ContentFieldPanelsComponent {
    private readonly svc = inject(ContentFieldPanelsService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly fieldWidgets = inject(FieldWidgetRegistry);

    /** VFS path of the node whose module field panels to render. */
    readonly path = input.required<string>();
    /**
     * Hide the built-in "Save fields" button — set when a host (e.g. the page
     * editor's single-Save) drives `dirty()`/`save()` from outside.
     */
    readonly embedded = input(false);
    /** Emitted after a successful save (so a host can react, e.g. refresh). */
    readonly saved = output<void>();

    readonly panels = signal<readonly ContentFieldPanelDto[]>([]);
    readonly saving = signal(false);
    readonly dirty = signal(false);
    private readonly model = signal<Record<string, unknown>>({});
    /** Per-field change callbacks, cached so a field's `valueChange` keeps a stable identity. */
    private readonly changeFns = new Map<string, (value: unknown) => void>();
    private loadedPath = '';

    constructor() {
        // Re-fetch whenever the bound path changes (load is async — no signal
        // is written synchronously here, so this never feeds back on itself).
        effect(() => {
            const p = this.path();
            if (p && p !== this.loadedPath) {
                this.loadedPath = p;
                this.load(p);
            }
        });
    }

    /** The current value of a field (null when unset). */
    fieldValue(name: string): unknown {
        return this.model()[name] ?? null;
    }

    /**
     * The widget kind to render a field with: a module-contributed widget by
     * `widget.kind` (e.g. tags / taxonomy) when installed, else the built-in
     * widget for the field `type` (text / textarea / date). An unknown / unset
     * type falls back to `text`, so every field resolves to a registered widget.
     */
    widgetKind(field: ContentFieldDescriptorDto): string {
        const kind = field.widget?.kind ?? field.type;
        return this.fieldWidgets.componentFor(kind) ? kind : 'text';
    }

    /** A stable per-field change callback (identity preserved across renders). */
    changeFn(name: string): (value: unknown) => void {
        let fn = this.changeFns.get(name);
        if (!fn) {
            fn = (value: unknown) => this.onChange(name, value);
            this.changeFns.set(name, fn);
        }
        return fn;
    }

    onChange(name: string, value: unknown): void {
        this.model.update(m => ({ ...m, [name]: value === '' ? null : value }));
        this.dirty.set(true);
    }

    /**
     * The save as a **cold** Observable, for an embedded host that has to
     * *sequence* this write against other writers on the same node (see the
     * page editor's `saveAll`: this panel, the landing block editor and the
     * page-size control all merge-patch one `extras` JSON column, and the
     * server persists that column whole — overlapping them loses an update).
     * Owns this panel's `saving`/`dirty` state and the `saved` output; the
     * host owns the toast, so one Save reports once.
     *
     * Nothing to save (pristine or already in flight) yields an empty stream —
     * safe to drop into a `concat` chain.
     */
    save$(): Observable<unknown> {
        if (!this.dirty() || this.saving()) return EMPTY;
        // `defer` so the flag flips and the model is read at SUBSCRIBE time —
        // in a sequential chain this op starts long after it was built.
        return defer(() => {
            this.saving.set(true);
            return this.svc.save(this.loadedPath, this.model());
        }).pipe(
            tap({
                next: () => {
                    this.saving.set(false);
                    this.dirty.set(false);
                    this.saved.emit();
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.saving.set(false);
                    this.cdr.markForCheck();
                },
            }),
        );
    }

    /** The built-in "Save fields" button: {@see save$} plus this panel's toast. */
    save(): void {
        this.save$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => this.toast.success('Saved'),
                error: () => this.toast.error('Save failed'),
            });
    }

    private load(path: string): void {
        this.svc.fetch(path)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: dto => {
                    this.panels.set(dto.panels ?? []);
                    this.model.set({ ...(dto.values ?? {}) });
                    this.dirty.set(false);
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.panels.set([]);
                    this.cdr.markForCheck();
                },
            });
    }
}
