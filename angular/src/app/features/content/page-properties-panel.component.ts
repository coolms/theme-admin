import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogService } from '@coolms/ui-angular';
import { errorMessage } from '../designer/shared/error-message';
import {
    ALL_LANGUAGES,
    type OwnPropertyDto,
    type PagePropertiesDto,
    PagePropertiesService,
    type PropertySourceDto,
} from './page-properties.service';

/** The ops an editor picks from; `reset` is its own button. */
export const PROPERTY_OPS: readonly { value: string; label: string }[] = [
    { value: 'append', label: 'Add to what is inherited' },
    { value: 'override', label: 'Replace what is inherited' },
    { value: 'stop', label: 'Stop inheritance here' },
];

interface Row {
    key: string;
    value: string;
}

/** One property's card: what the node sets in `scope`, as edited, and what it was read as. */
export interface PropertyCard {
    readonly name: string;
    readonly merge: string;
    readonly scope: string;
    readonly op: string;
    readonly rows: readonly Row[];
    /** The node's own set in `scope` when the rows were taken; null when it set nothing there. */
    readonly base: OwnPropertyDto | null;
    /** The version `base` was read at -- the one a save names. */
    readonly version: string;
    /**
     * Set when someone else changed this property since `base` (null: they removed it). While set, Save sends nothing:
     * the editor chooses "Save mine over theirs" or "Reload".
     */
    readonly theirs?: OwnPropertyDto | null;
    readonly note: string | null;
    readonly error: string | null;
    readonly saving: boolean;
}

/**
 * The page editor's page-properties panel (meta, og, twitter, x_default, and whatever the server declares): per
 * property, what applies to the page with where each value was set, and what the page sets itself.
 *
 * Each card saves itself, naming the version it was read at: a property is its own write, neither carried nor blocked
 * by the body's Save. When a save finds the properties changed (412), the card keeps the editor's rows AND its old
 * version; if THIS property changed, the other editor's values are shown and nothing is sent until the editor chooses
 * to save over them or to reload -- never a silent overwrite.
 */
@Component({
    selector: 'app-page-properties-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        @if (loadError(); as e) {
            <p class="pp__error" role="alert">{{ e }}</p>
        }
        @if (readOnly()) {
            <p class="pp-card__hint" role="status">You may read these properties but not change them.</p>
        }
        @if (view(); as v) {
            @for (c of cards(); track c.name) {
                <section class="pp-card" [attr.aria-label]="c.name">
                    <h4 class="pp-card__title">{{ c.name }}</h4>
                    @if (v.properties[c.name]; as applied) {
                        @if (applied.stoppedAt) {
                            <p class="pp-card__stop">
                                Inheritance stopped at {{ sourceText(applied.stoppedAt, v.path) }}.
                            </p>
                        }
                        @for (key of keysOf(applied.values); track key) {
                            <div class="pp-card__applied">
                                <span class="pp-card__key">{{ key === '' ? c.name : key }}</span>
                                <span class="pp-card__value">{{ applied.values[key] }}</span>
                                @if (applied.sources[key]; as source) {
                                    <span class="pp-card__source">from {{ sourceText(source, v.path) }}</span>
                                }
                            </div>
                        } @empty {
                            <p class="pp-card__hint">Nothing applies.</p>
                        }
                    }

                    @if (!readOnly()) {
                        <div class="pp-card__own">
                            <div class="pp-card__controls">
                                <select class="cms-input cms-input-sm" [attr.aria-label]="'Languages for ' + c.name"
                                        [ngModel]="c.scope" [disabled]="isDirty(c) || c.saving"
                                        (ngModelChange)="setScope(c.name, $event)">
                                    <option [value]="all">All languages</option>
                                    @if (c.scope !== all && c.scope !== localeScope()) {
                                        <option [value]="c.scope">{{ c.scope }} only</option>
                                    }
                                    @if (localeScope(); as l) {
                                        <option [value]="l">{{ l }} only</option>
                                    }
                                </select>
                                <select class="cms-input cms-input-sm" [attr.aria-label]="'Change for ' + c.name"
                                        [ngModel]="c.op" [disabled]="c.saving"
                                        (ngModelChange)="setOp(c.name, $event)">
                                    @for (o of ops; track o.value) {
                                        <option [value]="o.value">{{ o.label }}</option>
                                    }
                                </select>
                            </div>
                            @for (r of c.rows; track $index; let i = $index) {
                                <div class="pp-card__row">
                                    @if (c.merge !== 'single') {
                                        <input class="cms-input cms-input-sm" placeholder="name"
                                               [attr.aria-label]="c.name + ' name ' + (i + 1)"
                                               [ngModel]="r.key" (ngModelChange)="setRow(c.name, i, 'key', $event)" />
                                    }
                                    <input class="cms-input cms-input-sm" placeholder="value"
                                           [attr.aria-label]="c.name + ' value ' + (i + 1)"
                                           [ngModel]="r.value" (ngModelChange)="setRow(c.name, i, 'value', $event)" />
                                    @if (c.merge !== 'single') {
                                        <button class="cms-btn cms-btn-sm" type="button"
                                                [attr.aria-label]="'Remove ' + c.name + ' ' + (i + 1)"
                                                (click)="removeRow(c.name, i)"><i class="bi bi-x"></i></button>
                                    }
                                </div>
                            }
                            @if (c.merge !== 'single') {
                                <button class="cms-btn cms-btn-sm pp-card__add" type="button"
                                        [attr.aria-label]="'Add to ' + c.name" (click)="addRow(c.name)">
                                    <i class="bi bi-plus"></i> Add
                                </button>
                            }
                            @if (c.theirs !== undefined) {
                                <div class="pp-card__conflict" role="alert">
                                    <p>Changed by someone else since you opened it. Theirs now:
                                        {{ c.theirs === null ? 'nothing set here' : describe(c.theirs) }}</p>
                                    <button class="cms-btn cms-btn-sm" type="button"
                                            [attr.aria-label]="'Save mine over theirs: ' + c.name"
                                            (click)="saveOverTheirs(c.name)">Save mine over theirs</button>
                                    <button class="cms-btn cms-btn-sm" type="button"
                                            [attr.aria-label]="'Reload ' + c.name"
                                            (click)="reloadCard(c.name)">Reload</button>
                                </div>
                            }
                            @if (c.note) {
                                <p class="pp-card__hint" role="status">{{ c.note }}</p>
                            }
                            @if (c.error) {
                                <p class="pp__error" role="alert">{{ c.error }}</p>
                            }
                            <div class="pp-card__actions">
                                <button class="cms-btn cms-btn-sm" type="button" [attr.aria-label]="'Reset ' + c.name"
                                        [disabled]="!c.base || c.saving || c.theirs !== undefined"
                                        (click)="reset(c.name)">Reset</button>
                                <button class="cms-btn cms-btn-primary cms-btn-sm" type="button"
                                        [attr.aria-label]="'Save ' + c.name"
                                        [disabled]="!isDirty(c) || c.saving || c.theirs !== undefined"
                                        (click)="save(c.name)">Save</button>
                            </div>
                        </div>
                    }
                </section>
            } @empty {
                <p class="pp-card__hint">This {{ subject() }} has no properties to set.</p>
            }
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; gap: 12px; }
        .pp-card { display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px;
                   border-bottom: 1px solid var(--cms-border); }
        .pp-card__title { margin: 0; font-size: .8125rem; font-weight: 600; }
        .pp-card__applied { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: .75rem; overflow-wrap: anywhere; }
        .pp-card__key { font-family: var(--cms-font-mono, monospace); }
        .pp-card__source, .pp-card__hint, .pp-card__stop { color: var(--cms-text-muted); font-size: .75rem; margin: 0; }
        .pp-card__own, .pp-card__controls { display: flex; flex-direction: column; gap: 6px; }
        .pp-card__row { display: flex; gap: 4px; }
        .pp-card__row input { min-width: 0; flex: 1; }
        .pp-card__add { align-self: flex-start; }
        .pp-card__actions { display: flex; gap: 6px; justify-content: flex-end; }
        .pp-card__conflict { padding: 6px 8px; border-radius: var(--cms-radius-sm, 4px); font-size: .75rem;
                             background: var(--cms-warning-light); color: var(--cms-warning-text); }
        .pp-card__conflict p { margin: 0 0 6px; }
        .pp__error { color: var(--cms-danger); font-size: .75rem; margin: 0; overflow-wrap: anywhere; }
    `],
})
export class PagePropertiesPanelComponent {
    private readonly service = inject(PagePropertiesService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    /** The page's VFS path, or the folder's. */
    readonly path = input<string>('');
    /**
     * What the path names: a page, or a folder whose properties the pages below it inherit. Only the words change;
     * the server answers both the same way.
     */
    readonly subject = input<'page' | 'folder'>('page');
    /** The language the page is edited in; empty for none. */
    readonly locale = input<string>('');

    readonly view = signal<PagePropertiesDto | null>(null);
    readonly cards = signal<readonly PropertyCard[]>([]);
    readonly readOnly = signal(false);
    readonly loadError = signal<string | null>(null);

    readonly ops = PROPERTY_OPS;
    readonly all = ALL_LANGUAGES;
    readonly localeScope = computed(() => {
        const l = this.locale();
        return l && l !== ALL_LANGUAGES ? l : null;
    });

    /**
     * Whether a card holds changes not saved -- the editor's leave guard and footer read it. A read-only panel holds
     * none: its rows can no longer be seen or saved, so nothing is there to warn about.
     */
    readonly dirty = computed(() => !this.readOnly() && this.cards().some(c => this.isDirty(c)));

    constructor() {
        effect(() => {
            const path = this.path();
            const scope = this.localeScope() ?? ALL_LANGUAGES;
            if (path) {
                this.load(path, scope);
            }
        });
    }

    isDirty(c: PropertyCard): boolean {
        const base = c.base ?? { op: 'append', values: {} };
        return c.op !== base.op || !sameValues(valuesOf(c.rows), base.values);
    }

    keysOf(values: Readonly<Record<string, string>>): string[] {
        return Object.keys(values);
    }

    /** "this page" (or folder), the node's path, or -- for a node the reader may not open -- its name only. */
    sourceText(source: PropertySourceDto, path: string): string {
        const where = source.link === null
            ? `${source.label} (you cannot open it)`
            : (source.link === path ? 'this ' + this.subject() : source.label);
        return source.scope === ALL_LANGUAGES ? where : `${where} (${source.scope})`;
    }

    describe(set: OwnPropertyDto): string {
        const op = PROPERTY_OPS.find(o => o.value === set.op)?.label ?? set.op;
        const values = Object.entries(set.values).map(([k, v]) => (k === '' ? v : `${k} = ${v}`));
        return values.length > 0 ? `${op}: ${values.join(', ')}` : op;
    }

    setScope(name: string, scope: string): void {
        const v = this.view();
        if (v) {
            this.patch(name, c => fresh(c.name, c.merge, scope, v));
        }
    }

    setOp(name: string, op: string): void {
        this.patch(name, c => ({ ...c, op, error: null, note: null }));
    }

    setRow(name: string, index: number, field: 'key' | 'value', text: string): void {
        this.patch(name, c => ({
            ...c,
            rows: c.rows.map((r, i) => (i === index ? { ...r, [field]: text } : r)),
            error: null,
            note: null,
        }));
    }

    addRow(name: string): void {
        this.patch(name, c => ({ ...c, rows: [...c.rows, { key: '', value: '' }] }));
    }

    removeRow(name: string, index: number): void {
        this.patch(name, c => ({ ...c, rows: c.rows.filter((_, i) => i !== index) }));
    }

    save(name: string): void {
        const c = this.card(name);
        if (!c || c.theirs !== undefined || c.saving) {
            return;
        }
        this.send(c, c.op, valuesOf(c.rows), c.version);
    }

    /** The editor saw the other change and chose theirs to be replaced: the rows go with the version just read. */
    saveOverTheirs(name: string): void {
        const c = this.card(name);
        const v = this.view();
        if (!c || !v || c.theirs === undefined) {
            return;
        }
        this.patch(name, x => ({ ...x, theirs: undefined }));
        this.send(c, c.op, valuesOf(c.rows), v.version);
    }

    /** Reads the properties again, as they now are: after a restore wrote them, for one. */
    refresh(): void {
        this.load(this.path(), this.localeScope() ?? ALL_LANGUAGES);
    }

    /** Drops the editor's rows, after a confirm, for the values as they now are. */
    reloadCard(name: string): void {
        this.confirm.open({
            title: 'Reload',
            message: `Your changes to ${name} will be lost.`,
            confirmLabel: 'Reload',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            const v = this.view();
            if (confirmed && v) {
                this.patch(name, c => fresh(c.name, c.merge, c.scope, v));
            }
        });
    }

    reset(name: string): void {
        const c = this.card(name);
        if (!c || !c.base || c.theirs !== undefined || c.saving) {
            return;
        }
        this.send(c, 'reset', {}, c.version);
    }

    private send(c: PropertyCard, op: string, values: Record<string, string>, version: string): void {
        this.patch(c.name, x => ({ ...x, saving: true, error: null, note: null }));
        this.service.change({ path: this.path(), scope: c.scope, property: c.name, op, values, version })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    // Saved: the card is clean against what it sent; the read that follows takes the new version.
                    const base = op === 'reset' ? null : { op, values };
                    const rows = op === 'reset' ? [] : c.rows;
                    this.patch(c.name, x => ({
                        ...x, base, rows, op: base?.op ?? 'append', saving: false, theirs: undefined,
                    }));
                    this.load(this.path(), this.localeScope() ?? ALL_LANGUAGES);
                },
                error: (err: unknown) => {
                    const status = err instanceof HttpErrorResponse ? err.status : 0;
                    this.patch(c.name, x => ({ ...x, saving: false }));
                    if (status === 412) {
                        this.load(this.path(), this.localeScope() ?? ALL_LANGUAGES, c.name);
                    } else if (status === 403) {
                        this.readOnly.set(true);
                    } else {
                        this.patch(c.name, x => ({ ...x, error: errorMessage(err) }));
                    }
                },
            });
    }

    /**
     * Reads the properties and lays each card over the answer: a clean card takes it whole; a card with unsaved rows
     * keeps them, and takes the new version only when its own property is as it was -- otherwise the other editor's
     * values are put beside the rows and the old version is kept.
     */
    private load(path: string, scope: string, refused: string | null = null): void {
        this.service.read(path, scope).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: v => {
                this.loadError.set(null);
                this.readOnly.set(!v.writable);
                const previous = new Map(this.cards().map(c => [c.name, c]));
                this.view.set(v);
                this.cards.set(Object.entries(v.properties).map(([name, p]) => {
                    const c = previous.get(name);
                    if (!c || (!this.isDirty(c) && c.theirs === undefined)) {
                        // A clean card keeps its languages while they are still offered.
                        return fresh(name, p.merge, c?.scope === scope ? scope : ALL_LANGUAGES, v);
                    }
                    const now = v.own[c.scope]?.[name] ?? null;
                    if (sameSet(now, c.base)) {
                        const note = name === refused
                            ? 'Other properties of this page changed meanwhile; this one did not. Save again.'
                            : c.note;
                        return { ...c, version: v.version, theirs: undefined, note };
                    }
                    return { ...c, theirs: now };
                }));
            },
            error: (err: unknown) => {
                this.view.set(null);
                this.cards.set([]);
                this.loadError.set(errorMessage(err));
            },
        });
    }

    private card(name: string): PropertyCard | undefined {
        return this.cards().find(c => c.name === name);
    }

    private patch(name: string, change: (c: PropertyCard) => PropertyCard): void {
        this.cards.update(cards => cards.map(c => (c.name === name ? change(c) : c)));
    }
}

/** A clean card for `name` in `scope`, as the answer has it. */
function fresh(name: string, merge: string, scope: string, v: PagePropertiesDto): PropertyCard {
    const base = v.own[scope]?.[name] ?? null;
    const rows = Object.entries(base?.values ?? {}).map(([key, value]) => ({ key, value }));
    return {
        name,
        merge,
        scope,
        op: base?.op ?? 'append',
        rows: merge === 'single' && rows.length === 0 ? [{ key: '', value: '' }] : rows,
        base,
        version: v.version,
        note: null,
        error: null,
        saving: false,
    };
}

/** The rows as values; a row with neither name nor value is not sent. */
function valuesOf(rows: readonly Row[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const r of rows) {
        if (r.key.trim() !== '' || r.value !== '') {
            values[r.key.trim()] = r.value;
        }
    }
    return values;
}

function sameValues(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
    const ak = Object.keys(a);
    return ak.length === Object.keys(b).length && ak.every(k => Object.hasOwn(b, k) && a[k] === b[k]);
}

function sameSet(a: OwnPropertyDto | null, b: OwnPropertyDto | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return a.op === b.op && sameValues(a.values, b.values);
}
