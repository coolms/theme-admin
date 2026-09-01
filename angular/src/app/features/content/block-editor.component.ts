import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable } from 'rxjs';
import {
    BlockEditorService,
    BlockFieldSchemaDto,
    BlockModel,
    BlockTypeSchemaDto,
} from './block-editor.service';
import {
    OrderedBuilderComponent,
    OrderedElement,
    OrderedElementFactory,
    OrderedPaletteEntry,
    OrderedSaveFn,
} from '@coolms/ui-angular';

/**
 * Landing-page section builder (, W5.d) — the admin authoring surface
 * for `extras.blocks`.
 *
 * Self-contained and self-hiding: given a page `path`, it fetches
 * `/content/landing-blocks?path=` and renders ONLY when the node's
 * `contentType === 'landing'` (so dropping it into the page editor is a no-op
 * for every other page).
 *
 * The ordered-list machinery — the type palette (click / drag to place), the
 * drag-drop reorder, move ↑/↓, remove, dirty/Save plumbing — lives in the
 * generic {@link OrderedBuilderComponent} substrate. This component is
 * the landing-block *consumer*: it owns the `blocks` source signal (two-way into
 * the builder), the block-type catalog, the page-load lifecycle, and the
 * per-block field inspector (a projected `<ng-template>`) driven by the catalog's
 * field schema:
 *
 *   - `text`  -> a plain input
 *   - `url`   -> an input + an allow-list hint (the backend re-validates the
 *               scheme on render; this is just guidance)
 *   - `group` -> a repeater of sub-rows (e.g. `features.items`, `faq.items`)
 *
 * "Save sections" merge-patches `extras.blocks`; the SSR renderer reads it live,
 * so the public page updates without a republish. Validation stays server-side,
 * so the editor never needs the rules — only the field shapes.
 */
@Component({
    selector: 'app-block-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, OrderedBuilderComponent],
    template: `
        @if (isLanding()) {
            <app-ordered-builder
                [elements]="blocks()"
                (elementsChange)="blocks.set($event)"
                [palette]="palette()"
                [factory]="makeBlock"
                [labelOf]="labelOfBlock"
                [saveFn]="saveBlocks"
                [embedded]="embedded()"
                paletteLabel="Add section"
                emptyText="No sections yet — add one from the palette above (click or drag)."
                saveLabel="Save sections"
                savedMessage="Sections saved"
                (saved)="saved.emit()">
                <ng-template let-block let-i="index">
                    @for (field of fieldsOf(block); track field.name) {
                        @if (field.kind === 'group') {
                            <div class="blk__group">
                                <div class="blk__group-head">
                                    <label class="cms-label">{{ humanize(field.name) }}</label>
                                    <button class="cms-btn cms-btn-sm"
                                            (click)="addItem(i, field.name)">
                                        <i class="bi bi-plus-lg"></i> Add
                                    </button>
                                </div>
                                @for (item of itemsOf(block, field.name); track $index; let j = $index) {
                                    <div class="blk__item">
                                        @for (sub of field.itemFields; track sub.name) {
                                            <div class="blk__field">
                                                <label class="cms-label cms-label--sm">{{ humanize(sub.name) }}</label>
                                                @if (sub.kind === 'textarea') {
                                                    <textarea class="cms-input cms-input-sm" rows="2"
                                                              [ngModel]="itemVal(item, sub.name)"
                                                              (ngModelChange)="setItemField(i, field.name, j, sub.name, $event)"></textarea>
                                                } @else {
                                                    <input class="cms-input cms-input-sm"
                                                           [type]="sub.kind === 'url' ? 'url' : 'text'"
                                                           [ngModel]="itemVal(item, sub.name)"
                                                           (ngModelChange)="setItemField(i, field.name, j, sub.name, $event)" />
                                                }
                                            </div>
                                        }
                                        <button class="cms-btn cms-btn-sm blk__danger blk__item-del"
                                                title="Remove row"
                                                (click)="removeItem(i, field.name, j)">
                                            <i class="bi bi-x-lg"></i>
                                        </button>
                                    </div>
                                }
                            </div>
                        } @else if (field.kind === 'textarea') {
                            <div class="blk__field">
                                <label class="cms-label">{{ humanize(field.name) }}</label>
                                <textarea class="cms-input cms-input-sm" rows="2"
                                          [ngModel]="fieldVal(block, field.name)"
                                          (ngModelChange)="setField(i, field.name, $event)"></textarea>
                            </div>
                        } @else {
                            <div class="blk__field">
                                <label class="cms-label">{{ humanize(field.name) }}</label>
                                <input class="cms-input cms-input-sm"
                                       [type]="(field.kind === 'url' || field.kind === 'embed') ? 'url' : 'text'"
                                       [ngModel]="fieldVal(block, field.name)"
                                       (ngModelChange)="setField(i, field.name, $event)" />
                                @if (field.kind === 'url') {
                                    <small class="blk__hint">/path, #anchor, https://, mailto:, tel:</small>
                                } @else if (field.kind === 'embed') {
                                    <small class="blk__hint">YouTube or Vimeo link — converted to a safe embed</small>
                                }
                            </div>
                        }
                    }
                </ng-template>
            </app-ordered-builder>
        }
    `,
    styles: [`
        /* Per-block field inspector styles. The list/palette/card/save chrome
           lives in the OrderedBuilder substrate; these style the projected body
           template (rendered inside the builder's .ob__body flex row). */
        .blk__field { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; }
        .blk__hint { font-size: .6875rem; color: var(--cms-text-muted); }
        .cms-label--sm { font-size: .6875rem; }
        .blk__danger { color: var(--cms-danger, #dc2626); }
        .blk__group {
            flex: 1 0 100%; display: flex; flex-direction: column; gap: 6px;
            border: 1px dashed var(--cms-border); border-radius: var(--cms-radius, 6px);
            padding: 8px;
        }
        .blk__group-head { display: flex; align-items: center; justify-content: space-between; }
        .blk__item {
            display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end;
            padding: 6px; border-radius: var(--cms-radius-sm, 4px); background: var(--cms-border-light);
        }
        .blk__item-del { margin-left: auto; }
    `],
})
export class BlockEditorComponent {
    private readonly svc = inject(BlockEditorService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);

    /** VFS path of the page Package whose sections to edit. */
    readonly path = input.required<string>();
    /**
     * Hides the builder's own "Save sections" button so a host can drive the
     * save through one window-level button (mirrors the Fields panel's embedded
     * mode). The host calls {@see save} and reads {@see dirty}; the add-section
     * palette and per-card controls stay.
     */
    readonly embedded = input(false);
    /** Emitted after a successful save (so a host can react). */
    readonly saved = output<void>();
    /**
     * Emitted on load with whether this is a landing page (the editor is
     * visible). The page editor uses it to drop the now-redundant rich-text
     * body editor and let the block list become the scrollable main area.
     */
    readonly activeChange = output<boolean>();

    /** The generic ordered-list substrate this component drives. Null until the
     *  page is a landing page (it lives inside the `@if`). */
    private readonly builder = viewChild(OrderedBuilderComponent);

    readonly types = signal<readonly BlockTypeSchemaDto[]>([]);
    readonly blocks = signal<BlockModel[]>([]);
    readonly contentType = signal<string | null>(null);

    readonly isLanding = computed(() => this.contentType() === 'landing');

    /** Palette entries for the substrate, projected from the block-type catalog. */
    readonly palette = computed<OrderedPaletteEntry[]>(() =>
        this.types().map(t => ({ id: t.id, label: t.label })),
    );

    /** Dirty state — delegated to the substrate (false when not a landing page). */
    readonly dirty = computed(() => this.builder()?.dirty() ?? false);

    private loadedPath = '';

    constructor() {
        // Re-fetch whenever the bound path changes (load is async — guards on
        // path change so it never feeds back on itself, mirroring the content
        // field panels component).
        effect(() => {
            const p = this.path();
            if (p && p !== this.loadedPath) {
                this.loadedPath = p;
                this.load(p);
            }
        });
    }

    /** Drive the substrate's save (called by the host's single Save button). */
    save(): void {
        this.builder()?.save();
    }

    /**
     * The substrate's save as a cold Observable — see
     * {@link OrderedBuilderComponent.save$}. The page editor uses this instead
     * of {@see save} so the blocks write is *sequenced* against the other
     * writers on the same Package node's `extras` column (the Fields panel and
     * the page-size control) rather than racing them.
     */
    save$(): Observable<unknown> {
        return this.builder()?.save$() ?? EMPTY;
    }

    // -- Substrate config (arrow props so `this` is bound when passed as inputs) --

    /** Build a default block of `id` from its type's field schema, or null. */
    readonly makeBlock: OrderedElementFactory = (id: string): OrderedElement | null => {
        const type = this.types().find(t => t.id === id);
        if (!type) return null;
        const fresh: BlockModel = { type: id };
        for (const f of type.fields) {
            fresh[f.name] = f.kind === 'group' ? [] : '';
        }
        return fresh;
    };

    readonly labelOfBlock = (el: OrderedElement): string => this.typeLabel(el);

    readonly saveBlocks: OrderedSaveFn = (els: OrderedElement[]) =>
        this.svc.save(this.loadedPath, els);

    // -- Lookups / formatting ------------------------------------------------

    typeFor(block: BlockModel): BlockTypeSchemaDto | undefined {
        return this.types().find(t => t.id === block['type']);
    }

    typeLabel(block: BlockModel): string {
        return this.typeFor(block)?.label ?? String(block['type'] ?? 'Block');
    }

    fieldsOf(block: BlockModel): readonly BlockFieldSchemaDto[] {
        return this.typeFor(block)?.fields ?? [];
    }

    fieldVal(block: BlockModel, name: string): string {
        const v = block[name];
        return v == null ? '' : String(v);
    }

    itemsOf(block: BlockModel, name: string): Record<string, unknown>[] {
        const v = block[name];
        return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    }

    itemVal(item: Record<string, unknown>, sub: string): string {
        const v = item[sub];
        return v == null ? '' : String(v);
    }

    /** camelCase / snake -> "Title Case" label. */
    humanize(name: string): string {
        const spaced = name
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .trim();
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }

    // -- Per-block content mutations (immutable on the signal) ----------------
    //
    // The substrate owns structural ops (add / insert / move / remove / reorder);
    // these are the block-specific *content* edits. Each mutates `blocks` (which
    // flows back into the builder) and marks the builder dirty.

    setField(i: number, name: string, value: string): void {
        this.blocks.update(bs => bs.map((b, idx) => idx === i ? { ...b, [name]: value } : b));
        this.markDirty();
    }

    addItem(i: number, name: string): void {
        const field = this.fieldsOf(this.blocks()[i]).find(f => f.name === name);
        const row: Record<string, unknown> = {};
        for (const sub of field?.itemFields ?? []) row[sub.name] = '';
        this.blocks.update(bs => bs.map((b, idx) => {
            if (idx !== i) return b;
            const items = this.itemsOf(b, name);
            return { ...b, [name]: [...items, row] };
        }));
        this.markDirty();
    }

    removeItem(i: number, name: string, j: number): void {
        this.blocks.update(bs => bs.map((b, idx) => {
            if (idx !== i) return b;
            const items = this.itemsOf(b, name).filter((_, k) => k !== j);
            return { ...b, [name]: items };
        }));
        this.markDirty();
    }

    setItemField(i: number, name: string, j: number, sub: string, value: string): void {
        this.blocks.update(bs => bs.map((b, idx) => {
            if (idx !== i) return b;
            const items = this.itemsOf(b, name).map((it, k) => k === j ? { ...it, [sub]: value } : it);
            return { ...b, [name]: items };
        }));
        this.markDirty();
    }

    private markDirty(): void {
        this.builder()?.markDirty();
    }

    // -- Load ----------------------------------------------------------------

    private load(path: string): void {
        this.svc.fetch(path)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: dto => {
                    this.types.set(dto.types ?? []);
                    this.contentType.set(dto.contentType ?? null);
                    // Deep-clone so the working copy is freely mutable.
                    this.blocks.set((dto.blocks ?? []).map(b => this.cloneBlock(b)));
                    this.builder()?.markPristine();
                    this.activeChange.emit(this.isLanding());
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.types.set([]);
                    this.contentType.set(null);
                    this.blocks.set([]);
                    this.builder()?.markPristine();
                    this.activeChange.emit(false);
                    this.cdr.markForCheck();
                },
            });
    }

    private cloneBlock(block: BlockModel): BlockModel {
        const copy: BlockModel = {};
        for (const [k, v] of Object.entries(block)) {
            copy[k] = Array.isArray(v)
                ? v.map(it => (it && typeof it === 'object') ? { ...it } : it)
                : v;
        }
        return copy;
    }
}
